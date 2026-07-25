'use strict'

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')
const k8s = require('@kubernetes/client-node')

// ---------------------------------------------------------------------------
// Fix PATH for packaged Mac apps (they only get /usr/bin:/bin:/usr/sbin:/sbin)
// ---------------------------------------------------------------------------
;(() => {
  const extraPaths = [
    '/opt/homebrew/bin',    // Apple Silicon brew
    '/usr/local/bin',       // Intel brew / common
    '/opt/homebrew/sbin',
    '/usr/local/sbin',
    path.join(process.env.HOME || '', '.local', 'bin'),
    path.join(process.env.HOME || '', 'bin')
  ]
  const cur = process.env.PATH || ''
  const missing = extraPaths.filter(p => !cur.split(':').includes(p))
  if (missing.length) process.env.PATH = [...missing, cur].join(':')

  // Also try to inherit PATH from a login shell (gets pyenv, nvm, etc.)
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const shellPath = execFileSync(shell, ['-l', '-c', 'echo $PATH'], { encoding: 'utf8', timeout: 3000 }).trim()
    if (shellPath) {
      const combined = new Set([...shellPath.split(':'), ...process.env.PATH.split(':')])
      process.env.PATH = [...combined].join(':')
    }
  } catch (_) {}
})()

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------
const settingsPath = path.join(app.getPath('userData'), 'funkube-settings.json')

function loadSettings () {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    }
  } catch (_) {}
  return { kubeconfigPath: '', currentContext: '', currentNamespace: 'default' }
}

function saveSettings (s) {
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2))
}

let settings = loadSettings()

// ---------------------------------------------------------------------------
// Kubernetes client
// ---------------------------------------------------------------------------
const kc = new k8s.KubeConfig()
let coreV1Api, appsV1Api, netV1Api, batchV1Api, customObjectsApi

function getEnvKubeconfig () {
  // Packaged Mac apps don't inherit shell env vars, so try reading from a login shell
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const out = execFileSync(shell, ['-l', '-c', 'echo $KUBECONFIG'], { encoding: 'utf8', timeout: 3000 }).trim()
    if (out && out !== '$KUBECONFIG') return out
  } catch (_) {}
  return process.env.KUBECONFIG || ''
}

function initK8s () {
  try {
    if (settings.kubeconfigPath && fs.existsSync(settings.kubeconfigPath)) {
      kc.loadFromFile(settings.kubeconfigPath)
    } else {
      // Try KUBECONFIG env var (check login shell for packaged apps)
      const envKubeconfig = getEnvKubeconfig()
      const firstPath = envKubeconfig ? envKubeconfig.split(':')[0] : ''
      if (firstPath && fs.existsSync(firstPath)) {
        kc.loadFromFile(firstPath)
      } else {
        kc.loadFromDefault()
      }
    }
    if (settings.currentContext) {
      try { kc.setCurrentContext(settings.currentContext) } catch (_) {}
    }
    coreV1Api  = kc.makeApiClient(k8s.CoreV1Api)
    appsV1Api  = kc.makeApiClient(k8s.AppsV1Api)
    netV1Api   = kc.makeApiClient(k8s.NetworkingV1Api)
    batchV1Api = kc.makeApiClient(k8s.BatchV1Api)
    customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi)
    return true
  } catch (e) {
    console.error('k8s init error:', e.message)
    return false
  }
}

// Helper: run kubectl safely with an array of arguments (no shell injection)
function kubectl (args, timeout = 15000) {
  const extra = []
  const kubeconfigToUse = settings.kubeconfigPath || getEnvKubeconfig().split(':')[0] || ''
  if (kubeconfigToUse) extra.push('--kubeconfig', kubeconfigToUse)
  if (settings.currentContext) extra.push('--context', settings.currentContext)
  try {
    const output = execFileSync('kubectl', [...args, ...extra], { encoding: 'utf8', timeout })
    return { output: output.trim() }
  } catch (e) {
    return { error: e.stderr ? e.stderr.trim() : e.message }
  }
}

// ---------------------------------------------------------------------------
// Electron window
// ---------------------------------------------------------------------------
let mainWindow

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 550,
    frame: false,
    backgroundColor: '#c0c0c0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.loadFile('index.html')
  if (process.env.ELECTRON_IS_DEV === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

app.whenReady().then(() => {
  initK8s()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------------------
// IPC: window controls
// ---------------------------------------------------------------------------
ipcMain.handle('window:minimize', () => mainWindow.minimize())
ipcMain.handle('window:maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.handle('window:close', () => mainWindow.close())

// ---------------------------------------------------------------------------
// IPC: settings
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', () => settings)

ipcMain.handle('settings:set', (_, next) => {
  settings = { ...settings, ...next }
  saveSettings(settings)
  initK8s()
  return true
})

ipcMain.handle('settings:pickFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select kubeconfig file',
    properties: ['openFile'],
    filters: [{ name: 'All Files', extensions: ['*'] }]
  })
  return result.canceled ? null : result.filePaths[0]
})

// ---------------------------------------------------------------------------
// IPC: k8s – contexts
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:getContexts', () => {
  try {
    return {
      contexts: kc.getContexts().map(c => c.name),
      current: kc.getCurrentContext()
    }
  } catch (e) {
    return { contexts: [], current: '', error: e.message }
  }
})

ipcMain.handle('k8s:setContext', (_, contextName) => {
  try {
    kc.setCurrentContext(contextName)
    settings.currentContext = contextName
    saveSettings(settings)
    coreV1Api  = kc.makeApiClient(k8s.CoreV1Api)
    appsV1Api  = kc.makeApiClient(k8s.AppsV1Api)
    netV1Api   = kc.makeApiClient(k8s.NetworkingV1Api)
    batchV1Api = kc.makeApiClient(k8s.BatchV1Api)
    return { success: true }
  } catch (e) {
    return { error: e.message }
  }
})

// ---------------------------------------------------------------------------
// IPC: k8s – namespaces
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:getNamespaces', async () => {
  try {
    const res = await coreV1Api.listNamespace()
    return res.body.items.map(ns => ({
      name: ns.metadata.name,
      status: ns.status.phase,
      age: ns.metadata.creationTimestamp
    }))
  } catch (e) {
    return { error: e.message }
  }
})

// ---------------------------------------------------------------------------
// IPC: k8s – list resources
// ---------------------------------------------------------------------------
function calcAge (ts) { return ts || null }

function podStatus (pod) {
  if (pod.metadata.deletionTimestamp) return 'Terminating'
  const css = pod.status.containerStatuses || []
  for (const cs of css) {
    if (cs.state && cs.state.waiting)    return cs.state.waiting.reason   || 'Waiting'
    if (cs.state && cs.state.terminated && cs.state.terminated.reason !== 'Completed')
      return cs.state.terminated.reason || 'Error'
  }
  return pod.status.phase || 'Unknown'
}

function mapPod (p) {
  const css = p.status.containerStatuses || []
  return {
    name:       p.metadata.name,
    namespace:  p.metadata.namespace,
    ready:      `${css.filter(c => c.ready).length}/${p.spec.containers.length}`,
    status:     podStatus(p),
    restarts:   css.reduce((a, c) => a + (c.restartCount || 0), 0),
    ip:         p.status.podIP || '',
    node:       p.spec.nodeName || '',
    age:        calcAge(p.metadata.creationTimestamp),
    containers: p.spec.containers.map(c => c.name),
    containerResources: p.spec.containers.map(c => ({
      name:       c.name,
      cpuRequest: c.resources?.requests?.cpu,
      cpuLimit:   c.resources?.limits?.cpu,
      memRequest: c.resources?.requests?.memory,
      memLimit:   c.resources?.limits?.memory
    }))
  }
}

ipcMain.handle('k8s:getResources', async (_, { resourceType, namespace }) => {
  try {
    const ns = (namespace && namespace !== 'all') ? namespace : null

    switch (resourceType) {

      case 'pods': {
        const res = ns
          ? await coreV1Api.listNamespacedPod(ns)
          : await coreV1Api.listPodForAllNamespaces()
        return res.body.items.map(mapPod)
      }

      case 'deployments': {
        const res = ns
          ? await appsV1Api.listNamespacedDeployment(ns)
          : await appsV1Api.listDeploymentForAllNamespaces()
        return res.body.items.map(d => ({
          name: d.metadata.name,
          namespace: d.metadata.namespace,
          ready: `${d.status.readyReplicas || 0}/${d.spec.replicas || 0}`,
          upToDate: d.status.updatedReplicas || 0,
          available: d.status.availableReplicas || 0,
          age: calcAge(d.metadata.creationTimestamp),
          replicas: d.spec.replicas || 0
        }))
      }

      case 'statefulsets': {
        const res = ns
          ? await appsV1Api.listNamespacedStatefulSet(ns)
          : await appsV1Api.listStatefulSetForAllNamespaces()
        return res.body.items.map(s => ({
          name: s.metadata.name,
          namespace: s.metadata.namespace,
          ready: `${s.status.readyReplicas || 0}/${s.spec.replicas || 0}`,
          age: calcAge(s.metadata.creationTimestamp),
          replicas: s.spec.replicas || 0
        }))
      }

      case 'daemonsets': {
        const res = ns
          ? await appsV1Api.listNamespacedDaemonSet(ns)
          : await appsV1Api.listDaemonSetForAllNamespaces()
        return res.body.items.map(d => ({
          name: d.metadata.name,
          namespace: d.metadata.namespace,
          desired: d.status.desiredNumberScheduled || 0,
          current: d.status.currentNumberScheduled || 0,
          ready: d.status.numberReady || 0,
          age: calcAge(d.metadata.creationTimestamp)
        }))
      }

      case 'replicasets': {
        const res = ns
          ? await appsV1Api.listNamespacedReplicaSet(ns)
          : await appsV1Api.listReplicaSetForAllNamespaces()
        return res.body.items.map(r => ({
          name: r.metadata.name,
          namespace: r.metadata.namespace,
          desired: r.spec.replicas || 0,
          current: r.status.replicas || 0,
          ready: r.status.readyReplicas || 0,
          age: calcAge(r.metadata.creationTimestamp)
        }))
      }

      case 'jobs': {
        const res = ns
          ? await batchV1Api.listNamespacedJob(ns)
          : await batchV1Api.listJobForAllNamespaces()
        return res.body.items.map(j => ({
          name: j.metadata.name,
          namespace: j.metadata.namespace,
          completions: `${j.status.succeeded || 0}/${j.spec.completions || 1}`,
          age: calcAge(j.metadata.creationTimestamp)
        }))
      }

      case 'cronjobs': {
        const res = ns
          ? await batchV1Api.listNamespacedCronJob(ns)
          : await batchV1Api.listCronJobForAllNamespaces()
        return res.body.items.map(cj => ({
          name: cj.metadata.name,
          namespace: cj.metadata.namespace,
          schedule: cj.spec.schedule,
          suspend: cj.spec.suspend ? 'true' : 'false',
          active: (cj.status.active || []).length,
          lastSchedule: cj.status.lastScheduleTime || '<none>',
          age: calcAge(cj.metadata.creationTimestamp)
        }))
      }

      case 'services': {
        const res = ns
          ? await coreV1Api.listNamespacedService(ns)
          : await coreV1Api.listServiceForAllNamespaces()
        return res.body.items.map(svc => ({
          name: svc.metadata.name,
          namespace: svc.metadata.namespace,
          type: svc.spec.type,
          clusterIP: svc.spec.clusterIP,
          externalIP: (svc.status.loadBalancer?.ingress || [])
            .map(i => i.ip || i.hostname).join(',') || '<none>',
          ports: (svc.spec.ports || [])
            .map(p => `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol}`)
            .join(', '),
          age: calcAge(svc.metadata.creationTimestamp)
        }))
      }

      case 'ingresses': {
        const res = ns
          ? await netV1Api.listNamespacedIngress(ns)
          : await netV1Api.listIngressForAllNamespaces()
        return res.body.items.map(ing => ({
          name: ing.metadata.name,
          namespace: ing.metadata.namespace,
          class: ing.spec.ingressClassName ||
            ing.metadata.annotations?.['kubernetes.io/ingress.class'] || '<none>',
          hosts: (ing.spec.rules || []).map(r => r.host || '*').join(', '),
          address: (ing.status.loadBalancer?.ingress || [])
            .map(i => i.ip || i.hostname).join(',') || '',
          age: calcAge(ing.metadata.creationTimestamp)
        }))
      }

      case 'configmaps': {
        const res = ns
          ? await coreV1Api.listNamespacedConfigMap(ns)
          : await coreV1Api.listConfigMapForAllNamespaces()
        return res.body.items.map(cm => ({
          name: cm.metadata.name,
          namespace: cm.metadata.namespace,
          data: Object.keys(cm.data || {}).length,
          age: calcAge(cm.metadata.creationTimestamp)
        }))
      }

      case 'secrets': {
        const res = ns
          ? await coreV1Api.listNamespacedSecret(ns)
          : await coreV1Api.listSecretForAllNamespaces()
        return res.body.items.map(s => ({
          name: s.metadata.name,
          namespace: s.metadata.namespace,
          type: s.type,
          data: Object.keys(s.data || {}).length,
          age: calcAge(s.metadata.creationTimestamp)
        }))
      }

      case 'serviceaccounts': {
        const res = ns
          ? await coreV1Api.listNamespacedServiceAccount(ns)
          : await coreV1Api.listServiceAccountForAllNamespaces()
        return res.body.items.map(sa => ({
          name: sa.metadata.name,
          namespace: sa.metadata.namespace,
          secrets: (sa.secrets || []).length,
          age: calcAge(sa.metadata.creationTimestamp)
        }))
      }

      case 'persistentvolumeclaims': {
        const res = ns
          ? await coreV1Api.listNamespacedPersistentVolumeClaim(ns)
          : await coreV1Api.listPersistentVolumeClaimForAllNamespaces()
        return res.body.items.map(pvc => ({
          name: pvc.metadata.name,
          namespace: pvc.metadata.namespace,
          status: pvc.status.phase,
          volume: pvc.spec.volumeName || '',
          capacity: pvc.status.capacity?.storage || '',
          accessModes: (pvc.spec.accessModes || []).join(', '),
          storageClass: pvc.spec.storageClassName || '',
          age: calcAge(pvc.metadata.creationTimestamp)
        }))
      }

      case 'nodes': {
        const res = await coreV1Api.listNode()
        return res.body.items.map(node => {
          const ready = node.status.conditions?.find(c => c.type === 'Ready')
          const roles = Object.keys(node.metadata.labels || {})
            .filter(l => l.startsWith('node-role.kubernetes.io/'))
            .map(l => l.replace('node-role.kubernetes.io/', ''))
            .join(', ') || '<none>'
          const internalIP = node.status.addresses?.find(a => a.type === 'InternalIP')?.address || ''
          return {
            name: node.metadata.name,
            status: ready?.status === 'True' ? 'Ready' : 'NotReady',
            roles,
            version: node.status.nodeInfo?.kubeletVersion || '',
            internalIP,
            os: node.status.nodeInfo?.osImage || '',
            age: calcAge(node.metadata.creationTimestamp)
          }
        })
      }

      case 'namespaces': {
        const res = await coreV1Api.listNamespace()
        return res.body.items.map(n => ({
          name: n.metadata.name,
          status: n.status.phase,
          age: calcAge(n.metadata.creationTimestamp)
        }))
      }

      case 'events': {
        const res = ns
          ? await coreV1Api.listNamespacedEvent(ns)
          : await coreV1Api.listEventForAllNamespaces()
        return res.body.items
          .sort((a, b) =>
            new Date(b.lastTimestamp || b.eventTime || 0) -
            new Date(a.lastTimestamp || a.eventTime || 0))
          .slice(0, 300)
          .map(e => ({
            name: e.metadata.name,
            namespace: e.metadata.namespace,
            type: e.type,
            reason: e.reason,
            object: `${e.involvedObject.kind}/${e.involvedObject.name}`,
            message: e.message,
            count: e.count || 1,
            age: calcAge(e.lastTimestamp || e.eventTime || e.metadata.creationTimestamp)
          }))
      }

      default:
        return { error: `Unknown resource type: ${resourceType}` }
    }
  } catch (e) {
    return { error: e.message }
  }
})

// ---------------------------------------------------------------------------
// IPC: k8s – describe / logs / yaml
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:describe', (_, { resourceType, name, namespace }) => {
  const args = ['describe', resourceType, name]
  if (namespace && namespace !== 'all') args.push('-n', namespace)
  return kubectl(args)
})

ipcMain.handle('k8s:getLogs', (_, { podName, namespace, container, tail }) => {
  const args = ['logs', podName, '-n', namespace, `--tail=${tail || 300}`]
  if (container) args.push('-c', container)
  return kubectl(args, 20000)
})

ipcMain.handle('k8s:getYaml', (_, { resourceType, name, namespace }) => {
  const args = ['get', resourceType, name, '-o', 'yaml']
  if (namespace && namespace !== 'all') args.push('-n', namespace)
  return kubectl(args)
})

// ---------------------------------------------------------------------------
// IPC: k8s – delete
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:delete', async (_, { resourceType, name, namespace }) => {
  try {
    switch (resourceType) {
      case 'pods':
        await coreV1Api.deleteNamespacedPod(name, namespace); break
      case 'deployments':
        await appsV1Api.deleteNamespacedDeployment(name, namespace); break
      case 'statefulsets':
        await appsV1Api.deleteNamespacedStatefulSet(name, namespace); break
      case 'daemonsets':
        await appsV1Api.deleteNamespacedDaemonSet(name, namespace); break
      case 'services':
        await coreV1Api.deleteNamespacedService(name, namespace); break
      case 'configmaps':
        await coreV1Api.deleteNamespacedConfigMap(name, namespace); break
      case 'jobs':
        await batchV1Api.deleteNamespacedJob(name, namespace); break
      case 'ingresses':
        await netV1Api.deleteNamespacedIngress(name, namespace); break
      default:
        return { error: `Delete not implemented for ${resourceType}` }
    }
    return { success: true }
  } catch (e) {
    return { error: e.message }
  }
})

// ---------------------------------------------------------------------------
// IPC: k8s – scale
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:scale', async (_, { resourceType, name, namespace, replicas }) => {
  try {
    const patch = { spec: { replicas } }
    const headers = { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } }
    if (resourceType === 'deployments') {
      await appsV1Api.patchNamespacedDeployment(name, namespace, patch,
        undefined, undefined, undefined, undefined, undefined, headers)
    } else if (resourceType === 'statefulsets') {
      await appsV1Api.patchNamespacedStatefulSet(name, namespace, patch,
        undefined, undefined, undefined, undefined, undefined, headers)
    } else {
      return { error: `Scale not supported for ${resourceType}` }
    }
    return { success: true }
  } catch (e) {
    return { error: e.message }
  }
})

// ---------------------------------------------------------------------------
// IPC: k8s – rollout restart
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:rolloutRestart', (_, { resourceType, name, namespace }) => {
  const args = ['rollout', 'restart', `${resourceType}/${name}`, '-n', namespace]
  return kubectl(args)
})

// ---------------------------------------------------------------------------
// IPC: k8s – list custom resource (CRD)
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:listCustomResource', async (_, { group, version, plural, namespace }) => {
  try {
    let res
    if (namespace) {
      res = await customObjectsApi.listNamespacedCustomObject(group, version, namespace, plural)
    } else {
      res = await customObjectsApi.listClusterCustomObject(group, version, plural)
    }
    return (res.body.items || []).map(item => ({
      name:      item.metadata.name,
      namespace: item.metadata.namespace || '',
      age:       item.metadata.creationTimestamp || null
    }))
  } catch (e) {
    return { error: e.message }
  }
})

// ---------------------------------------------------------------------------
// IPC: k8s – pod metrics (metrics-server)
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:getPodMetrics', async (_, { name, namespace }) => {
  try {
    const res = await customObjectsApi.getNamespacedCustomObject(
      'metrics.k8s.io', 'v1beta1', namespace, 'pods', name
    )
    return res.body
  } catch (e) {
    return { error: e.message }
  }
})

// ---------------------------------------------------------------------------
// IPC: k8s – get owned pods (for sub-resource panel)
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:getOwnedPods', async (_, { resourceType, name, namespace }) => {
  try {
    let matchLabels = null

    switch (resourceType) {
      case 'deployments': {
        const r = await appsV1Api.readNamespacedDeployment(name, namespace)
        matchLabels = r.body.spec.selector.matchLabels || {}
        break
      }
      case 'statefulsets': {
        const r = await appsV1Api.readNamespacedStatefulSet(name, namespace)
        matchLabels = r.body.spec.selector.matchLabels || {}
        break
      }
      case 'daemonsets': {
        const r = await appsV1Api.readNamespacedDaemonSet(name, namespace)
        matchLabels = r.body.spec.selector.matchLabels || {}
        break
      }
      case 'replicasets': {
        const r = await appsV1Api.readNamespacedReplicaSet(name, namespace)
        matchLabels = r.body.spec.selector.matchLabels || {}
        break
      }
      case 'jobs': {
        const r = await batchV1Api.readNamespacedJob(name, namespace)
        matchLabels = (r.body.spec.selector && r.body.spec.selector.matchLabels)
          ? r.body.spec.selector.matchLabels
          : null
        if (!matchLabels) {
          // fall back: filter by owner reference
          const all = await coreV1Api.listNamespacedPod(namespace)
          return all.body.items
            .filter(p => (p.metadata.ownerReferences || [])
              .some(ref => ref.kind === 'Job' && ref.name === name))
            .map(mapPod)
        }
        break
      }
      default:
        return []
    }

    const selector = Object.entries(matchLabels).map(([k, v]) => `${k}=${v}`).join(',')
    const res = selector
      ? await coreV1Api.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, selector)
      : await coreV1Api.listNamespacedPod(namespace)
    return res.body.items.map(mapPod)
  } catch (e) {
    return { error: e.message }
  }
})

// ---------------------------------------------------------------------------
// IPC: diagnostics
// ---------------------------------------------------------------------------
ipcMain.handle('k8s:getDiagnostics', async () => {
  const lines = []

  // 1. Settings file
  lines.push(`Settings file: ${settingsPath}`)
  lines.push(`  kubeconfigPath : ${settings.kubeconfigPath || '(empty)'}`)
  lines.push(`  currentContext : ${settings.currentContext || '(empty)'}`)
  lines.push(`  currentNamespace: ${settings.currentNamespace || 'default'}`)
  lines.push('')

  // 2. Kubeconfig file existence
  const kpath = settings.kubeconfigPath
  if (kpath) {
    const exists = fs.existsSync(kpath)
    lines.push(`Kubeconfig file exists: ${exists} — ${kpath}`)
    if (!exists) lines.push('  ⚠ File not found! Check that /tmp/ file is still present.')
  } else {
    const envKube = getEnvKubeconfig()
    lines.push(`No kubeconfigPath in settings.`)
    lines.push(`  KUBECONFIG from login shell: ${envKube || '(empty)'}`)
  }
  lines.push('')

  // 3. Loaded kc state
  try {
    const ctxs = kc.getContexts().map(c => c.name)
    const cur  = kc.getCurrentContext()
    lines.push(`KubeConfig loaded contexts: ${ctxs.join(', ') || '(none)'}`)
    lines.push(`KubeConfig current context: ${cur || '(none)'}`)
    // Check exec auth
    const user = kc.getCurrentUser()
    if (user && user.exec) {
      const cmd = user.exec.command || '(none)'
      lines.push(`Auth: exec — command: ${cmd}`)
      try {
        const resolved = execFileSync('which', [cmd], { encoding: 'utf8', timeout: 2000 }).trim()
        lines.push(`  ✓ "${cmd}" found at: ${resolved}`)
      } catch (_) {
        lines.push(`  ✗ "${cmd}" NOT FOUND on PATH!`)
      }
    } else if (user && user.token) {
      lines.push('Auth: bearer token')
    } else {
      lines.push('Auth: certificate or other')
    }
  } catch (e) {
    lines.push(`KubeConfig state error: ${e.message}`)
  }
  lines.push('')

  // 4. PATH info
  lines.push(`PATH: ${process.env.PATH}`)
  lines.push('')

  // 4. Live connection test
  lines.push('Testing cluster connection...')
  try {
    const res = await coreV1Api.listNamespace()
    const names = res.body.items.map(n => n.metadata.name)
    lines.push(`✓ Connected! Namespaces: ${names.join(', ')}`)
  } catch (e) {
    lines.push(`✗ Connection failed: ${e.message}`)
    if (e.response) {
      lines.push(`  HTTP status: ${e.response.statusCode}`)
      lines.push(`  Body: ${JSON.stringify(e.response.body || '').slice(0, 200)}`)
    }
  }

  return lines.join('\n')
})

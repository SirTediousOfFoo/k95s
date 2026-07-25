'use strict'
/* global kubeAPI */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  currentType:       null,
  currentNamespace:  'default',
  resources:         [],
  selectedIndex:     -1,
  selectedResource:  null,
  currentTab:        'describe',
  sortCol:           'name',
  sortAsc:           true,
  loading:           false,
  // Sub-resource panel
  subPods:           [],
  subSelectedIdx:    -1,
  detailContext:     null,   // { resource, resourceType } – overrides main for detail
  // Column visibility: { [resourceType]: Set<colKey> } of hidden columns
  hiddenCols:        {},
  // Custom resource types loaded from settings
  customTypes:       {},
  // Metrics auto-refresh interval id
  metricsInterval:   null,
  // Search filter
  filterText:        ''
}

// Resource types that support certain actions
const HAS_LOGS       = new Set(['pods'])
const HAS_SCALE      = new Set(['deployments', 'statefulsets'])
const HAS_RESTART    = new Set(['deployments', 'statefulsets'])
const HAS_SUB_PANEL  = new Set(['deployments', 'statefulsets', 'daemonsets', 'replicasets', 'jobs'])
const CLUSTER_SCOPED = new Set(['nodes', 'namespaces'])

// ---------------------------------------------------------------------------
// Column definitions per resource type
// ---------------------------------------------------------------------------
const COLUMNS = {
  pods: [
    { key: 'name',      label: 'Name',     width: '28%' },
    { key: 'namespace', label: 'Namespace', width: '14%' },
    { key: 'ready',     label: 'Ready',    width: '7%'  },
    { key: 'status',    label: 'Status',   width: '14%' },
    { key: 'restarts',  label: 'Restarts', width: '7%', cls: 'text-right' },
    { key: 'ip',        label: 'IP',       width: '13%' },
    { key: 'node',      label: 'Node',     width: '13%' },
    { key: 'age',       label: 'Age',      width: '8%'  }
  ],
  deployments: [
    { key: 'name',      label: 'Name',      width: '30%' },
    { key: 'namespace', label: 'Namespace', width: '18%' },
    { key: 'ready',     label: 'Ready',     width: '10%' },
    { key: 'upToDate',  label: 'Up-to-Date',width: '10%' },
    { key: 'available', label: 'Available', width: '10%' },
    { key: 'age',       label: 'Age',       width: '10%' }
  ],
  statefulsets: [
    { key: 'name',      label: 'Name',      width: '35%' },
    { key: 'namespace', label: 'Namespace', width: '20%' },
    { key: 'ready',     label: 'Ready',     width: '15%' },
    { key: 'age',       label: 'Age',       width: '15%' }
  ],
  daemonsets: [
    { key: 'name',      label: 'Name',      width: '30%' },
    { key: 'namespace', label: 'Namespace', width: '18%' },
    { key: 'desired',   label: 'Desired',   width: '10%' },
    { key: 'current',   label: 'Current',   width: '10%' },
    { key: 'ready',     label: 'Ready',     width: '10%' },
    { key: 'age',       label: 'Age',       width: '10%' }
  ],
  replicasets: [
    { key: 'name',      label: 'Name',      width: '30%' },
    { key: 'namespace', label: 'Namespace', width: '18%' },
    { key: 'desired',   label: 'Desired',   width: '10%' },
    { key: 'current',   label: 'Current',   width: '10%' },
    { key: 'ready',     label: 'Ready',     width: '10%' },
    { key: 'age',       label: 'Age',       width: '10%' }
  ],
  jobs: [
    { key: 'name',        label: 'Name',        width: '35%' },
    { key: 'namespace',   label: 'Namespace',   width: '20%' },
    { key: 'completions', label: 'Completions', width: '15%' },
    { key: 'age',         label: 'Age',         width: '15%' }
  ],
  cronjobs: [
    { key: 'name',         label: 'Name',         width: '22%' },
    { key: 'namespace',    label: 'Namespace',    width: '15%' },
    { key: 'schedule',     label: 'Schedule',     width: '14%' },
    { key: 'suspend',      label: 'Suspended',    width: '8%'  },
    { key: 'active',       label: 'Active',       width: '6%'  },
    { key: 'lastSchedule', label: 'Last Schedule',width: '15%' },
    { key: 'age',          label: 'Age',          width: '10%' }
  ],
  services: [
    { key: 'name',       label: 'Name',       width: '22%' },
    { key: 'namespace',  label: 'Namespace',  width: '15%' },
    { key: 'type',       label: 'Type',       width: '10%' },
    { key: 'clusterIP',  label: 'Cluster-IP', width: '12%' },
    { key: 'externalIP', label: 'External-IP',width: '12%' },
    { key: 'ports',      label: 'Port(s)',    width: '16%' },
    { key: 'age',        label: 'Age',        width: '8%'  }
  ],
  ingresses: [
    { key: 'name',      label: 'Name',      width: '25%' },
    { key: 'namespace', label: 'Namespace', width: '15%' },
    { key: 'class',     label: 'Class',     width: '12%' },
    { key: 'hosts',     label: 'Hosts',     width: '28%' },
    { key: 'address',   label: 'Address',   width: '12%' },
    { key: 'age',       label: 'Age',       width: '8%'  }
  ],
  configmaps: [
    { key: 'name',      label: 'Name',      width: '40%' },
    { key: 'namespace', label: 'Namespace', width: '25%' },
    { key: 'data',      label: 'Data Keys', width: '15%' },
    { key: 'age',       label: 'Age',       width: '15%' }
  ],
  secrets: [
    { key: 'name',      label: 'Name',      width: '30%' },
    { key: 'namespace', label: 'Namespace', width: '20%' },
    { key: 'type',      label: 'Type',      width: '20%' },
    { key: 'data',      label: 'Items',     width: '10%' },
    { key: 'age',       label: 'Age',       width: '12%' }
  ],
  serviceaccounts: [
    { key: 'name',      label: 'Name',      width: '40%' },
    { key: 'namespace', label: 'Namespace', width: '25%' },
    { key: 'secrets',   label: 'Secrets',   width: '15%' },
    { key: 'age',       label: 'Age',       width: '15%' }
  ],
  persistentvolumeclaims: [
    { key: 'name',         label: 'Name',         width: '22%' },
    { key: 'namespace',    label: 'Namespace',    width: '14%' },
    { key: 'status',       label: 'Status',       width: '10%' },
    { key: 'capacity',     label: 'Capacity',     width: '10%' },
    { key: 'accessModes',  label: 'Access',       width: '14%' },
    { key: 'storageClass', label: 'StorageClass', width: '16%' },
    { key: 'age',          label: 'Age',          width: '8%'  }
  ],
  nodes: [
    { key: 'name',       label: 'Name',    width: '25%' },
    { key: 'status',     label: 'Status',  width: '10%' },
    { key: 'roles',      label: 'Roles',   width: '14%' },
    { key: 'version',    label: 'Version', width: '14%' },
    { key: 'internalIP', label: 'IP',      width: '14%' },
    { key: 'os',         label: 'OS',      width: '15%' },
    { key: 'age',        label: 'Age',     width: '8%'  }
  ],
  namespaces: [
    { key: 'name',   label: 'Name',   width: '60%' },
    { key: 'status', label: 'Status', width: '20%' },
    { key: 'age',    label: 'Age',    width: '18%' }
  ],
  events: [
    { key: 'namespace', label: 'Namespace', width: '11%' },
    { key: 'type',      label: 'Type',      width: '7%'  },
    { key: 'reason',    label: 'Reason',    width: '12%' },
    { key: 'object',    label: 'Object',    width: '22%' },
    { key: 'count',     label: 'Count',     width: '5%'  },
    { key: 'message',   label: 'Message',   width: '35%' },
    { key: 'age',       label: 'Age',       width: '8%'  }
  ]
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function ageStr (ts) {
  if (!ts) return '—'
  const sec = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (sec < 60)        return `${sec}s`
  if (sec < 3600)      return `${Math.floor(sec / 60)}m`
  if (sec < 86400)     return `${Math.floor(sec / 3600)}h`
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d`
  return `${Math.floor(sec / 86400 / 7)}w`
}

function statusClass (status) {
  if (!status) return ''
  const s = String(status).toLowerCase()
  if (s === 'running' || s === 'active' || s === 'ready' || s === 'bound') return 'st-running'
  if (s === 'pending')  return 'st-pending'
  if (s.includes('terminating')) return 'st-terminating'
  if (s.includes('crashloop') || s === 'error' || s.includes('failed') || s === 'notready') return 'st-error'
  if (s === 'completed') return 'st-terminating'
  if (s === 'warning')  return 'st-warning'
  return ''
}

function escHtml (str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

let _progressTimer = null
let _progressPct = 0

function showLoading (on) {
  state.loading = on
  const bar  = document.getElementById('progress-bar')
  const fill = document.getElementById('progress-fill')

  if (on) {
    // Reset and show
    _progressPct = 0
    fill.style.transition = 'none'
    fill.style.width = '0%'
    bar.classList.remove('hidden')

    // Force reflow then start animating
    void fill.offsetWidth
    fill.style.transition = 'width 0.3s ease-out'

    // Animate quickly to ~80% then slow to a crawl
    clearInterval(_progressTimer)
    _progressTimer = setInterval(() => {
      if (_progressPct < 60) {
        _progressPct += 8          // fast initial ramp
      } else if (_progressPct < 80) {
        _progressPct += 2          // slow down
      } else if (_progressPct < 90) {
        _progressPct += 0.3        // crawl
      }
      // never exceed 92% on its own
      _progressPct = Math.min(_progressPct, 92)
      fill.style.width = _progressPct + '%'
    }, 200)
  } else {
    // Complete: snap to 100% then hide
    clearInterval(_progressTimer)
    _progressTimer = null
    fill.style.transition = 'width 0.2s ease-out'
    fill.style.width = '100%'
    setTimeout(() => {
      bar.classList.add('hidden')
      fill.style.width = '0%'
    }, 350)
  }
}

function setStatus (msg, field = 'st-msg') {
  document.getElementById(field).textContent = msg
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function init () {
  setupWindowControls()
  setupMenuBar()
  setupToolbar()
  setupTree()
  setupResizers()
  setupSubPanelResizer()
  setupDetailTabs()
  setupContextMenu()
  setupCustomTreeContextMenu()
  setupKeyboard()
  setupSettingsDialog()
  setupScaleDialog()
  setupConfirmDialog()
  setupColumnsDialog()
  setupAddCustomDialog()

  // Search / filter box
  const searchInput = document.getElementById('search-input')
  searchInput.addEventListener('input', () => {
    state.filterText = searchInput.value
    renderTable(state.resources)
    const sorted = getSortedResources()
    setStatus(`${sorted.length} of ${state.resources.length} items`, 'st-count')
  })
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = ''
      state.filterText = ''
      renderTable(state.resources)
      setStatus(`${state.resources.length} items`, 'st-count')
      searchInput.blur()
    }
  })

  document.getElementById('sub-panel-close').addEventListener('click', hideSubPanel)

  const settings = await kubeAPI.getSettings()
  state.currentNamespace = settings.currentNamespace || 'default'

  await loadContextBar()
  await loadNamespaces()
  await loadCustomTypes()

  setStatus('', 'st-msg')
}

// ---------------------------------------------------------------------------
// Window controls
// ---------------------------------------------------------------------------
function setupWindowControls () {
  document.getElementById('btn-min').addEventListener('click', () => kubeAPI.minimize())
  document.getElementById('btn-max').addEventListener('click', () => kubeAPI.maximize())
  document.getElementById('btn-close').addEventListener('click', () => kubeAPI.close())
}

// ---------------------------------------------------------------------------
// Menu bar
// ---------------------------------------------------------------------------
function setupMenuBar () {
  const entries = document.querySelectorAll('.menu-entry')

  entries.forEach(entry => {
    entry.addEventListener('click', (e) => {
      e.stopPropagation()
      const wasOpen = entry.classList.contains('open')
      entries.forEach(e2 => e2.classList.remove('open'))
      if (!wasOpen) entry.classList.add('open')
    })
  })

  entries.forEach(entry => {
    entry.addEventListener('mouseenter', () => {
      const anyOpen = [...entries].some(e2 => e2.classList.contains('open'))
      if (anyOpen) {
        entries.forEach(e2 => e2.classList.remove('open'))
        entry.classList.add('open')
      }
    })
  })

  document.addEventListener('click', () => {
    entries.forEach(e => e.classList.remove('open'))
  })

  document.querySelectorAll('.menu-item[data-action]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation()
      entries.forEach(e2 => e2.classList.remove('open'))
      handleAction(item.dataset.action)
    })
  })
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------
function setupToolbar () {
  document.getElementById('tb-refresh').addEventListener('click',  () => handleAction('refresh'))
  document.getElementById('tb-describe').addEventListener('click', () => handleAction('describe'))
  document.getElementById('tb-logs').addEventListener('click',     () => handleAction('show-logs'))
  document.getElementById('tb-yaml').addEventListener('click',     () => handleAction('show-yaml'))
  document.getElementById('tb-restart').addEventListener('click',  () => handleAction('restart'))
  document.getElementById('tb-scale').addEventListener('click',    () => handleAction('scale'))
  document.getElementById('tb-delete').addEventListener('click',   () => handleAction('delete'))
  document.getElementById('tb-settings').addEventListener('click', () => handleAction('settings'))
}

function updateToolbarState () {
  const has      = state.selectedResource !== null
  const type     = state.currentType
  const canLogs    = has && HAS_LOGS.has(type)
  const canScale   = has && HAS_SCALE.has(type)
  const canRestart = has && HAS_RESTART.has(type)

  toggleBtn('tb-describe', has)
  toggleBtn('tb-logs',     canLogs)
  toggleBtn('tb-yaml',     has)
  toggleBtn('tb-restart',  canRestart)
  toggleBtn('tb-scale',    canScale)
  toggleBtn('tb-delete',   has)
}

function toggleBtn (id, enabled) {
  const el = document.getElementById(id)
  if (enabled) el.classList.remove('disabled')
  else         el.classList.add('disabled')
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------
function setupTree () {
  document.querySelectorAll('.tree-category').forEach(cat => {
    cat.addEventListener('click', (e) => {
      e.stopPropagation()
      const id       = `cat-${cat.dataset.cat}`
      const items    = document.getElementById(id)
      const arrow    = cat.querySelector('.arrow')
      const img      = cat.querySelector('img')
      const collapsed = items.style.display === 'none'
      items.style.display = collapsed ? '' : 'none'
      arrow.textContent   = collapsed ? '▼' : '▶'
      if (img) img.src    = collapsed ? 'icons/w98_directory_open.ico' : 'icons/w98_directory_closed.ico'
    })
  })

  document.querySelectorAll('.tree-item[data-type]').forEach(item => {
    item.addEventListener('click', () => selectResourceType(item.dataset.type))
  })
}

async function selectResourceType (type) {
  document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'))
  const el = document.querySelector(`.tree-item[data-type="${type}"]`)
  if (el) el.classList.add('selected')

  state.currentType      = type
  state.selectedIndex    = -1
  state.selectedResource = null
  state.detailContext    = null
  state.filterText       = ''
  document.getElementById('search-input').value = ''
  hideSubPanel()
  updateToolbarState()
  updateDetailPlaceholder()

  const isCustom  = type.startsWith('custom:')
  const customCfg = isCustom ? state.customTypes[type.slice(7)] : null
  const isCluster = isCustom ? (customCfg ? !customCfg.namespaced : false) : CLUSTER_SCOPED.has(type)
  const ns        = isCluster ? null : state.currentNamespace
  const label     = isCustom
    ? (customCfg ? customCfg.name : type)
    : (type.charAt(0).toUpperCase() + type.slice(1))
  document.getElementById('resource-list-title').textContent = label
  document.getElementById('addr-path').value = isCluster
    ? `(cluster) / ${label}`
    : `${ns} / ${label}`

  await loadResources()
}

// ---------------------------------------------------------------------------
// Namespace selector
// ---------------------------------------------------------------------------
async function loadNamespaces () {
  const ns  = await kubeAPI.getNamespaces()
  const sel = document.getElementById('addr-namespace')
  sel.innerHTML = '<option value="all">all namespaces</option>'

  if (!Array.isArray(ns)) {
    sel.innerHTML += `<option value="default" selected>default</option>`
  } else {
    ns.forEach(n => {
      const opt = document.createElement('option')
      opt.value = n.name
      opt.textContent = n.name
      if (n.name === state.currentNamespace) opt.selected = true
      sel.appendChild(opt)
    })
  }

  sel.addEventListener('change', async () => {
    state.currentNamespace = sel.value
    setStatus(`NS: ${sel.value}`, 'st-namespace')
    if (state.currentType) await loadResources()
  })

  setStatus(`NS: ${state.currentNamespace}`, 'st-namespace')
}

// ---------------------------------------------------------------------------
// Context bar
// ---------------------------------------------------------------------------
async function loadContextBar () {
  const { contexts, current, error } = await kubeAPI.getContexts()
  const label = document.getElementById('addr-context-label')
  if (error) {
    label.textContent = '⚠ No cluster'
    label.style.color = '#800000'
  } else {
    label.textContent = `🖥 ${current || '(none)'}`
    document.getElementById('titlebar-title').textContent = `k95s — ${current || 'No Context'}`
  }
  setStatus(`Context: ${current || '—'}`, 'st-context')
}

// ---------------------------------------------------------------------------
// Load & render resources
// ---------------------------------------------------------------------------
async function loadResources () {
  if (!state.currentType) return
  showLoading(true)

  const isCustom = state.currentType.startsWith('custom:')
  let result

  if (isCustom) {
    const id  = state.currentType.slice(7)
    const cfg = state.customTypes[id]
    if (!cfg) { showLoading(false); renderError('Custom resource type not found'); return }
    result = await kubeAPI.listCustomResource({
      group:     cfg.group,
      version:   cfg.version,
      plural:    cfg.plural,
      namespace: cfg.namespaced ? state.currentNamespace : null
    })
  } else {
    const ns = CLUSTER_SCOPED.has(state.currentType) ? 'all' : state.currentNamespace
    result   = await kubeAPI.getResources({ resourceType: state.currentType, namespace: ns })
  }

  showLoading(false)

  if (!result || result.error) {
    renderError(result?.error || 'Unknown error')
    return
  }

  state.resources        = result
  state.selectedIndex    = -1
  state.selectedResource = null
  updateToolbarState()

  renderTable(result)
  setStatus(`${result.length} item${result.length !== 1 ? 's' : ''}`, 'st-count')
}

function renderError (msg) {
  const list = document.getElementById('resource-list')
  list.innerHTML = `<div class="error-state">⚠ Error: ${escHtml(msg)}</div>`
  setStatus('Error loading resources', 'st-count')
}

function visibleCols () {
  const all    = COLUMNS[state.currentType] || [
    { key: 'name', label: 'Name', width: '60%' },
    { key: 'age',  label: 'Age',  width: '20%' }
  ]
  const hidden = state.hiddenCols[state.currentType] || new Set()
  return all.filter(c => !hidden.has(c.key))
}

function renderTable (items) {
  const cols  = visibleCols()
  const allCols = COLUMNS[state.currentType] || cols

  const sorted = getSortedResources()

  const thead = `<thead><tr>${cols.map(c => `
    <th style="width:${c.width}" data-col="${c.key}">
      ${escHtml(c.label)}
      ${state.sortCol === c.key ? `<span class="sort-arrow">${state.sortAsc ? '▲' : '▼'}</span>` : ''}
    </th>`).join('')}</tr></thead>`

  const tbody = sorted.length === 0
    ? `<tbody><tr><td colspan="${cols.length}" class="empty-state">No items found.</td></tr></tbody>`
    : `<tbody>${sorted.map((row, i) => `
      <tr data-idx="${i}" class="${i === state.selectedIndex ? 'selected' : ''}">
        ${cols.map(c => {
          let val     = row[c.key]
          let display = c.key === 'age' ? ageStr(val) : escHtml(val ?? '—')
          let cls     = c.cls || ''
          if (c.key === 'status' || (state.currentType === 'events' && c.key === 'type')) {
            const sc = state.currentType === 'events'
              ? (val === 'Warning' ? 'st-warning-event' : 'st-normal-event')
              : statusClass(val)
            cls += ' ' + sc
          }
          return `<td class="${cls.trim()}">${display}</td>`
        }).join('')}
      </tr>`).join('')}</tbody>`

  const list = document.getElementById('resource-list')
  list.innerHTML = `<table id="resource-table">${thead}${tbody}</table>`

  list.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      if (state.sortCol === th.dataset.col) state.sortAsc = !state.sortAsc
      else { state.sortCol = th.dataset.col; state.sortAsc = true }
      renderTable(state.resources)
    })
  })

  list.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      e.stopPropagation()
      hideContextMenu()
      hideCustomTreeMenu()
      selectRow(parseInt(tr.dataset.idx))
    })
    tr.addEventListener('dblclick', () => {
      selectRow(parseInt(tr.dataset.idx))
      handleAction('describe')
    })
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      selectRow(parseInt(tr.dataset.idx))
      showContextMenu(e.clientX, e.clientY)
    })
  })

  // Restore selection highlight after re-render
  if (state.selectedResource) {
    const s   = getSortedResources()
    const idx = s.findIndex(r =>
      r.name === state.selectedResource.name &&
      (r.namespace === state.selectedResource.namespace || !r.namespace))
    if (idx >= 0) {
      state.selectedIndex = idx
      const row = list.querySelector(`tr[data-idx="${idx}"]`)
      if (row) row.classList.add('selected')
    }
  }
}

function getSortedResources () {
  let list = state.resources
  if (state.filterText) {
    const q = state.filterText.toLowerCase()
    list = list.filter(r =>
      Object.values(r).some(v => v != null && String(v).toLowerCase().includes(q))
    )
  }
  return list.sort((a, b) => {
    const av = String(a[state.sortCol] ?? '')
    const bv = String(b[state.sortCol] ?? '')
    return state.sortAsc ? av.localeCompare(bv) : bv.localeCompare(av)
  })
}

function selectRow (idx) {
  const old = document.querySelector('#resource-table tbody tr.selected')
  if (old) old.classList.remove('selected')

  const sorted = getSortedResources()
  state.selectedIndex    = idx
  state.selectedResource = sorted[idx] || null
  state.detailContext    = null
  state.subSelectedIdx   = -1

  updateToolbarState()

  const row = document.querySelector(`#resource-table tbody tr[data-idx="${idx}"]`)
  if (row) row.classList.add('selected')

  if (state.selectedResource) {
    if (state.currentType === 'pods') {
      loadPodMetrics()   // async – no await
    } else {
      loadSubResources() // async – no await
    }
  }

  if (state.selectedResource && state.currentTab !== 'logs') {
    loadDetail(state.currentTab)
  }
}

// ---------------------------------------------------------------------------
// Sub-resource panel (owned pods)
// ---------------------------------------------------------------------------
async function loadSubResources () {
  const res = state.selectedResource
  if (!res || !HAS_SUB_PANEL.has(state.currentType)) {
    hideSubPanel()
    return
  }

  showSubPanel(`Owned Pods — ${res.name}`)
  document.getElementById('sub-pod-list').innerHTML =
    '<div class="empty-state">Loading…</div>'

  const result = await kubeAPI.getOwnedPods({
    resourceType: state.currentType,
    name:         res.name,
    namespace:    res.namespace
  })

  state.subPods = Array.isArray(result) ? result : []

  if (result && result.error) {
    document.getElementById('sub-pod-list').innerHTML =
      `<div class="error-state">⚠ ${escHtml(result.error)}</div>`
    return
  }

  renderSubPods()
}

function showSubPanel (title) {
  document.getElementById('sub-panel').classList.remove('hidden')
  document.getElementById('sub-v-resizer').classList.remove('hidden')
  document.getElementById('sub-panel-title').textContent = title || 'Sub-resources'
}

function hideSubPanel () {
  document.getElementById('sub-panel').classList.add('hidden')
  document.getElementById('sub-v-resizer').classList.add('hidden')
  state.subPods        = []
  state.subSelectedIdx = -1
  stopMetricsRefresh()
  if (state.detailContext && state.detailContext._fromSub) {
    state.detailContext = null
  }
}

function renderSubPods () {
  const pods      = state.subPods
  const container = document.getElementById('sub-pod-list')

  if (!pods.length) {
    container.innerHTML = '<div class="empty-state">No pods found.</div>'
    return
  }

  const rows = pods.map((p, i) => `
    <tr data-sub-idx="${i}" class="${i === state.subSelectedIdx ? 'selected' : ''}">
      <td title="${escHtml(p.name)}">${escHtml(p.name)}</td>
      <td>${escHtml(p.ready)}</td>
      <td class="${statusClass(p.status)}">${escHtml(p.status)}</td>
      <td>${ageStr(p.age)}</td>
    </tr>`).join('')

  container.innerHTML = `
    <table id="sub-pod-table">
      <thead><tr>
        <th style="width:45%">Name</th>
        <th style="width:15%">Ready</th>
        <th style="width:22%">Status</th>
        <th style="width:18%">Age</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`

  container.querySelectorAll('tr[data-sub-idx]').forEach(tr => {
    tr.addEventListener('click', () => {
      const idx = parseInt(tr.dataset.subIdx)
      state.subSelectedIdx = idx
      state.detailContext  = { resource: state.subPods[idx], resourceType: 'pods', _fromSub: true }

      container.querySelectorAll('tr').forEach(r => r.classList.remove('selected'))
      tr.classList.add('selected')

      state.currentTab = 'describe'
      document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'))
      document.querySelector('.detail-tab[data-tab="describe"]').classList.add('active')
      loadDetail('describe')
    })

    tr.addEventListener('dblclick', () => {
      const idx = parseInt(tr.dataset.subIdx)
      state.subSelectedIdx = idx
      state.detailContext  = { resource: state.subPods[idx], resourceType: 'pods', _fromSub: true }
      state.currentTab = 'logs'
      document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'))
      document.querySelector('.detail-tab[data-tab="logs"]').classList.add('active')
      loadDetail('logs')
    })
  })
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function setupDetailTabs () {
  document.querySelectorAll('.detail-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      state.currentTab = tab.dataset.tab
      const ctx = state.detailContext
      const res = ctx ? ctx.resource : state.selectedResource
      if (res) loadDetail(state.currentTab)
    })
  })
}

function updateDetailPlaceholder () {
  document.getElementById('detail-text').innerHTML =
    '<span class="detail-placeholder">Select a resource to view details.</span>'
}

async function loadDetail (tab) {
  const ctx     = state.detailContext
  const res     = ctx ? ctx.resource : state.selectedResource
  const resType = ctx ? ctx.resourceType : state.currentType
  if (!res) return

  const pre = document.getElementById('detail-text')
  pre.textContent = 'Loading…'

  if (tab === 'describe') {
    const r = await kubeAPI.describe({ resourceType: resType, name: res.name, namespace: res.namespace || null })
    pre.innerHTML = r.error
      ? `<span style="color:#ff6060">Error: ${escHtml(r.error)}</span>`
      : syntaxDescribe(r.output)

  } else if (tab === 'logs') {
    if (!HAS_LOGS.has(resType)) {
      pre.innerHTML = '<span class="detail-placeholder">Logs are only available for Pods.</span>'
      return
    }
    const container = res.containers?.[0]
    const r = await kubeAPI.getLogs({ podName: res.name, namespace: res.namespace, container, tail: 300 })
    pre.innerHTML = r.error
      ? `<span style="color:#ff6060">Error: ${escHtml(r.error)}</span>`
      : escHtml(r.output)

  } else if (tab === 'yaml') {
    const r = await kubeAPI.getYaml({ resourceType: resType, name: res.name, namespace: res.namespace || null })
    pre.innerHTML = r.error
      ? `<span style="color:#ff6060">Error: ${escHtml(r.error)}</span>`
      : syntaxYaml(r.output)
  }

  document.getElementById('detail-content').scrollTop = 0
}

function syntaxYaml (text) {
  return escHtml(text)
    .replace(/^([ \t]*)([\w\-]+)(:)/gm, '$1<span class="yaml-key">$2</span>$3')
    .replace(/: ([^&\n<]+)/g, (m, val) => {
      if (/^\d/.test(val)) return `: <span class="yaml-number">${val}</span>`
      if (val.startsWith('"') || val.startsWith("'")) return `: <span class="yaml-string">${val}</span>`
      return m
    })
}

function syntaxDescribe (text) {
  return escHtml(text)
    .replace(/^([A-Z][A-Za-z ]+:)$/gm, '<span style="color:#9cdcfe;font-weight:bold">$1</span>')
    .replace(/^([ \t]+)([A-Za-z][A-Za-z\-/ ]*:)([ \t])/gm, '$1<span class="yaml-key">$2</span>$3')
}

// ---------------------------------------------------------------------------
// Context menu (resource list)
// ---------------------------------------------------------------------------
function setupContextMenu () {
  document.addEventListener('click', () => {
    hideContextMenu()
    hideCustomTreeMenu()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideContextMenu(); hideCustomTreeMenu() }
  })

  document.querySelectorAll('#ctx-menu .ctx-item[data-action]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation()
      hideContextMenu()
      handleAction(item.dataset.action)
    })
  })
}

function showContextMenu (x, y) {
  const menu = document.getElementById('ctx-menu')
  const type = state.currentType

  menu.querySelector('.ctx-logs').style.display    = HAS_LOGS.has(type)    ? '' : 'none'
  menu.querySelector('.ctx-restart').style.display = HAS_RESTART.has(type) ? '' : 'none'
  menu.querySelector('.ctx-scale').style.display   = HAS_SCALE.has(type)   ? '' : 'none'

  menu.style.left = `${Math.min(x, window.innerWidth  - 180)}px`
  menu.style.top  = `${Math.min(y, window.innerHeight - 200)}px`
  menu.classList.add('visible')
}

function hideContextMenu () {
  document.getElementById('ctx-menu').classList.remove('visible')
}

// ---------------------------------------------------------------------------
// Context menu (custom tree items)
// ---------------------------------------------------------------------------
let _customCtxId = null

function setupCustomTreeContextMenu () {
  const menu = document.getElementById('custom-tree-ctx-menu')

  document.getElementById('custom-ctx-edit').addEventListener('click', (e) => {
    e.stopPropagation()
    const id = _customCtxId
    hideCustomTreeMenu()
    if (id) openEditCustomDialog(id)
  })

  document.getElementById('custom-ctx-delete').addEventListener('click', (e) => {
    e.stopPropagation()
    const id = _customCtxId
    hideCustomTreeMenu()
    if (id) confirmRemoveCustomType(id)
  })

  menu.addEventListener('click', (e) => e.stopPropagation())
}

function showCustomTreeContextMenu (x, y, id) {
  _customCtxId = id
  const menu = document.getElementById('custom-tree-ctx-menu')
  menu.style.left = `${Math.min(x, window.innerWidth  - 160)}px`
  menu.style.top  = `${Math.min(y, window.innerHeight - 80)}px`
  menu.classList.add('visible')
}

function hideCustomTreeMenu () {
  document.getElementById('custom-tree-ctx-menu').classList.remove('visible')
  _customCtxId = null
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function handleAction (action) {
  const res = state.selectedResource

  switch (action) {

    case 'refresh':
      await loadResources()
      break

    case 'describe':
      if (!res) return
      document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'))
      document.querySelector('.detail-tab[data-tab="describe"]').classList.add('active')
      state.currentTab = 'describe'
      state.detailContext = null
      loadDetail('describe')
      break

    case 'show-yaml':
      if (!res) return
      document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'))
      document.querySelector('.detail-tab[data-tab="yaml"]').classList.add('active')
      state.currentTab = 'yaml'
      state.detailContext = null
      loadDetail('yaml')
      break

    case 'show-logs':
      if (!res || !HAS_LOGS.has(state.currentType)) return
      document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'))
      document.querySelector('.detail-tab[data-tab="logs"]').classList.add('active')
      state.currentTab = 'logs'
      state.detailContext = null
      loadDetail('logs')
      break

    case 'restart':
      if (!res || !HAS_RESTART.has(state.currentType)) return
      showConfirmDialog(
        `Rollout restart <b>${escHtml(state.currentType.slice(0, -1))}</b> <b>${escHtml(res.name)}</b>` +
        (res.namespace ? ` in <b>${escHtml(res.namespace)}</b>` : '') + '?',
        async () => {
          showLoading(true)
          const r = await kubeAPI.restartResource({
            resourceType: state.currentType,
            name:         res.name,
            namespace:    res.namespace
          })
          showLoading(false)
          if (r.error) alert('Restart failed: ' + r.error)
          else setStatus('Rollout restart triggered', 'st-msg')
        }
      )
      break

    case 'scale':
      if (!res || !HAS_SCALE.has(state.currentType)) return
      showScaleDialog(res)
      break

    case 'delete':
      if (!res) return
      showConfirmDialog(
        `Delete ${state.currentType.slice(0, -1)} <b>${escHtml(res.name)}</b>` +
        (res.namespace ? ` in namespace <b>${escHtml(res.namespace)}</b>` : '') + '?<br><br>' +
        '<b style="color:#800000">This cannot be undone.</b>',
        async () => {
          showLoading(true)
          const r = await kubeAPI.deleteResource({
            resourceType: state.currentType,
            name:         res.name,
            namespace:    res.namespace
          })
          showLoading(false)
          if (r.error) alert('Delete failed: ' + r.error)
          else await loadResources()
        }
      )
      break

    case 'settings':
      openSettingsDialog()
      break

    case 'columns':
      if (state.currentType) openColumnsDialog()
      break

    case 'toggle-detail': {
      const dp = document.getElementById('detail-panel')
      const hr = document.getElementById('h-resizer')
      const hidden = dp.style.display === 'none'
      dp.style.display = hidden ? '' : 'none'
      hr.style.display = hidden ? '' : 'none'
      break
    }

    case 'ns-all':
      document.getElementById('addr-namespace').value = 'all'
      state.currentNamespace = 'all'
      setStatus('NS: all', 'st-namespace')
      if (state.currentType) await loadResources()
      break

    case 'exit':
      kubeAPI.close()
      break

    case 'about':
      document.getElementById('confirm-cancel').style.display = 'none'
      showConfirmDialog(
        '<b>k95s v0.1.0</b><br><br>' +
        'A Windows 95-themed Kubernetes UI.<br>' +
        'Like k9s, but clickable.<br><br>' +
        'Built with Electron + @kubernetes/client-node.<br><br>' +
        '<i>Sadly fully vibecoded, this is the only line written by a human. 😢</i>',
        null
      )
      break
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
function setupKeyboard () {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5')                                handleAction('refresh')
    if (e.key === 'Delete' && state.selectedResource)  handleAction('delete')
    if (e.key === 'ArrowDown') moveSelection(1)
    if (e.key === 'ArrowUp')   moveSelection(-1)
    if (e.key === 'Enter' && state.selectedResource)   handleAction('describe')
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      document.getElementById('search-input').focus()
    }
  })
}

function moveSelection (delta) {
  if (!state.resources.length) return
  const next = Math.max(0, Math.min(state.resources.length - 1, state.selectedIndex + delta))
  selectRow(next)
  const row = document.querySelector(`#resource-table tbody tr[data-idx="${next}"]`)
  if (row) row.scrollIntoView({ block: 'nearest' })
}

// ---------------------------------------------------------------------------
// Resize panels
// ---------------------------------------------------------------------------
function setupResizers () {
  // Left panel ↔ right panel
  const vRes  = document.getElementById('v-resizer')
  const leftP = document.getElementById('left-panel')
  let dragging = false, startX = 0, startW = 0

  vRes.addEventListener('mousedown', (e) => {
    dragging = true; startX = e.clientX; startW = leftP.offsetWidth
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
  })
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return
    leftP.style.width = Math.max(100, Math.min(400, startW + (e.clientX - startX))) + 'px'
  })
  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = '' }
  })

  // Resource list ↔ detail panel
  const hRes  = document.getElementById('h-resizer')
  const detP  = document.getElementById('detail-panel')
  const mainA = document.getElementById('main-area')
  let hDragging = false, startY = 0, startH = 0

  hRes.addEventListener('mousedown', (e) => {
    hDragging = true; startY = e.clientY; startH = detP.offsetHeight
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'
  })
  document.addEventListener('mousemove', (e) => {
    if (!hDragging) return
    const h = Math.max(40, Math.min(mainA.offsetHeight * 0.8, startH - (e.clientY - startY)))
    detP.style.height = h + 'px'
  })
  document.addEventListener('mouseup', () => {
    if (hDragging) { hDragging = false; document.body.style.cursor = ''; document.body.style.userSelect = '' }
  })
}

function setupSubPanelResizer () {
  const resizer  = document.getElementById('sub-v-resizer')
  const subPanel = document.getElementById('sub-panel')
  let dragging = false, startX = 0, startW = 0

  resizer.addEventListener('mousedown', (e) => {
    dragging = true; startX = e.clientX; startW = subPanel.offsetWidth
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
  })
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return
    subPanel.style.width = Math.max(150, Math.min(600, startW - (e.clientX - startX))) + 'px'
  })
  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = '' }
  })
}

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------
function setupSettingsDialog () {
  document.getElementById('settings-close').addEventListener('click', closeSettingsDialog)
  document.getElementById('settings-cancel').addEventListener('click', closeSettingsDialog)
  document.getElementById('settings-ok').addEventListener('click', applySettings)
  document.getElementById('settings-apply').addEventListener('click', applySettings)
  document.getElementById('set-browse').addEventListener('click', async () => {
    const fp = await kubeAPI.pickKubeconfigFile()
    if (fp) {
      document.getElementById('set-kubeconfig').value = fp
      await refreshContextList(fp)
    }
  })
  document.getElementById('set-kubeconfig').addEventListener('change', async (e) => {
    await refreshContextList(e.target.value)
  })
}

async function openSettingsDialog () {
  const settings = await kubeAPI.getSettings()
  document.getElementById('set-kubeconfig').value = settings.kubeconfigPath || ''
  document.getElementById('set-namespace').value  = settings.currentNamespace || 'default'
  await refreshContextList(settings.kubeconfigPath)
  const ctxSel = document.getElementById('set-context')
  if (settings.currentContext) ctxSel.value = settings.currentContext
  document.getElementById('settings-overlay').classList.add('visible')
}

function closeSettingsDialog () {
  document.getElementById('settings-overlay').classList.remove('visible')
}

async function refreshContextList (kubeconfigPath) {
  await kubeAPI.setSettings({ kubeconfigPath: kubeconfigPath || '' })
  const { contexts, current } = await kubeAPI.getContexts()
  const sel = document.getElementById('set-context')
  sel.innerHTML = '<option value="">(use default)</option>'
  ;(contexts || []).forEach(ctx => {
    const opt = document.createElement('option')
    opt.value = ctx; opt.textContent = ctx
    if (ctx === current) opt.selected = true
    sel.appendChild(opt)
  })
}

async function applySettings () {
  const settings = {
    kubeconfigPath:   document.getElementById('set-kubeconfig').value.trim(),
    currentContext:   document.getElementById('set-context').value,
    currentNamespace: document.getElementById('set-namespace').value.trim() || 'default'
  }
  await kubeAPI.setSettings(settings)
  state.currentNamespace = settings.currentNamespace
  closeSettingsDialog()
  await loadContextBar()
  await loadNamespaces()
  if (state.currentType) await loadResources()
}

// ---------------------------------------------------------------------------
// Scale dialog
// ---------------------------------------------------------------------------
function setupScaleDialog () {
  document.getElementById('scale-close').addEventListener('click',  closeScaleDialog)
  document.getElementById('scale-cancel').addEventListener('click', closeScaleDialog)
  document.getElementById('scale-ok').addEventListener('click', async () => {
    const replicas = parseInt(document.getElementById('scale-input').value, 10)
    if (isNaN(replicas) || replicas < 0) return
    closeScaleDialog()
    showLoading(true)
    const res = state.selectedResource
    const r = await kubeAPI.scaleResource({
      resourceType: state.currentType,
      name:         res.name,
      namespace:    res.namespace,
      replicas
    })
    showLoading(false)
    if (r.error) alert('Scale failed: ' + r.error)
    else await loadResources()
  })
}

function showScaleDialog (res) {
  document.getElementById('scale-label').textContent =
    `Replicas for ${res.name} (current: ${res.replicas ?? '?'})`
  document.getElementById('scale-input').value = res.replicas ?? 1
  document.getElementById('scale-overlay').classList.add('visible')
  document.getElementById('scale-input').focus()
  document.getElementById('scale-input').select()
}

function closeScaleDialog () {
  document.getElementById('scale-overlay').classList.remove('visible')
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------
let _confirmCb = null

function setupConfirmDialog () {
  document.getElementById('confirm-ok').addEventListener('click', () => {
    const cb = _confirmCb
    closeConfirmDialog()
    if (cb) cb()
  })
  document.getElementById('confirm-cancel').addEventListener('click', closeConfirmDialog)
}

function showConfirmDialog (msg, onOk) {
  document.getElementById('confirm-msg').innerHTML = msg
  document.getElementById('confirm-cancel').style.display = ''
  _confirmCb = onOk
  document.getElementById('confirm-overlay').classList.add('visible')
}

function closeConfirmDialog () {
  document.getElementById('confirm-overlay').classList.remove('visible')
  _confirmCb = null
}

// ---------------------------------------------------------------------------
// Columns dialog
// ---------------------------------------------------------------------------
function setupColumnsDialog () {
  document.getElementById('columns-close').addEventListener('click',  closeColumnsDialog)
  document.getElementById('columns-cancel').addEventListener('click', closeColumnsDialog)
  document.getElementById('columns-ok').addEventListener('click', () => {
    if (!state.currentType) { closeColumnsDialog(); return }
    const hidden = new Set()
    document.querySelectorAll('#columns-checkboxes input[type=checkbox]').forEach(cb => {
      if (!cb.checked) hidden.add(cb.dataset.key)
    })
    // Always keep at least one column visible
    const allKeys = (COLUMNS[state.currentType] || []).map(c => c.key)
    if (allKeys.every(k => hidden.has(k))) hidden.delete(allKeys[0])
    state.hiddenCols[state.currentType] = hidden
    closeColumnsDialog()
    renderTable(state.resources)
  })
  document.getElementById('columns-reset').addEventListener('click', () => {
    if (state.currentType) {
      delete state.hiddenCols[state.currentType]
      closeColumnsDialog()
      renderTable(state.resources)
    }
  })
}

function openColumnsDialog () {
  const type   = state.currentType
  const cols   = COLUMNS[type] || []
  const hidden = state.hiddenCols[type] || new Set()
  const box    = document.getElementById('columns-checkboxes')

  box.innerHTML = cols.map(c => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none">
      <input type="checkbox" data-key="${c.key}" ${hidden.has(c.key) ? '' : 'checked'}>
      ${escHtml(c.label)}
    </label>`).join('')

  document.getElementById('columns-overlay').classList.add('visible')
}

function closeColumnsDialog () {
  document.getElementById('columns-overlay').classList.remove('visible')
}

// ---------------------------------------------------------------------------
// Custom resource types
// ---------------------------------------------------------------------------
async function loadCustomTypes () {
  const settings = await kubeAPI.getSettings()
  const types = settings.customResourceTypes || []
  state.customTypes = {}
  types.forEach(t => { state.customTypes[t.id] = t })
  renderCustomTree()
}

function renderCustomTree () {
  const container = document.getElementById('cat-custom')
  const types     = Object.values(state.customTypes)

  const items = types.map(t => `
    <div class="tree-item" data-type="custom:${escHtml(t.id)}" data-custom-id="${escHtml(t.id)}">
      <img src="icons/w98_gears.ico" class="ico16" alt=""> ${escHtml(t.name)}
    </div>`).join('')

  container.innerHTML = items + `
    <div class="tree-item tree-item-add" id="tree-add-custom">
      <img src="icons/w98_file_question.ico" class="ico16" alt=""> Add resource\u2026
    </div>`

  // Highlight current selection if still valid
  if (state.currentType && state.currentType.startsWith('custom:')) {
    const el = container.querySelector(`[data-type="${state.currentType}"]`)
    if (el) el.classList.add('selected')
  }

  container.querySelectorAll('.tree-item[data-type]').forEach(item => {
    item.addEventListener('click', () => selectResourceType(item.dataset.type))
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      showCustomTreeContextMenu(e.clientX, e.clientY, item.dataset.customId)
    })
  })

  const addBtn = document.getElementById('tree-add-custom')
  if (addBtn) addBtn.addEventListener('click', openAddCustomDialog)
}

function confirmRemoveCustomType (id) {
  const cfg = state.customTypes[id]
  if (!cfg) return
  showConfirmDialog(
    `Remove custom resource <b>${escHtml(cfg.name)}</b> from the tree?`,
    async () => {
      const settings = await kubeAPI.getSettings()
      const types    = (settings.customResourceTypes || []).filter(t => t.id !== id)
      await kubeAPI.setSettings({ customResourceTypes: types })
      delete state.customTypes[id]
      if (state.currentType === `custom:${id}`) {
        state.currentType      = null
        state.resources        = []
        state.selectedResource = null
        document.getElementById('resource-list').innerHTML =
          '<div class="empty-state">Select a resource type from the left panel to get started.</div>'
        document.getElementById('resource-list-title').textContent = 'Select a resource type'
      }
      renderCustomTree()
    }
  )
}

function setupAddCustomDialog () {
  document.getElementById('add-custom-close').addEventListener('click',  closeAddCustomDialog)
  document.getElementById('add-custom-cancel').addEventListener('click', closeAddCustomDialog)

  document.getElementById('add-custom-ok').addEventListener('click', async () => {
    const name       = document.getElementById('custom-name').value.trim()
    const group      = document.getElementById('custom-group').value.trim()
    const version    = document.getElementById('custom-version').value.trim()
    const plural     = document.getElementById('custom-plural').value.trim()
    const namespaced = document.getElementById('custom-namespaced').checked

    if (!name || !group || !version || !plural) {
      alert('All fields are required.')
      return
    }

    const editingId = document.getElementById('add-custom-overlay').dataset.editingId
    const settings  = await kubeAPI.getSettings()
    const types     = settings.customResourceTypes || []

    if (editingId) {
      // Update existing
      const idx = types.findIndex(t => t.id === editingId)
      if (idx >= 0) {
        types[idx] = { ...types[idx], name, group, version, plural, namespaced }
        state.customTypes[editingId] = types[idx]
      }
    } else {
      // Add new
      const id = `${group}__${plural}__${Date.now()}`
      types.push({ id, name, group, version, plural, namespaced })
      state.customTypes[id] = { id, name, group, version, plural, namespaced }
    }

    await kubeAPI.setSettings({ customResourceTypes: types })
    renderCustomTree()
    closeAddCustomDialog()

    if (!editingId) {
      const newId = types[types.length - 1].id
      selectResourceType(`custom:${newId}`)
    }
  })
}

function openAddCustomDialog () {
  document.getElementById('add-custom-title').textContent = 'Add Custom Resource'
  document.getElementById('add-custom-overlay').dataset.editingId = ''
  document.getElementById('custom-name').value    = ''
  document.getElementById('custom-group').value   = ''
  document.getElementById('custom-version').value = 'v1'
  document.getElementById('custom-plural').value  = ''
  document.getElementById('custom-namespaced').checked = true
  document.getElementById('add-custom-overlay').classList.add('visible')
}

function openEditCustomDialog (id) {
  const cfg = state.customTypes[id]
  if (!cfg) return
  document.getElementById('add-custom-title').textContent = 'Edit Custom Resource'
  document.getElementById('add-custom-overlay').dataset.editingId = id
  document.getElementById('custom-name').value    = cfg.name
  document.getElementById('custom-group').value   = cfg.group
  document.getElementById('custom-version').value = cfg.version
  document.getElementById('custom-plural').value  = cfg.plural
  document.getElementById('custom-namespaced').checked = cfg.namespaced !== false
  document.getElementById('add-custom-overlay').classList.add('visible')
}

function closeAddCustomDialog () {
  document.getElementById('add-custom-overlay').classList.remove('visible')
}

// ---------------------------------------------------------------------------
// Pod metrics panel
// ---------------------------------------------------------------------------
function parseCPU (s) {
  if (!s) return null
  const str = String(s)
  if (str.endsWith('n')) return parseInt(str) / 1_000_000  // nanocores → millicores
  if (str.endsWith('u')) return parseInt(str) / 1_000      // microcores → millicores
  if (str.endsWith('m')) return parseInt(str)               // millicores
  return parseFloat(str) * 1000                             // cores → millicores
}

function parseMemory (s) {
  if (!s) return null
  const str   = String(s)
  const units = [
    ['Ti', 1024 ** 4], ['Gi', 1024 ** 3], ['Mi', 1024 ** 2], ['Ki', 1024],
    ['T', 1e12], ['G', 1e9], ['M', 1e6], ['K', 1e3]
  ]
  for (const [u, m] of units) {
    if (str.endsWith(u)) return parseFloat(str) * m
  }
  return parseInt(str)
}

function fmtCPU (milli) {
  if (milli === null || milli === undefined) return '\u2014'
  if (milli >= 1000) return (milli / 1000).toFixed(2) + ' cores'
  return Math.round(milli) + 'm'
}

function fmtMem (bytes) {
  if (bytes === null || bytes === undefined) return '\u2014'
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GiB'
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(1) + ' MiB'
  if (bytes >= 1024)      return (bytes / 1024).toFixed(1) + ' KiB'
  return bytes + ' B'
}

function makeMetricsBar (usage, request, limit) {
  const max = limit || request || usage || 1
  if (!usage && !request && !limit) {
    return '<div class="metrics-bar"><div class="metrics-bar-fill" style="width:0%"></div></div>'
  }
  const usagePct = usage   ? Math.min(100, (usage   / max) * 100) : 0
  const reqPct   = request ? Math.min(100, (request / max) * 100) : 0

  let color = '#008000'
  if (request && usage !== null && usage > request)         color = '#800000'
  else if (request && usage !== null && usage > request * 0.7) color = '#808000'

  const reqLine = request
    ? `<div class="metrics-bar-req" style="left:${reqPct.toFixed(1)}%"></div>`
    : ''

  return `<div class="metrics-bar">${reqLine}<div class="metrics-bar-fill" style="width:${usagePct.toFixed(1)}%;background:${color}"></div></div>`
}

function renderPodMetrics (pod, metricsData) {
  const el = document.getElementById('sub-pod-list')

  if (metricsData && metricsData.error) {
    if (/404|not found/i.test(metricsData.error)) {
      el.innerHTML = '<div class="empty-state">Metrics server unavailable.<br>Install metrics-server to enable resource usage.</div>'
    } else {
      el.innerHTML = `<div class="error-state">\u26a0 ${escHtml(metricsData.error)}</div>`
    }
    return
  }

  const containerResources = pod.containerResources || []
  const usageMap = {}
  ;((metricsData && metricsData.containers) || []).forEach(c => { usageMap[c.name] = c.usage })

  if (!containerResources.length) {
    el.innerHTML = '<div class="empty-state">No container data.</div>'
    return
  }

  el.innerHTML = containerResources.map(cr => {
    const u          = usageMap[cr.name] || {}
    const cpuUsage   = parseCPU(u.cpu)
    const cpuReq     = parseCPU(cr.cpuRequest)
    const cpuLim     = parseCPU(cr.cpuLimit)
    const memUsage   = parseMemory(u.memory)
    const memReq     = parseMemory(cr.memRequest)
    const memLim     = parseMemory(cr.memLimit)

    return `
      <div class="metrics-container">
        <div class="metrics-cname">${escHtml(cr.name)}</div>
        <div class="metrics-row">
          <span class="metrics-label">CPU</span>
          <div class="metrics-bar-wrap">${makeMetricsBar(cpuUsage, cpuReq, cpuLim)}</div>
          <span class="metrics-values">${fmtCPU(cpuUsage)}<br><span class="dim">req:${fmtCPU(cpuReq)} lim:${fmtCPU(cpuLim)}</span></span>
        </div>
        <div class="metrics-row">
          <span class="metrics-label">Mem</span>
          <div class="metrics-bar-wrap">${makeMetricsBar(memUsage, memReq, memLim)}</div>
          <span class="metrics-values">${fmtMem(memUsage)}<br><span class="dim">req:${fmtMem(memReq)} lim:${fmtMem(memLim)}</span></span>
        </div>
      </div>`
  }).join('')
}

function stopMetricsRefresh () {
  if (state.metricsInterval !== null) {
    clearInterval(state.metricsInterval)
    state.metricsInterval = null
  }
}

async function loadPodMetrics () {
  const pod = state.selectedResource
  if (!pod) return

  stopMetricsRefresh()
  showSubPanel(`Resource Usage \u2014 ${pod.name}`)
  document.getElementById('sub-pod-list').innerHTML =
    '<div class="empty-state">Loading metrics\u2026</div>'

  const doRefresh = async () => {
    if (!state.selectedResource || state.currentType !== 'pods') {
      stopMetricsRefresh()
      return
    }
    const metrics = await kubeAPI.getPodMetrics({
      name:      state.selectedResource.name,
      namespace: state.selectedResource.namespace
    })
    renderPodMetrics(state.selectedResource, metrics)
  }

  await doRefresh()
  state.metricsInterval = setInterval(doRefresh, 5000)
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', init)

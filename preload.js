'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kubeAPI', {
  // Window controls
  minimize:  () => ipcRenderer.invoke('window:minimize'),
  maximize:  () => ipcRenderer.invoke('window:maximize'),
  close:     () => ipcRenderer.invoke('window:close'),

  // Settings
  getSettings:      ()  => ipcRenderer.invoke('settings:get'),
  setSettings:      (s) => ipcRenderer.invoke('settings:set', s),
  pickKubeconfigFile: () => ipcRenderer.invoke('settings:pickFile'),

  // Contexts
  getContexts: ()    => ipcRenderer.invoke('k8s:getContexts'),
  setContext:  (ctx) => ipcRenderer.invoke('k8s:setContext', ctx),

  // Namespaces
  getNamespaces: () => ipcRenderer.invoke('k8s:getNamespaces'),

  // Resources
  getResources: (opts) => ipcRenderer.invoke('k8s:getResources', opts),

  // Detail views
  describe:  (opts) => ipcRenderer.invoke('k8s:describe', opts),
  getLogs:   (opts) => ipcRenderer.invoke('k8s:getLogs', opts),
  getYaml:   (opts) => ipcRenderer.invoke('k8s:getYaml', opts),

  // Actions
  deleteResource:  (opts) => ipcRenderer.invoke('k8s:delete', opts),
  scaleResource:   (opts) => ipcRenderer.invoke('k8s:scale', opts),
  restartResource: (opts) => ipcRenderer.invoke('k8s:rolloutRestart', opts),

  // Custom resources (CRDs)
  listCustomResource: (opts) => ipcRenderer.invoke('k8s:listCustomResource', opts),

  // Pod metrics
  getPodMetrics: (opts) => ipcRenderer.invoke('k8s:getPodMetrics', opts),

  // Sub-resources (owned pods)
  getOwnedPods: (opts) => ipcRenderer.invoke('k8s:getOwnedPods', opts),

  // Diagnostics
  getDiagnostics: () => ipcRenderer.invoke('k8s:getDiagnostics')
})

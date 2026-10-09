import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannel, type HootApi } from '../shared/ipc'

function subscribe<Args extends unknown[]>(
  channel: string,
  listener: (...args: Args) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as Args))
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: HootApi = {
  testHooks: process.argv.includes('--hoot-test-hooks'),
  listProjects: () => ipcRenderer.invoke(IpcChannel.listProjects),
  addProject: () => ipcRenderer.invoke(IpcChannel.addProject),
  removeProject: (root) => ipcRenderer.invoke(IpcChannel.removeProject, root),
  onProjectsChanged: (listener) => subscribe(IpcChannel.projectsChanged, listener),
  onAddProjectRequested: (listener) => subscribe(IpcChannel.addProjectRequested, listener),
  getTools: () => ipcRenderer.invoke(IpcChannel.getTools),
  redetectTools: () => ipcRenderer.invoke(IpcChannel.redetectTools),
  onToolsChanged: (listener) => subscribe(IpcChannel.toolsChanged, listener),
  getPermissionLevels: () => ipcRenderer.invoke(IpcChannel.getPermissionLevels),
  onPermissionLevelsChanged: (listener) => subscribe(IpcChannel.permissionLevelsChanged, listener),
  listSessions: () => ipcRenderer.invoke(IpcChannel.listSessions),
  startSession: (request) => ipcRenderer.invoke(IpcChannel.startSession, request),
  closeSession: (id) => ipcRenderer.invoke(IpcChannel.closeSession, id),
  writeSession: (id, data, binary = false) =>
    ipcRenderer.send(IpcChannel.writeSession, id, data, binary),
  resizeSession: (id, cols, rows) => ipcRenderer.send(IpcChannel.resizeSession, id, cols, rows),
  onSessionData: (listener) => subscribe(IpcChannel.sessionData, listener),
  onSessionUpdated: (listener) => subscribe(IpcChannel.sessionUpdated, listener),
  onSessionCommand: (listener) => subscribe(IpcChannel.sessionCommand, listener),
  getWindowState: () => ipcRenderer.invoke(IpcChannel.getWindowState),
  setSidebarOpen: (open) => ipcRenderer.send(IpcChannel.setSidebarOpen, open),
  onToggleSidebarRequested: (listener) => subscribe(IpcChannel.toggleSidebarRequested, listener),
  onFullScreenChanged: (listener) => subscribe(IpcChannel.fullScreenChanged, listener),
  onConfirmQuit: (listener) => subscribe(IpcChannel.confirmQuit, listener),
  respondToQuit: (confirmed) => ipcRenderer.send(IpcChannel.quitResponse, confirmed),
}

contextBridge.exposeInMainWorld('hoot', api)

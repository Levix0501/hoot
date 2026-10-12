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
  getStartupState: () => ipcRenderer.invoke(IpcChannel.getStartupState),
  revealDatabase: () => ipcRenderer.send(IpcChannel.revealDatabase),
  quit: () => ipcRenderer.send(IpcChannel.quit),
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
  setProjectExpanded: (projectId, expanded) =>
    ipcRenderer.send(IpcChannel.setProjectExpanded, projectId, expanded),
  onToggleSidebarRequested: (listener) => subscribe(IpcChannel.toggleSidebarRequested, listener),
  onFullScreenChanged: (listener) => subscribe(IpcChannel.fullScreenChanged, listener),
  onConfirmQuit: (listener) => subscribe(IpcChannel.confirmQuit, listener),
  respondToQuit: (confirmed) => ipcRenderer.send(IpcChannel.quitResponse, confirmed),
  listWorktrees: () => ipcRenderer.invoke(IpcChannel.listWorktrees),
  currentWorktree: (projectRoot, worktreePath) =>
    ipcRenderer.invoke(IpcChannel.currentWorktree, projectRoot, worktreePath),
  onWorktreesChanged: (listener) => subscribe(IpcChannel.worktreesChanged, listener),
  getNewWorktreeOptions: (projectRoot) =>
    ipcRenderer.invoke(IpcChannel.newWorktreeOptions, projectRoot),
  checkBranchName: (name) => ipcRenderer.invoke(IpcChannel.checkBranchName, name),
  previewWorktreePath: (projectRoot, branch) =>
    ipcRenderer.invoke(IpcChannel.previewWorktreePath, projectRoot, branch),
  getWorktreeSubmodules: (projectRoot, participants) =>
    ipcRenderer.invoke(IpcChannel.worktreeSubmodules, projectRoot, participants),
  createWorktree: (request) => ipcRenderer.invoke(IpcChannel.createWorktree, request),
  inspectWorktree: (projectRoot, worktreePath) =>
    ipcRenderer.invoke(IpcChannel.inspectWorktree, projectRoot, worktreePath),
  deleteWorktree: (projectRoot, worktreePath, discard) =>
    ipcRenderer.invoke(IpcChannel.deleteWorktree, projectRoot, worktreePath, discard),
  removeWorktree: (projectRoot, worktreePath) =>
    ipcRenderer.invoke(IpcChannel.removeWorktree, projectRoot, worktreePath),
  revealWorktree: (projectRoot, worktreePath) =>
    ipcRenderer.send(IpcChannel.revealWorktree, projectRoot, worktreePath),
  copyWorktreePath: (projectRoot, worktreePath) =>
    ipcRenderer.send(IpcChannel.copyWorktreePath, projectRoot, worktreePath),
  listIssues: (projectId) => ipcRenderer.invoke(IpcChannel.listIssues, projectId),
  createIssue: (issue) => ipcRenderer.invoke(IpcChannel.createIssue, issue),
  updateIssue: (id, changes) => ipcRenderer.invoke(IpcChannel.updateIssue, id, changes),
  deleteIssue: (id) => ipcRenderer.invoke(IpcChannel.deleteIssue, id),
  writeClipboardText: (text) => ipcRenderer.send(IpcChannel.writeClipboardText, text),
  openExternalLink: (url) => ipcRenderer.send(IpcChannel.openExternalLink, url),
}

contextBridge.exposeInMainWorld('hoot', api)

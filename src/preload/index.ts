import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { fileManagerName } from '../shared/file-manager'
import { IpcChannel, type HootApi } from '../shared/ipc'
import { managesAgents } from '../shared/managed-agents'
import { windowControlsFromArguments } from '../shared/window-controls'

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
  windowControls: windowControlsFromArguments(process.argv),
  fileManager: fileManagerName(process.platform),
  manageAgents: managesAgents(process.platform),
  getStartupState: () => ipcRenderer.invoke(IpcChannel.getStartupState),
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
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
  getAgents: () => ipcRenderer.invoke(IpcChannel.getAgents),
  detectAgents: () => ipcRenderer.send(IpcChannel.detectAgents),
  onAgentsChanged: (listener) => subscribe(IpcChannel.agentsChanged, listener),
  installAgent: (id) => ipcRenderer.send(IpcChannel.installAgent, id),
  updateAgent: (id) => ipcRenderer.send(IpcChannel.updateAgent, id),
  cancelAgentOperation: (id) => ipcRenderer.send(IpcChannel.cancelAgentOperation, id),
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
  setSidebarWidth: (width) => ipcRenderer.send(IpcChannel.setSidebarWidth, width),
  setProjectExpanded: (projectId, expanded) =>
    ipcRenderer.send(IpcChannel.setProjectExpanded, projectId, expanded),
  onToggleSidebarRequested: (listener) => subscribe(IpcChannel.toggleSidebarRequested, listener),
  onFullScreenChanged: (listener) => subscribe(IpcChannel.fullScreenChanged, listener),
  onShowSettingsRequested: (listener) => subscribe(IpcChannel.showSettingsRequested, listener),
  onShowAboutRequested: (listener) => subscribe(IpcChannel.showAboutRequested, listener),
  getAppearance: () => ipcRenderer.invoke(IpcChannel.getAppearance),
  setAppearance: (appearance) => ipcRenderer.send(IpcChannel.setAppearance, appearance),
  onAppearanceChanged: (listener) => subscribe(IpcChannel.appearanceChanged, listener),
  onConfirmQuit: (listener) => subscribe(IpcChannel.confirmQuit, listener),
  respondToQuit: (confirmed) => ipcRenderer.send(IpcChannel.quitResponse, confirmed),
  getUpdateStatus: () => ipcRenderer.invoke(IpcChannel.getUpdateStatus),
  onUpdateStatusChanged: (listener) => subscribe(IpcChannel.updateStatusChanged, listener),
  checkForUpdates: () => ipcRenderer.send(IpcChannel.checkForUpdates),
  installUpdate: () => ipcRenderer.send(IpcChannel.installUpdate),
  onUpdateFailed: (listener) => subscribe(IpcChannel.updateFailed, listener),
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
  createIssueWorktree: (projectRoot, issueId) =>
    ipcRenderer.invoke(IpcChannel.createIssueWorktree, projectRoot, issueId),
  readWorktrees: (projectRoot) => ipcRenderer.invoke(IpcChannel.readWorktrees, projectRoot),
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
  listIssues: () => ipcRenderer.invoke(IpcChannel.listIssues),
  createIssue: (issue) => ipcRenderer.invoke(IpcChannel.createIssue, issue),
  updateIssue: (id, changes) => ipcRenderer.invoke(IpcChannel.updateIssue, id, changes),
  deleteIssue: (id) => ipcRenderer.invoke(IpcChannel.deleteIssue, id),
  onIssueCreated: (listener) => subscribe(IpcChannel.issueCreated, listener),
  createSubIssue: (parentId, issue) =>
    ipcRenderer.invoke(IpcChannel.createSubIssue, parentId, issue),
  listSubIssues: () => ipcRenderer.invoke(IpcChannel.listSubIssues),
  setIssueParents: (changes) => ipcRenderer.invoke(IpcChannel.setIssueParents, changes),
  onSubIssuesChanged: (listener) => subscribe(IpcChannel.subIssuesChanged, listener),
  listWorkflowRecords: () => ipcRenderer.invoke(IpcChannel.listWorkflowRecords),
  onWorkflowChanged: (listener) => subscribe(IpcChannel.workflowChanged, listener),
  reportStep: (issueId, run, outcome) =>
    ipcRenderer.invoke(IpcChannel.reportStep, issueId, run, outcome),
  startOverWorkflow: (issueId) => ipcRenderer.invoke(IpcChannel.startOverWorkflow, issueId),
  writeClipboardText: (text) => ipcRenderer.send(IpcChannel.writeClipboardText, text),
  openExternalLink: (url) => ipcRenderer.send(IpcChannel.openExternalLink, url),
}

contextBridge.exposeInMainWorld('hoot', api)

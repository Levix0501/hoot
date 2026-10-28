import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { fileManagerName } from '../shared/file-manager'
import { IpcChannel, type HootApi } from '../shared/ipc'
import { managesAgents } from '../shared/managed-agents'
import { windowControlsFromArguments } from '../shared/window-controls'
import { windowsPtyFor } from '../shared/windows-pty'

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
  windowsClipboardKeys: process.platform === 'win32',
  fileManager: fileManagerName(process.platform),
  manageAgents: managesAgents(process.platform),
  windowsPty: windowsPtyFor(process.platform, process.getSystemVersion()),
  getStartupState: () => ipcRenderer.invoke(IpcChannel.getStartupState),
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
  revealDatabase: () => ipcRenderer.send(IpcChannel.revealDatabase),
  quit: () => ipcRenderer.send(IpcChannel.quit),
  listProjects: () => ipcRenderer.invoke(IpcChannel.listProjects),
  addProject: () => ipcRenderer.invoke(IpcChannel.addProject),
  addProjectConfirmed: (confirmation) =>
    ipcRenderer.invoke(IpcChannel.addProjectConfirmed, confirmation),
  removeProject: (root) => ipcRenderer.invoke(IpcChannel.removeProject, root),
  onProjectsChanged: (listener) => subscribe(IpcChannel.projectsChanged, listener),
  onAddProjectRequested: (listener) => subscribe(IpcChannel.addProjectRequested, listener),
  getTools: () => ipcRenderer.invoke(IpcChannel.getTools),
  onToolsChanged: (listener) => subscribe(IpcChannel.toolsChanged, listener),
  getAgents: () => ipcRenderer.invoke(IpcChannel.getAgents),
  enterAgentsPage: () => ipcRenderer.send(IpcChannel.enterAgentsPage),
  detectAgents: () => ipcRenderer.send(IpcChannel.detectAgents),
  onAgentsChanged: (listener) => subscribe(IpcChannel.agentsChanged, listener),
  installAgent: (id) => ipcRenderer.send(IpcChannel.installAgent, id),
  updateAgent: (id) => ipcRenderer.send(IpcChannel.updateAgent, id),
  updateAllAgents: () => ipcRenderer.send(IpcChannel.updateAllAgents),
  cancelAgentOperation: (id) => ipcRenderer.send(IpcChannel.cancelAgentOperation, id),
  getLaunchSettings: () => ipcRenderer.invoke(IpcChannel.getLaunchSettings),
  setDefaultAgent: (id) => ipcRenderer.send(IpcChannel.setDefaultAgent, id),
  setYoloMode: (on) => ipcRenderer.send(IpcChannel.setYoloMode, on),
  setConfirmClose: (on) => ipcRenderer.send(IpcChannel.setConfirmClose, on),
  setAgentLaunchSettings: (id, change) =>
    ipcRenderer.send(IpcChannel.setAgentLaunchSettings, id, change),
  onLaunchSettingsChanged: (listener) => subscribe(IpcChannel.launchSettingsChanged, listener),
  listSessions: () => ipcRenderer.invoke(IpcChannel.listSessions),
  startSession: (request) => ipcRenderer.invoke(IpcChannel.startSession, request),
  closeSession: (id) => ipcRenderer.invoke(IpcChannel.closeSession, id),
  writeSession: (id, data, binary = false) =>
    ipcRenderer.send(IpcChannel.writeSession, id, data, binary),
  resizeSession: (id, cols, rows) => ipcRenderer.send(IpcChannel.resizeSession, id, cols, rows),
  onSessionData: (listener) => subscribe(IpcChannel.sessionData, listener),
  onSessionUpdated: (listener) => subscribe(IpcChannel.sessionUpdated, listener),
  onSessionHookEvent: (listener) => subscribe(IpcChannel.sessionHookEvent, listener),
  onSessionCommand: (listener) => subscribe(IpcChannel.sessionCommand, listener),
  listChats: () => ipcRenderer.invoke(IpcChannel.listChats),
  createChat: (toolId) => ipcRenderer.invoke(IpcChannel.createChat, toolId),
  renameChat: (id, name) => ipcRenderer.send(IpcChannel.renameChat, id, name),
  setChatTitle: (id, title) => ipcRenderer.send(IpcChannel.setChatTitle, id, title),
  deleteChat: (id) => ipcRenderer.invoke(IpcChannel.deleteChat, id),
  onChatsChanged: (listener) => subscribe(IpcChannel.chatsChanged, listener),
  listSavedSessions: () => ipcRenderer.invoke(IpcChannel.listSavedSessions),
  createSavedSession: (projectRoot, worktreePath, toolId) =>
    ipcRenderer.invoke(IpcChannel.createSavedSession, projectRoot, worktreePath, toolId),
  renameSavedSession: (id, name) => ipcRenderer.send(IpcChannel.renameSavedSession, id, name),
  setSavedSessionTitle: (id, title) => ipcRenderer.send(IpcChannel.setSavedSessionTitle, id, title),
  deleteSavedSession: (id) => ipcRenderer.invoke(IpcChannel.deleteSavedSession, id),
  onSavedSessionsChanged: (listener) => subscribe(IpcChannel.savedSessionsChanged, listener),
  getWindowState: () => ipcRenderer.invoke(IpcChannel.getWindowState),
  setSidebarOpen: (open) => ipcRenderer.send(IpcChannel.setSidebarOpen, open),
  setSidebarWidth: (width) => ipcRenderer.send(IpcChannel.setSidebarWidth, width),
  setProjectExpanded: (projectId, expanded) =>
    ipcRenderer.send(IpcChannel.setProjectExpanded, projectId, expanded),
  setWorktreeExpanded: (projectRoot, worktreePath, expanded) =>
    ipcRenderer.send(IpcChannel.setWorktreeExpanded, projectRoot, worktreePath, expanded),
  setLocalExpanded: (projectRoot, expanded) =>
    ipcRenderer.send(IpcChannel.setLocalExpanded, projectRoot, expanded),
  onToggleSidebarRequested: (listener) => subscribe(IpcChannel.toggleSidebarRequested, listener),
  onFullScreenChanged: (listener) => subscribe(IpcChannel.fullScreenChanged, listener),
  onWindowFocusChanged: (listener) => subscribe(IpcChannel.windowFocusChanged, listener),
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
  onWorktreesRemoved: (listener) => subscribe(IpcChannel.worktreesRemoved, listener),
  getNewWorktreeOptions: (projectRoot) =>
    ipcRenderer.invoke(IpcChannel.newWorktreeOptions, projectRoot),
  getWorktreeSubmodules: (projectRoot, participants) =>
    ipcRenderer.invoke(IpcChannel.worktreeSubmodules, projectRoot, participants),
  createWorktree: (request) => ipcRenderer.invoke(IpcChannel.createWorktree, request),
  createIssueWorktree: (projectRoot, issueId) =>
    ipcRenderer.invoke(IpcChannel.createIssueWorktree, projectRoot, issueId),
  readWorktrees: (projectRoot) => ipcRenderer.invoke(IpcChannel.readWorktrees, projectRoot),
  inspectWorktree: (projectRoot, worktreePath) =>
    ipcRenderer.invoke(IpcChannel.inspectWorktree, projectRoot, worktreePath),
  deleteWorktree: (projectRoot, worktreePath, discard, deleteBranches) =>
    ipcRenderer.invoke(
      IpcChannel.deleteWorktree,
      projectRoot,
      worktreePath,
      discard,
      deleteBranches,
    ),
  removeWorktree: (projectRoot, worktreePath) =>
    ipcRenderer.invoke(IpcChannel.removeWorktree, projectRoot, worktreePath),
  startMerge: (projectRoot, worktreePath, toolId) =>
    ipcRenderer.invoke(IpcChannel.startMerge, projectRoot, worktreePath, toolId),
  revealWorktree: (projectRoot, worktreePath) =>
    ipcRenderer.send(IpcChannel.revealWorktree, projectRoot, worktreePath),
  copyWorktreePath: (projectRoot, worktreePath) =>
    ipcRenderer.send(IpcChannel.copyWorktreePath, projectRoot, worktreePath),
  listProjectFolders: () => ipcRenderer.invoke(IpcChannel.listProjectFolders),
  onProjectFolderChanged: (listener) => subscribe(IpcChannel.projectFolderChanged, listener),
  revealProjectFolder: (projectRoot) =>
    ipcRenderer.send(IpcChannel.revealProjectFolder, projectRoot),
  copyProjectFolderPath: (projectRoot) =>
    ipcRenderer.send(IpcChannel.copyProjectFolderPath, projectRoot),
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
  listDependencies: () => ipcRenderer.invoke(IpcChannel.listDependencies),
  changeDependencies: (change) => ipcRenderer.invoke(IpcChannel.changeDependencies, change),
  createDependentIssue: (issue, dependency) =>
    ipcRenderer.invoke(IpcChannel.createDependentIssue, issue, dependency),
  onDependenciesChanged: (listener) => subscribe(IpcChannel.dependenciesChanged, listener),
  onIssuesChanged: (listener) => subscribe(IpcChannel.issuesChanged, listener),
  listLabels: () => ipcRenderer.invoke(IpcChannel.listLabels),
  onLabelsChanged: (listener) => subscribe(IpcChannel.labelsChanged, listener),
  listLabelEvents: () => ipcRenderer.invoke(IpcChannel.listLabelEvents),
  onLabelEventsAdded: (listener) => subscribe(IpcChannel.labelEventsAdded, listener),
  createLabel: (label) => ipcRenderer.invoke(IpcChannel.createLabel, label),
  editLabel: (id, changes) => ipcRenderer.invoke(IpcChannel.editLabel, id, changes),
  deleteLabel: (id) => ipcRenderer.invoke(IpcChannel.deleteLabel, id),
  createLabelGroup: (name) => ipcRenderer.invoke(IpcChannel.createLabelGroup, name),
  deleteLabelGroup: (id) => ipcRenderer.invoke(IpcChannel.deleteLabelGroup, id),
  changeIssueLabels: (issueId, change) =>
    ipcRenderer.invoke(IpcChannel.changeIssueLabels, issueId, change),
  onSessionStartRequested: (listener) => subscribe(IpcChannel.sessionStartRequested, listener),
  answerSessionStart: (requestId, answer) =>
    ipcRenderer.send(IpcChannel.answerSessionStart, requestId, answer),
  writeClipboardText: (text) => ipcRenderer.send(IpcChannel.writeClipboardText, text),
  openExternalLink: (url) => ipcRenderer.send(IpcChannel.openExternalLink, url),
}

contextBridge.exposeInMainWorld('hoot', api)

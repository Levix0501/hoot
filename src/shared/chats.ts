import type { ToolsState } from './ipc'
import type { LaunchSettings } from './launch-settings'
import { sessionAgent, usableAgents, type Agent, type ProvidersState } from './providers'
import { sessionName } from './session'
import { toolStatus } from './tool-status'
import { getTool, type CodingToolId, type ToolId } from './tools'

/**
 * A chat: a conversation with an agent that belongs to no project, which Hoot
 * keeps in the database and lists in the sidebar's Chats group.
 */
export interface ChatInfo {
  id: string
  toolId: CodingToolId
  /**
   * The folder the agent runs in: the chat's own folder under `~/.hoot/chats`,
   * the root of a saved session's worktree, or for a saved session in its
   * project's own folder, that folder.
   */
  folder: string
  /** The root of the project of a saved session; `null` for a chat. */
  projectRoot: string | null
  /**
   * The root of the worktree a saved session runs in; `null` for a chat, and
   * for a saved session in its project's own folder.
   */
  worktreePath: string | null
  /** The agent's own id of the conversation the chat is in; `null` until it is known. */
  conversationId: string | null
  /** The terminal title the agent last set in the conversation; empty until it sets one. */
  title: string
  /** The name the user gave the chat, if any. */
  customName: string | null
  /** Whether the conversation has been sent a message. */
  hasMessages: boolean
  /** Milliseconds since the Unix epoch, when Hoot made the chat. */
  createdAt: number
  /** Milliseconds since the Unix epoch, when the chat was last opened. */
  lastOpenedAt: number
  /**
   * The provider its agent runs on (see `Provider`), which it keeps when its
   * agent changes or goes, so that its conversation goes on where it began;
   * `null` for one made before providers, which runs on its agent's own
   * configuration until Hoot records the provider that names.
   */
  providerId: string | null
  /** The model it started with; `null` for its agent's default. */
  model: string | null
  /**
   * The agent it was made with, whose effort level and extra arguments its
   * sessions take while that agent is there; `null` for none.
   */
  agentId: string | null
}

/**
 * A saved session: an agent session Hoot keeps and lists below its worktree,
 * or below its project's Local row for one in the project's own folder, which
 * it continues when the user opens it again. It is a chat of a worktree or of
 * the project folder instead of a folder of its own.
 */
export interface SavedSessionInfo extends ChatInfo {
  projectRoot: string
  /** The root of the worktree it runs in, or `null` for one in the project's own folder. */
  worktreePath: string | null
}

/**
 * A chat or saved session the user archived: out of the sidebar until it is
 * unarchived or deleted for good from the settings' Archive page.
 */
export interface ArchivedSessionInfo extends ChatInfo {
  /** Milliseconds since the Unix epoch, when the user archived it. */
  archivedAt: number
}

/** Whether a chat is a saved session, of a project's worktree or of its own folder. */
export function isSavedSession(chat: ChatInfo): chat is SavedSessionInfo {
  return chat.projectRoot !== null
}

/**
 * Whether a chat is a saved session in its project's own folder, which the
 * project's Local row lists, rather than in one of its worktrees.
 */
export function inProjectFolder(chat: Pick<ChatInfo, 'projectRoot' | 'worktreePath'>): boolean {
  return chat.projectRoot !== null && chat.worktreePath === null
}

/** The name Hoot shows for a chat: the one the user gave it, else the agent's title, else the agent's name. */
export function chatName(chat: {
  toolId: ToolId
  title: string
  customName: string | null
}): string {
  return sessionName(chat)
}

/**
 * The agents a new chat can use (see `usableAgents`): those of the coding
 * tools the last detection found installed. Until the first detection has
 * finished, and until the agents are known, none is.
 */
export function usableChatAgents(tools: ToolsState, providers: ProvidersState | null): Agent[] {
  if (providers === null) return []
  return usableAgents(providers, (harness) => toolStatus(tools, getTool(harness)) === 'available')
}

/**
 * Whether the agents are still being found for the first time since Hoot
 * started. A later detection leaves the last one's results in place, which
 * New chat and its menu use meanwhile.
 */
export function firstDetectionRunning(tools: ToolsState): boolean {
  return tools.detecting && tools.tools.length === 0
}

/**
 * Whether the agents are still being found for the first time since Hoot
 * started: the coding tools installed (see `firstDetectionRunning`), and the
 * agents, until the window has them.
 */
export function agentsChecking(tools: ToolsState, providers: ProvidersState | null): boolean {
  return firstDetectionRunning(tools) || providers === null
}

/**
 * The agent a new chat uses: the one asked for, by id, when it is among the
 * usable ones, else the default agent while it is usable, else the first
 * usable agent in the order of `usableChatAgents`; `null` when no agent is
 * usable. Without one asked for, the agent the menus mark Default.
 */
export function chatAgent(
  tools: ToolsState,
  providers: ProvidersState | null,
  launchSettings: LaunchSettings | null,
  asked: string | null = null,
): Agent | null {
  return sessionAgent(
    usableChatAgents(tools, providers),
    launchSettings?.defaultAgent ?? null,
    asked,
  )
}

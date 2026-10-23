import type { ToolsState } from './ipc'
import { agentEnabled, type LaunchSettings } from './launch-settings'
import { sessionName } from './session'
import { toolStatus } from './tool-status'
import { CODING_TOOL_IDS, getTool, type CodingToolId, type ToolId } from './tools'

/**
 * A chat: a conversation with an agent that belongs to no project, which Hoot
 * keeps in the database and lists in the sidebar's Chats group.
 */
export interface ChatInfo {
  id: string
  toolId: CodingToolId
  /**
   * The folder the agent runs in: the chat's own folder under `~/.hoot/chats`,
   * or the root of a saved session's worktree.
   */
  folder: string
  /** The root of the project of a saved session's worktree; `null` for a chat. */
  projectRoot: string | null
  /** The root of the worktree a saved session runs in; `null` for a chat. */
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
}

/**
 * A saved session: an agent session Hoot keeps and lists below its worktree,
 * which it continues when the user opens it again. It is a chat of a worktree
 * instead of a folder of its own.
 */
export interface SavedSessionInfo extends ChatInfo {
  projectRoot: string
  worktreePath: string
}

/** Whether a chat is a saved session, whose worktree Hoot opened it in. */
export function isSavedSession(chat: ChatInfo): chat is SavedSessionInfo {
  return chat.worktreePath !== null
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
 * The agents a new chat can use: those the last detection found installed,
 * which the Agents page does not have turned off, in the order Claude Code,
 * Codex and OpenCode. Until the first detection has finished, none is.
 */
export function usableChatAgents(
  tools: ToolsState,
  launchSettings: LaunchSettings | null,
): CodingToolId[] {
  return CODING_TOOL_IDS.filter(
    (id) => agentEnabled(launchSettings, id) && toolStatus(tools, getTool(id)) === 'available',
  )
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
 * The agent a new chat uses: the one asked for when it is among the usable
 * ones, else the default agent while it is usable, else the first usable
 * agent in the order of `usableChatAgents`; `null` when no agent is usable.
 */
export function chatAgent(
  tools: ToolsState,
  launchSettings: LaunchSettings | null,
  asked: CodingToolId | null = null,
): CodingToolId | null {
  const usable = usableChatAgents(tools, launchSettings)
  if (asked !== null && usable.includes(asked)) return asked
  const preferred = launchSettings?.defaultAgent ?? 'claude'
  if (usable.includes(preferred)) return preferred
  return usable[0] ?? null
}

/** Whether the default agent is among the usable agents, which the agent menu marks Default. */
export function defaultAgentUsable(
  tools: ToolsState,
  launchSettings: LaunchSettings | null,
): boolean {
  const preferred = launchSettings?.defaultAgent ?? 'claude'
  return usableChatAgents(tools, launchSettings).includes(preferred)
}

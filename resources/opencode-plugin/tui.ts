// Hoot's plugin for OpenCode 2, which tells Hoot which conversation each message
// the user sends in an OpenCode session of Hoot's goes to. Hoot gives it to
// every OpenCode session it starts, in the session's OPENCODE_CLI_CONFIG_CONTENT,
// and OpenCode's terminal interface runs it in the session's own process,
// TypeScript and all. It reports a message by running hoot's `hook` command
// with Hoot's own executable, as hoot's launchers run hoot, with the input a
// Codex hook gives it. It shows nothing and changes nothing in OpenCode: in an
// OpenCode Hoot did not start, it does nothing at all.
import { spawn } from 'node:child_process'

/**
 * The variable Hoot sets in the environment of the OpenCode sessions it
 * starts, and of no other session, for this plugin: `HOOT_OPENCODE_PLUGIN`
 * in `HOOT_ENV`.
 */
export const HOOT_OPENCODE_PLUGIN = 'HOOT_OPENCODE_PLUGIN'

/** What the plugin reads of an event of OpenCode's server. */
export interface OpenCodeEvent {
  readonly type: string
  /** Where it happened. */
  readonly location?: { readonly directory?: string }
  readonly data?: {
    readonly sessionID?: string
    readonly item?: { readonly type?: string }
  }
}

/** What the plugin reads of a conversation, which OpenCode calls a session. */
interface Conversation {
  /** The conversation it is a subagent's in, which the user sends no message in itself. */
  readonly parentID?: string
  /** The folder OpenCode records it in. */
  readonly location?: { readonly directory?: string }
}

/** What the plugin reads of the context OpenCode sets it up with. */
export interface PluginContext {
  readonly data: {
    listen(handler: (event: { readonly details: OpenCodeEvent }) => void): () => void
    readonly session: { get(sessionID: string): Conversation | undefined }
  }
  readonly ui: {
    readonly router: { current(): { readonly type: string; readonly sessionID?: string } }
  }
}

/** What tells hoot's `hook` command of a message, as the input of a Codex hook does. */
export interface MessageReport {
  readonly hook_event_name: 'UserPromptSubmit'
  /** The conversation the message went to. */
  readonly session_id: string
  /** The folder of that conversation. */
  readonly cwd?: string
}

/**
 * What tells Hoot of the conversation a message went to, for an event of
 * OpenCode's server that tells of one the user sent, in the conversation this
 * session's OpenCode shows: OpenCode's background server sends every window
 * the events of all of them, and the window a message comes from is the one
 * that shows its conversation as the event comes. With the folder OpenCode
 * records the conversation in, or else the one the event names. `null` for
 * any other event, and for a message in a subagent's conversation.
 */
export function messageReport(context: PluginContext, event: OpenCodeEvent): MessageReport | null {
  if (event.type !== 'session.inbox.enqueued' || event.data?.item?.type !== 'user') return null
  const sessionID = event.data.sessionID
  if (typeof sessionID !== 'string' || sessionID === '') return null
  const route = context.ui.router.current()
  if (route.type !== 'session' || route.sessionID !== sessionID) return null
  const conversation = context.data.session.get(sessionID)
  if (conversation?.parentID) return null
  const folder = conversation?.location?.directory ?? event.location?.directory
  return {
    hook_event_name: 'UserPromptSubmit',
    session_id: sessionID,
    ...(typeof folder === 'string' && folder !== '' ? { cwd: folder } : {}),
  }
}

/**
 * Runs hoot's `hook` command with a report on its input, as the launchers of
 * hoot run hoot: with Hoot's executable as Node.js, without the options of
 * the user's own Node.js. It shows nothing of what it prints, and goes on in
 * the background.
 */
function send(node: string, cli: string, report: MessageReport): void {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    const upper = name.toUpperCase()
    if (value !== undefined && upper !== 'NODE_OPTIONS' && upper !== 'ELECTRON_RUN_AS_NODE') {
      env[name] = value
    }
  }
  env.ELECTRON_RUN_AS_NODE = '1'
  const child = spawn(node, [cli, 'hook'], {
    env,
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
  })
  child.on('error', () => {})
  child.stdin.on('error', () => {})
  child.stdin.end(JSON.stringify(report))
}

export default {
  id: 'hoot',
  setup(context: PluginContext): (() => void) | undefined {
    const env = process.env
    const node = env.HOOT_NODE
    const cli = env.HOOT_CLI
    if (env[HOOT_OPENCODE_PLUGIN] !== '1' || !node || !cli) return undefined
    if (!env.HOOT_SOCKET || !env.HOOT_SESSION_ID) return undefined
    try {
      return context.data.listen(({ details }) => {
        try {
          const report = messageReport(context, details)
          if (report !== null) send(node, cli, report)
        } catch {
          // Hoot learns no conversation from this message; OpenCode goes on as it would.
        }
      })
    } catch {
      // An OpenCode whose plugins work otherwise: Hoot reads its records instead.
      return undefined
    }
  },
}

import type { CodingToolId } from './tools'

/** One of a coding tool's own permission modes, which a session of the tool can start in. */
export interface PermissionLevel {
  /** Identifies the level in the saved settings. */
  id: string
  /** Shown in the Agents menu and in the new session menu. */
  label: string
  /**
   * The arguments the tool runs with, and its only ones. They select the
   * permission mode explicitly, so the mode never depends on the tool's own
   * configuration defaults (OpenCode's Standard level is OpenCode without
   * `--auto`).
   */
  args: readonly string[]
}

/**
 * The permission levels of each coding tool, in menu order. The first is the
 * tool's highest level: it asks for no permission at all, and it is what the
 * tool starts with until the user picks another level.
 */
export const PERMISSION_LEVELS: Readonly<Record<CodingToolId, readonly PermissionLevel[]>> = {
  claude: [
    {
      id: 'bypass-permissions',
      label: 'Bypass permissions',
      args: ['--dangerously-skip-permissions'],
    },
    { id: 'auto', label: 'Auto', args: ['--permission-mode', 'auto'] },
    { id: 'accept-edits', label: 'Accept edits', args: ['--permission-mode', 'acceptEdits'] },
    { id: 'plan', label: 'Plan', args: ['--permission-mode', 'plan'] },
    { id: 'manual', label: 'Manual', args: ['--permission-mode', 'manual'] },
  ],
  codex: [
    {
      id: 'full-access',
      label: 'Full Access',
      args: ['--dangerously-bypass-approvals-and-sandbox'],
    },
    {
      id: 'default',
      label: 'Default',
      args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
    },
    {
      id: 'read-only',
      label: 'Read Only',
      args: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'],
    },
  ],
  opencode: [
    { id: 'auto-approve', label: 'Auto-approve', args: ['--auto'] },
    { id: 'standard', label: 'Standard', args: [] },
  ],
}

/** The id of the selected permission level of each coding tool. */
export type PermissionLevelSettings = Readonly<Record<CodingToolId, string>>

/** The level `id` names among the tool's levels, if any. */
export function findPermissionLevel(tool: CodingToolId, id: unknown): PermissionLevel | undefined {
  return PERMISSION_LEVELS[tool].find((level) => level.id === id)
}

/** The tool's highest level, used until the user picks another one. */
export function defaultPermissionLevel(tool: CodingToolId): PermissionLevel {
  const [highest] = PERMISSION_LEVELS[tool]
  if (!highest) throw new Error(`No permission levels for ${tool}`)
  return highest
}

/** The level `id` names, or the tool's highest level when `id` names none of its levels. */
export function permissionLevelOrDefault(tool: CodingToolId, id: unknown): PermissionLevel {
  return findPermissionLevel(tool, id) ?? defaultPermissionLevel(tool)
}

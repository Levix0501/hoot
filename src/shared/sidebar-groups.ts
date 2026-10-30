/**
 * The groups of the sidebar that their titles expand and collapse: the
 * projects and the chats.
 */
export const SIDEBAR_GROUPS = ['projects', 'chats'] as const

export type SidebarGroupId = (typeof SIDEBAR_GROUPS)[number]

export function isSidebarGroup(value: unknown): value is SidebarGroupId {
  return typeof value === 'string' && (SIDEBAR_GROUPS as readonly string[]).includes(value)
}

import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { agentsMenuTemplate } from './agents-menu'

function submenu(item: MenuItemConstructorOptions | undefined): MenuItemConstructorOptions[] {
  const items = item?.submenu
  if (!Array.isArray(items)) throw new Error(`${item?.label ?? 'item'} has no submenu`)
  return items
}

function click(item: MenuItemConstructorOptions | undefined): void {
  const action = item?.click as (() => void) | undefined
  if (!action) throw new Error(`${item?.label ?? 'item'} has no action`)
  action()
}

describe('agentsMenuTemplate', () => {
  it('lists the levels of each coding tool as radio items and checks the selected ones', () => {
    const menu = agentsMenuTemplate({
      selected: { claude: 'plan', codex: 'full-access', opencode: 'standard' },
      selectPermissionLevel: () => {},
    })
    expect(menu.label).toBe('Agents')
    const tools = submenu(menu)
    expect(tools.map((tool) => tool.label)).toEqual(['Claude Code', 'Codex', 'OpenCode'])
    expect(
      tools.map((tool) =>
        submenu(tool).map((level) => [level.label, level.type, level.checked ?? false]),
      ),
    ).toEqual([
      [
        ['Bypass permissions', 'radio', false],
        ['Auto', 'radio', false],
        ['Accept edits', 'radio', false],
        ['Plan', 'radio', true],
        ['Manual', 'radio', false],
      ],
      [
        ['Full Access', 'radio', true],
        ['Default', 'radio', false],
        ['Read Only', 'radio', false],
      ],
      [
        ['Auto-approve', 'radio', false],
        ['Standard', 'radio', true],
      ],
    ])
  })

  it('selects the level of the tool whose item is clicked', () => {
    const selections: Array<[string, string]> = []
    const menu = agentsMenuTemplate({
      selected: { claude: 'bypass-permissions', codex: 'full-access', opencode: 'auto-approve' },
      selectPermissionLevel: (tool, level) => selections.push([tool, level]),
    })
    const [claude, codex] = submenu(menu)
    click(submenu(codex).find((item) => item.label === 'Read Only'))
    click(submenu(claude).find((item) => item.label === 'Manual'))
    expect(selections).toEqual([
      ['codex', 'read-only'],
      ['claude', 'manual'],
    ])
  })
})

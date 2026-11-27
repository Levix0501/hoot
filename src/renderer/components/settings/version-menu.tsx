import {
  ChevronDownIcon,
  CircleArrowUpIcon,
  HistoryIcon,
  LockIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react'
import type { AgentFollow, AgentState } from '../../../shared/agents'
import { useAppStore } from '../../store/app-store'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/** A copy of an agent the user asked to uninstall, which the confirmation names. */
export interface UninstallAsk {
  /** Its command's path. */
  path: string
  version: string | null
  /** Whether it is the copy in use, which the agent's sessions run. */
  inUse: boolean
}

/** A version the menu lists, with the day it came out as the list writes it. */
interface VersionChoice {
  version: string
  date: string
  installed: boolean
}

/** A day as the menu writes it: Nov 23, with the year only when it is not this one. */
function shortDate(day: string | null): string {
  if (day === null) return ''
  const date = new Date(`${day}T12:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** The versions the menu lists: those the agent offers, with the installed one where they lack it. */
function versionsOf(agent: AgentState): VersionChoice[] {
  const installed = agent.installation?.version ?? null
  const list = (agent.releases ?? []).map((release) => ({
    version: release.version,
    date: shortDate(release.date),
    installed: release.version === installed,
  }))
  if (installed !== null && list.length > 0 && !list.some((choice) => choice.installed)) {
    list.unshift({ version: installed, date: '', installed: true })
  }
  return list
}

/** What the agent follows, as the value of the menu's radio items. */
function selectedOf(follow: AgentFollow): string {
  return follow.kind === 'stay' ? follow.version : follow.kind
}

/** What a radio item's value asks the agent to follow. */
function followOf(value: string): AgentFollow {
  if (value === 'latest' || value === 'stable') return { kind: value }
  return { kind: 'stay', version: value }
}

/** The version Stay keeps: the one the agent stays on, or else the installed one. */
function stayVersionOf(agent: AgentState): string | null {
  return agent.follow.kind === 'stay' ? agent.follow.version : (agent.installation?.version ?? null)
}

function isPending(agent: AgentState): boolean {
  return agent.operation?.status === 'waiting' || agent.operation?.status === 'running'
}

const MUTED_ICON = 'text-muted-foreground'

/** A channel's row: its icon, its name, and the version it is on now. */
function ChannelText({ stable, version }: { stable: boolean; version: string | null }) {
  const Icon = stable ? ShieldCheckIcon : CircleArrowUpIcon
  return (
    <>
      <Icon className={MUTED_ICON} />
      <span className="flex-1">{stable ? 'Stable' : 'Latest'}</span>
      {version !== null && (
        <span className="text-xs text-muted-foreground tabular-nums">{version}</span>
      )}
    </>
  )
}

/** The destructive look of a submenu trigger, like that of a destructive item. */
const DESTRUCTIVE_SUB =
  'text-destructive focus:bg-destructive/10 focus:text-destructive data-open:bg-destructive/10 data-open:text-destructive data-popup-open:bg-destructive/10 data-popup-open:text-destructive dark:focus:bg-destructive/20 dark:data-open:bg-destructive/20 dark:data-popup-open:bg-destructive/20'

/**
 * Uninstall, at the menu's foot: one item for the copy in use, or, where the
 * computer has others, a submenu of every copy, the one in use first.
 */
function UninstallEntry({
  agent,
  onUninstall,
}: {
  agent: AgentState
  onUninstall: (ask: UninstallAsk) => void
}) {
  const installation = agent.installation
  if (installation === null) return null
  const id = agent.id
  const pending = isPending(agent)
  if (agent.copies.length === 0) {
    return (
      <DropdownMenuItem
        variant="destructive"
        disabled={pending}
        onClick={() =>
          onUninstall({ path: installation.path, version: installation.version, inUse: true })
        }
        data-testid={`agent-uninstall-${id}`}
      >
        <Trash2Icon />
        Uninstall
      </DropdownMenuItem>
    )
  }
  const copies = [
    {
      path: installation.path,
      version: installation.version,
      removable: installation.removable,
      status: 'In use',
      inUse: true,
    },
    ...agent.copies.map((copy) => ({
      path: copy.path,
      version: copy.version,
      removable: copy.removable,
      status: copy.runs ? '' : "Doesn't run",
      inUse: false,
    })),
  ]
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        data-variant="destructive"
        disabled={pending}
        className={DESTRUCTIVE_SUB}
        data-testid={`agent-uninstall-${id}`}
      >
        <Trash2Icon />
        Uninstall
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48" data-testid={`agent-uninstall-menu-${id}`}>
        {copies.map((copy, index) => (
          <DropdownMenuItem
            key={copy.path}
            disabled={pending || !copy.removable}
            onClick={() =>
              onUninstall({ path: copy.path, version: copy.version, inUse: copy.inUse })
            }
            data-testid={`agent-uninstall-copy-${id}-${index}`}
          >
            <span className="tabular-nums">{copy.version ?? 'Unknown version'}</span>
            <span className="ml-auto pl-3 text-xs text-muted-foreground">{copy.status}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Brings the checked version into sight when the list opens scrolled away from it. */
function revealChecked(list: HTMLDivElement | null) {
  const item = list?.querySelector<HTMLElement>('[aria-checked="true"]')
  if (!list || !item) return
  const top = item.offsetTop
  if (top < list.scrollTop || top + item.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = top - (list.clientHeight - item.offsetHeight) / 2
  }
}

/**
 * The version button of an installed agent's row, with a lock while it
 * stays on its version, and its menu: what it follows, its latest version,
 * Claude Code's Stable, or staying on the installed one; the other versions
 * it offers, newest first, picking one of which installs it and stays on
 * it; and Uninstall. Where Hoot cannot install versions in its place, only
 * Latest and Stay are offered.
 */
export function VersionMenu({
  agent,
  onUninstall,
}: {
  agent: AgentState
  onUninstall: (ask: UninstallAsk) => void
}) {
  const setFollow = useAppStore((state) => state.setAgentFollow)
  const installation = agent.installation
  if (installation === null || installation.version === null) return null
  const id = agent.id
  const pending = isPending(agent)
  const switchable = installation.switchable
  const versions = switchable ? versionsOf(agent) : []
  const stable = id === 'claude' && switchable && agent.stable !== null ? agent.stable : null
  const stayOn = stayVersionOf(agent)
  const selected = selectedOf(agent.follow)
  const pick = (value: unknown) => setFollow(id, followOf(String(value)))
  const uninstallable = installation.removable || agent.copies.some((copy) => copy.removable)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 font-normal text-muted-foreground"
            data-testid={`agent-version-${id}`}
          />
        }
      >
        {agent.follow.kind === 'stay' && (
          <LockIcon className="size-3" data-testid={`agent-lock-${id}`} />
        )}
        {installation.version}
        <ChevronDownIcon className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" data-testid={`agent-version-menu-${id}`}>
        <DropdownMenuRadioGroup value={selected} onValueChange={pick}>
          <DropdownMenuRadioItem
            closeOnClick
            value="latest"
            disabled={pending}
            data-testid={`agent-follow-latest-${id}`}
          >
            <ChannelText stable={false} version={agent.latest} />
          </DropdownMenuRadioItem>
          {stable !== null && (
            <DropdownMenuRadioItem
              closeOnClick
              value="stable"
              disabled={pending}
              data-testid={`agent-follow-stable-${id}`}
            >
              <ChannelText stable version={stable} />
            </DropdownMenuRadioItem>
          )}
          {stayOn !== null && (
            <DropdownMenuRadioItem
              closeOnClick
              value={stayOn}
              disabled={pending}
              data-testid={`agent-follow-stay-${id}`}
            >
              <LockIcon className={MUTED_ICON} />
              <span className="flex-1">
                Stay on <span className="tabular-nums">{stayOn}</span>
              </span>
            </DropdownMenuRadioItem>
          )}
        </DropdownMenuRadioGroup>
        {versions.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={pending} data-testid={`agent-other-versions-${id}`}>
                <HistoryIcon className={MUTED_ICON} />
                Other versions
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                ref={revealChecked}
                className="max-h-[min(20rem,var(--available-height))] w-60"
                data-testid={`agent-versions-${id}`}
              >
                <DropdownMenuRadioGroup value={selected} onValueChange={pick}>
                  {versions.map((choice) => (
                    <DropdownMenuRadioItem
                      closeOnClick
                      key={choice.version}
                      value={choice.version}
                      data-testid={`agent-pick-${id}-${choice.version}`}
                    >
                      <span className="tabular-nums">{choice.version}</span>
                      {choice.installed && (
                        <Badge
                          variant="outline"
                          className="h-4.5 px-1.5 font-normal text-muted-foreground"
                          data-testid={`agent-installed-${id}`}
                        >
                          Installed
                        </Badge>
                      )}
                      <span className="ml-auto pl-3 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {choice.date}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        {uninstallable && (
          <>
            <DropdownMenuSeparator />
            <UninstallEntry agent={agent} onUninstall={onUninstall} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { PlusIcon, SearchIcon } from 'lucide-react'
import { cn } from 'cn'
import { useState, type ReactNode } from 'react'
import { presetHarnesses, PROVIDER_PRESETS, type ProviderPreset } from '../../../shared/providers'
import { toolStatus } from '../../../shared/tool-status'
import { CODING_TOOL_IDS, getTool, type CodingToolId } from '../../../shared/tools'
import { customMatches, presetMatches } from '../../lib/provider-draft'
import { useAppStore } from '../../store/app-store'
import { ProviderMarkIcon } from '../provider-icon'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../ui/input-group'
import { SheetTitle } from '../ui/sheet'

/** The harnesses installed, as the last detection found them, in their order. */
export function useInstalled(): CodingToolId[] {
  const tools = useAppStore((state) => state.tools)
  return CODING_TOOL_IDS.filter((id) => toolStatus(tools, getTool(id)) === 'available')
}

interface Section {
  id: 'vendor' | 'gateway'
  title: string
  presets: ProviderPreset[]
}

const GROUP_TITLES = { vendor: 'Vendors', gateway: 'Gateways' } as const

/**
 * The presets offered for a search, makers of models first, then gateways,
 * each by name; for an agent's picker, only those its harness can run.
 */
function sectionsOf(query: string, harness: CodingToolId | null): Section[] {
  const presets = PROVIDER_PRESETS.filter(
    (preset) =>
      presetMatches(preset, query) &&
      (harness === null || presetHarnesses(preset).includes(harness)),
  )
  return (['vendor', 'gateway'] as const)
    .map((group) => ({
      id: group,
      title: GROUP_TITLES[group],
      presets: presets.filter((preset) => preset.group === group),
    }))
    .filter((section) => section.presets.length > 0)
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{children}</div>
}

/** A preset to pick, or one of the user's own; dimmed while no installed agent can run it. */
function PresetTile({
  preset,
  onPick,
  bordered = false,
}: {
  preset: ProviderPreset | null
  onPick: () => void
  bordered?: boolean
}) {
  const installed = useInstalled()
  const unusable =
    preset !== null && !presetHarnesses(preset).some((harness) => installed.includes(harness))
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex h-10 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
        bordered && 'h-11 border bg-background px-3 hover:bg-muted/60',
        unusable && 'text-muted-foreground',
      )}
      data-testid={`provider-preset-${preset?.id ?? 'custom'}`}
    >
      {preset === null ? (
        <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <ProviderMarkIcon
          mark={preset.mark}
          className={cn('size-5 shrink-0', unusable && 'opacity-50')}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{preset === null ? 'Custom' : preset.name}</span>
    </button>
  )
}

/** The id of the catalog's search, which the Providers page's Add provider focuses. */
export const CATALOG_SEARCH = 'provider-catalog-search'

/**
 * Every preset, on the Providers page below the user's providers, as cards
 * of makers of models and of gateways, then one of the user's own; one
 * picked opens its form (`null` for one of the user's own).
 */
export function ProviderCatalog({ onPick }: { onPick: (presetId: string | null) => void }) {
  const [query, setQuery] = useState('')
  const sections = sectionsOf(query, null)
  return (
    <div className="flex flex-col gap-3" data-testid="provider-catalog">
      <div className="flex items-center justify-between gap-4 pt-2">
        <h2 className="text-sm font-medium">Add a provider</h2>
        <InputGroup className="w-56">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            id={CATALOG_SEARCH}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              const first = sections[0]?.presets[0]
              if (first !== undefined) onPick(first.id)
              else if (customMatches(query)) onPick(null)
            }}
            placeholder="Search"
            aria-label="Search providers"
          />
        </InputGroup>
      </div>
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col">
          <div className="-mx-2">
            <SectionTitle>{section.title}</SectionTitle>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {section.presets.map((preset) => (
              <PresetTile
                key={preset.id}
                preset={preset}
                bordered
                onPick={() => onPick(preset.id)}
              />
            ))}
          </div>
        </div>
      ))}
      {customMatches(query) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <PresetTile preset={null} bordered onPick={() => onPick(null)} />
        </div>
      )}
    </div>
  )
}

/**
 * The presets a harness can run, in the panel that adds a provider for one
 * of its agents: a search atop them, then their tiles, one of the user's own
 * last; one picked, or the first found with Enter, opens its form.
 */
export function PresetPicker({
  harness,
  onPick,
}: {
  harness: CodingToolId
  onPick: (preset: ProviderPreset | null) => void
}) {
  const [query, setQuery] = useState('')
  const sections = sectionsOf(query, harness)
  const first = sections[0]?.presets[0]
  return (
    <div className="flex h-full flex-col" data-testid="add-provider-picker">
      <SheetTitle className="sr-only">Add provider</SheetTitle>
      <div className="flex items-center gap-2.5 border-b px-5 pt-5 pb-4">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            if (first !== undefined) onPick(first)
            else if (customMatches(query)) onPick(null)
          }}
          placeholder="Search providers…"
          aria-label="Search providers"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          data-testid="add-provider-search"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {sections.map((section) => (
          <div key={section.id} className="pb-1">
            <SectionTitle>{section.title}</SectionTitle>
            <div className="grid grid-cols-2 gap-0.5">
              {section.presets.map((preset) => (
                <PresetTile key={preset.id} preset={preset} onPick={() => onPick(preset)} />
              ))}
            </div>
          </div>
        ))}
        {customMatches(query) && (
          <div className="mt-1 grid grid-cols-2 gap-0.5 border-t pt-1.5">
            <PresetTile preset={null} onPick={() => onPick(null)} />
          </div>
        )}
        {sections.length === 0 && !customMatches(query) && (
          <div className="py-10 text-center text-sm text-muted-foreground">No providers</div>
        )}
      </div>
    </div>
  )
}

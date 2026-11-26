import { ChevronLeftIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { cn } from 'cn'
import { useState, type ReactNode } from 'react'
import { toast } from '../../lib/toast'
import {
  presetById,
  presetHarnesses,
  PROVIDER_PRESETS,
  type ProviderPreset,
} from '../../../shared/providers'
import { toolStatus } from '../../../shared/tool-status'
import { CODING_TOOL_IDS, getTool, type CodingToolId } from '../../../shared/tools'
import {
  canAdd,
  customMatches,
  draftOf,
  newProviderOf,
  presetMatches,
  type FormDraft,
} from '../../lib/provider-draft'
import { useAppStore, type AddingProvider } from '../../store/app-store'
import { ProviderMarkIcon } from '../provider-icon'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '../ui/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../ui/input-group'
import { FormTitleMark, ProviderFields } from './provider-fields'

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
 * picked opens its form.
 */
export function ProviderCatalog() {
  const [query, setQuery] = useState('')
  const sections = sectionsOf(query, null)
  const startAddingProvider = useAppStore((state) => state.startAddingProvider)
  const open = (presetId: string | null) => startAddingProvider({ harness: null, presetId })
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
              if (first !== undefined) open(first.id)
              else if (customMatches(query)) open(null)
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
              <PresetTile key={preset.id} preset={preset} bordered onPick={() => open(preset.id)} />
            ))}
          </div>
        </div>
      ))}
      {customMatches(query) && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <PresetTile preset={null} bordered onPick={() => open(null)} />
        </div>
      )}
    </div>
  )
}

/**
 * The dialog that adds a provider. From the catalog it opens on that
 * preset's form; from an agent's picker, on a search above the presets that
 * agent can run, which one picked turns into its form, the provider added
 * going to the agent.
 */
function AddProviderDialog({ adding, onClose }: { adding: AddingProvider; onClose: () => void }) {
  const catalogs = useAppStore((state) => state.modelCatalogs)
  const providers = useAppStore((state) => state.providers?.providers ?? [])
  const addProvider = useAppStore((state) => state.addProvider)
  const opened = adding.presetId === undefined ? undefined : (presetById(adding.presetId) ?? null)
  // undefined: picking; null: one of the user's own; a preset: its form.
  const [picked, setPicked] = useState<ProviderPreset | null | undefined>(opened)
  const [draft, setDraft] = useState<FormDraft>(() => draftOf(opened ?? null, catalogs))
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const sections = sectionsOf(query, adding.harness)
  const pick = (preset: ProviderPreset | null) => {
    setPicked(preset)
    setDraft(draftOf(preset, catalogs))
  }
  const add = async () => {
    if (picked === undefined || !canAdd(draft, picked) || saving) return
    setSaving(true)
    const result = await addProvider(newProviderOf(draft, picked, providers))
    setSaving(false)
    if (!result.ok) {
      toast.error('Could not add the provider.', { description: result.message })
      return
    }
    adding.onAdded?.(result.provider)
    onClose()
  }
  const first = sections[0]?.presets[0]
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      {picked === undefined ? (
        <DialogContent
          className="gap-0 overflow-hidden p-0 sm:max-w-2xl"
          showCloseButton={false}
          data-testid="add-provider-picker"
        >
          <DialogTitle className="sr-only">Add provider</DialogTitle>
          <div className="flex h-12 items-center gap-2.5 border-b px-4">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                if (first !== undefined) pick(first)
                else if (customMatches(query)) pick(null)
              }}
              placeholder="Search providers…"
              aria-label="Search providers"
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              data-testid="add-provider-search"
            />
          </div>
          <div className="max-h-[min(64vh,560px)] overflow-y-auto p-2">
            {sections.map((section) => (
              <div key={section.id} className="pb-1">
                <SectionTitle>{section.title}</SectionTitle>
                <div className="grid grid-cols-3 gap-0.5">
                  {section.presets.map((preset) => (
                    <PresetTile key={preset.id} preset={preset} onPick={() => pick(preset)} />
                  ))}
                </div>
              </div>
            ))}
            {customMatches(query) && (
              <div className="mt-1 grid grid-cols-3 gap-0.5 border-t pt-1.5">
                <PresetTile preset={null} onPick={() => pick(null)} />
              </div>
            )}
            {sections.length === 0 && !customMatches(query) && (
              <div className="py-10 text-center text-sm text-muted-foreground">No providers</div>
            )}
          </div>
        </DialogContent>
      ) : (
        <DialogContent className="gap-0 p-0 sm:max-w-lg" data-testid="add-provider-dialog">
          <div className="flex h-12 items-center gap-2 px-3">
            {opened === undefined && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                onClick={() => setPicked(undefined)}
              >
                <ChevronLeftIcon />
              </Button>
            )}
            <span className={opened === undefined ? '' : 'pl-1'}>
              <FormTitleMark preset={picked} />
            </span>
            <DialogTitle>{picked === null ? 'Custom provider' : picked.name}</DialogTitle>
          </div>
          <div className="px-4 pt-1 pb-4">
            <ProviderFields
              preset={picked}
              draft={draft}
              onChange={setDraft}
              onSubmit={() => void add()}
            />
          </div>
          <DialogFooter className="mx-0 mb-0">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!canAdd(draft, picked) || saving}
              onClick={() => void add()}
              data-testid="add-provider-save"
            >
              Add provider
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

/** The dialog of the provider being added, wherever adding it began (see `AddingProvider`). */
export function AddProviderHost() {
  const adding = useAppStore((state) => state.addingProvider)
  const stopAddingProvider = useAppStore((state) => state.stopAddingProvider)
  if (adding === null) return null
  return <AddProviderDialog adding={adding} onClose={stopAddingProvider} />
}

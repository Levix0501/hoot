import { ArrowUpRightIcon, EyeIcon, EyeOffIcon, PlusIcon, SearchIcon } from 'lucide-react'
import { cn } from 'cn'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AZURE_PATH,
  catalogModelIds,
  presetPlan,
  type ProviderPreset,
  type WireFormat,
} from '../../../shared/providers'
import { api } from '../../lib/api'
import { addressesOf, draftCatalog, withPlan, type FormDraft } from '../../lib/provider-draft'
import { useAppStore } from '../../store/app-store'
import { ProviderMarkIcon } from '../provider-icon'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

/** A field with its label above it. */
export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

function KeyField({
  value,
  onChange,
  keyUrl,
  autoFocus,
  onEnter,
}: {
  value: string
  onChange: (value: string) => void
  keyUrl: string | null
  autoFocus?: boolean
  onEnter?: () => void
}) {
  const [shown, setShown] = useState(false)
  return (
    <InputGroup>
      <InputGroupInput
        id="provider-key"
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) onEnter?.()
        }}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        placeholder="sk-…"
        className="font-mono text-xs md:text-xs"
        data-testid="provider-key"
      />
      <InputGroupAddon align="inline-end">
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                aria-label={shown ? 'Hide key' : 'Show key'}
                onClick={() => setShown(!shown)}
              />
            }
          >
            {shown ? <EyeOffIcon /> : <EyeIcon />}
          </TooltipTrigger>
          <TooltipContent>{shown ? 'Hide key' : 'Show key'}</TooltipContent>
        </Tooltip>
        {keyUrl !== null && (
          <Tooltip>
            <TooltipTrigger
              render={
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Get a key"
                  onClick={() => api.openExternalLink(keyUrl)}
                />
              }
            >
              <ArrowUpRightIcon />
            </TooltipTrigger>
            <TooltipContent>Get a key</TooltipContent>
          </Tooltip>
        )}
      </InputGroupAddon>
    </InputGroup>
  )
}

/** The picked models first, as picked, then the others, newest first. */
function arranged(all: readonly string[], picked: readonly string[]): string[] {
  return [...picked.filter((id) => all.includes(id)), ...all.filter((id) => !picked.includes(id))]
}

/**
 * The select-all box's dash, while some of the rows shown are picked: drawn
 * here, the box itself having a tick only.
 */
const ALL_BOX =
  'transition-none data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:data-indeterminate:bg-primary [&[data-indeterminate]_svg]:hidden data-indeterminate:before:h-0.5 data-indeterminate:before:w-2 data-indeterminate:before:rounded-full data-indeterminate:before:bg-current'

const ROW =
  'flex h-7 min-w-0 cursor-default items-center gap-2 rounded-md px-1.5 text-sm select-none hover:bg-accent hover:text-accent-foreground group-has-[input:focus]/models:data-highlighted:bg-accent group-has-[input:focus]/models:data-highlighted:text-accent-foreground'

/**
 * The models of a provider, ticked to be offered: its catalog's, newest
 * first, and those typed in, which the search adds when the list has no
 * model of that id. The box before the search, above the rows' boxes, ticks
 * or unticks every row the search shows. The picked ones lead the list as it opens and as each search
 * starts, not while they are being ticked, so that a row stays under the
 * pointer. The arrow keys' row shows while the search has the focus.
 */
function ModelPicker({
  catalog,
  picked,
  onChange,
}: {
  catalog: readonly string[]
  picked: string[]
  onChange: (picked: string[]) => void
}) {
  const [query, setQuery] = useState('')
  // The picks the order was last made with.
  const [leading, setLeading] = useState<string[]>(picked)
  // The models typed in, kept as rows until the next search though unticked.
  const [typed, setTyped] = useState<string[]>(() => picked.filter((id) => !catalog.includes(id)))
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const all = [...typed, ...catalog.filter((id) => !typed.includes(id))]
  const wanted = query.trim()
  const shown = arranged(all, leading).filter((id) =>
    id.toLowerCase().includes(wanted.toLowerCase()),
  )
  const canType = wanted !== '' && !all.includes(wanted)
  const count = shown.length + (canType ? 1 : 0)
  const pickedShown = shown.filter((id) => picked.includes(id)).length
  const allPicked = shown.length > 0 && pickedShown === shown.length

  useEffect(() => {
    // The rows, and the row that adds a model typed in, in the order the keys go through them.
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const search = (text: string) => {
    setQuery(text)
    setLeading(picked)
    setTyped(typed.filter((id) => picked.includes(id)))
    setIndex(0)
  }
  const toggle = (id: string) =>
    onChange(picked.includes(id) ? picked.filter((model) => model !== id) : [...picked, id])
  const toggleAll = () =>
    onChange(
      allPicked
        ? picked.filter((id) => !shown.includes(id))
        : [...picked, ...shown.filter((id) => !picked.includes(id))],
    )
  const type = () => {
    const next = picked.includes(wanted) ? picked : [...picked, wanted]
    onChange(next)
    setTyped([...typed, wanted])
    setQuery('')
    setLeading(next)
    setIndex(0)
  }

  return (
    <div
      className="group/models flex min-w-0 flex-col overflow-hidden rounded-lg border border-input has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 dark:bg-input/30"
      data-testid="provider-models"
    >
      <div className={cn('flex h-8 items-center gap-2 px-2.5', count > 0 && 'border-b')}>
        {catalog.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Checkbox
                  checked={allPicked}
                  indeterminate={pickedShown > 0 && !allPicked}
                  disabled={shown.length === 0}
                  onCheckedChange={toggleAll}
                  aria-label={allPicked ? 'Deselect all' : 'Select all'}
                  className={ALL_BOX}
                  data-testid="provider-models-all"
                />
              }
            />
            <TooltipContent>{allPicked ? 'Deselect all' : 'Select all'}</TooltipContent>
          </Tooltip>
        )}
        {/* The search's own mark, which sets it apart from a row, ticked or not. */}
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => search(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (count === 0) return
              setIndex((index + (event.key === 'ArrowDown' ? 1 : count - 1)) % count)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const id = shown[index]
              if (id !== undefined) toggle(id)
              else if (canType) type()
            }
          }}
          spellCheck={false}
          autoComplete="off"
          placeholder={all.length > 0 ? 'Search models…' : 'Add model…'}
          aria-label="Search models"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          data-testid="provider-models-search"
        />
      </div>
      {count > 0 && (
        <div
          ref={listRef}
          className="max-h-56 overflow-y-auto p-1"
          role="listbox"
          aria-multiselectable
        >
          {shown.map((id, i) => (
            <div
              key={id}
              role="option"
              aria-selected={picked.includes(id)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggle(id)}
              onMouseMove={() => setIndex(i)}
              data-highlighted={i === index ? '' : undefined}
              className={ROW}
              data-testid="provider-model"
              data-model={id}
            >
              <Checkbox
                checked={picked.includes(id)}
                tabIndex={-1}
                className="pointer-events-none transition-none"
              />
              <span className="min-w-0 flex-1 truncate">{id}</span>
            </div>
          ))}
          {canType && (
            <div
              role="option"
              aria-selected={false}
              onMouseDown={(event) => event.preventDefault()}
              onClick={type}
              onMouseMove={() => setIndex(shown.length)}
              data-highlighted={index === shown.length ? '' : undefined}
              className={ROW}
              data-testid="provider-model-add"
            >
              <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Add “{wanted}”</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The formats a provider has an address for, in the order its form lists them. */
const FORMATS: readonly WireFormat[] = ['anthropic', 'responses']

const FORMAT_NAMES: Record<WireFormat, string> = {
  anthropic: 'Anthropic',
  responses: 'Responses',
}

/**
 * A field that is not the user's to change, as a disabled one looks, its
 * text still there to be selected and copied: no ring as it is clicked into,
 * nor a stop of Tab's (see `UrlsField`).
 */
const READ_ONLY =
  'bg-input/50 text-muted-foreground dark:bg-input/80 has-[[data-slot=input-group-control]:focus-visible]:border-input has-[[data-slot=input-group-control]:focus-visible]:ring-0'

/**
 * A provider's addresses, each on one line after its format: one of the
 * user's own's, one for each format, typed in; a preset's, which its plan
 * fixes, read-only (without `onChange`), those it has.
 */
function UrlsField({
  urls,
  onChange,
}: {
  urls: Partial<Record<WireFormat, string>>
  onChange?: (urls: Partial<Record<WireFormat, string>>) => void
}) {
  const formats =
    onChange === undefined ? FORMATS.filter((format) => (urls[format] ?? '') !== '') : FORMATS
  return (
    <div className="flex flex-col gap-1.5">
      {formats.map((format) => (
        <InputGroup key={format} className={cn(onChange === undefined && READ_ONLY)}>
          <InputGroupAddon className="w-20 justify-start text-xs text-muted-foreground">
            {FORMAT_NAMES[format]}
          </InputGroupAddon>
          <InputGroupInput
            value={urls[format] ?? ''}
            readOnly={onChange === undefined}
            tabIndex={onChange === undefined ? -1 : undefined}
            onChange={(event) => onChange?.({ ...urls, [format]: event.target.value })}
            spellCheck={false}
            aria-label={`${FORMAT_NAMES[format]} URL`}
            // One longer than its line ends in an ellipsis, until it is scrolled.
            className={cn(
              'font-mono text-xs md:text-xs',
              onChange === undefined && 'text-ellipsis',
            )}
            data-testid={
              onChange === undefined ? `provider-address-${format}` : `provider-url-${format}`
            }
          />
        </InputGroup>
      ))}
    </div>
  )
}

/** A preset's addresses, which its plan fixes: read-only, to be seen and copied. */
function AddressList({ urls }: { urls: Partial<Record<WireFormat, string>> }) {
  if (FORMATS.every((format) => (urls[format] ?? '') === '')) return null
  return (
    <Field label="Addresses">
      <div data-testid="provider-addresses">
        <UrlsField urls={urls} />
      </div>
    </Field>
  )
}

function PlanField({
  preset,
  draft,
  onChange,
}: {
  preset: ProviderPreset
  draft: FormDraft
  onChange: (draft: FormDraft) => void
}) {
  const catalogs = useAppStore((state) => state.modelCatalogs)
  const plans = preset.plans ?? []
  if (plans.length === 0) return null
  const label = preset.planLabel ?? 'Plan'
  const pick = (value: unknown) => {
    if (typeof value === 'string') onChange(withPlan(draft, preset, value, catalogs))
  }
  if (plans.length <= 3) {
    return (
      <Field label={label}>
        <Tabs value={draft.planId} onValueChange={pick}>
          <TabsList className="w-full">
            {plans.map((plan) => (
              <TabsTrigger key={plan.id} value={plan.id} className="text-xs">
                {plan.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </Field>
    )
  }
  const items = plans.map((plan) => ({ value: plan.id, label: plan.name }))
  return (
    <Field label={label}>
      <Select items={items} value={draft.planId} onValueChange={pick}>
        <SelectTrigger className="w-full" aria-label={label} data-testid="provider-plan">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="start">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/**
 * The fields of a provider being added or edited. A preset's: its plan or
 * region, the addresses that fixes, read-only, what reaches it (a key;
 * Azure's endpoint, the path Hoot adds shown in it; Vertex AI's project) and
 * its models; one of the user's own: its name, addresses, key and models.
 * Edited, a provider's name is the panel's title instead.
 */
export function ProviderFields({
  preset,
  draft,
  onChange,
  onSubmit,
  autoFocusKey = true,
  editing = false,
}: {
  preset: ProviderPreset | null
  draft: FormDraft
  onChange: (draft: FormDraft) => void
  onSubmit: () => void
  autoFocusKey?: boolean
  editing?: boolean
}) {
  const catalogs = useAppStore((state) => state.modelCatalogs)
  const plan = preset === null ? null : presetPlan(preset, draft.planId)
  const keyUrl = plan?.keyUrl ?? preset?.keyUrl ?? null
  const catalog = draftCatalog(draft)
  return (
    <div className="flex flex-col gap-4">
      {preset === null && !editing && (
        <Field label="Name" htmlFor="provider-name">
          <Input
            id="provider-name"
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            autoFocus={autoFocusKey && preset === null}
            data-testid="provider-name"
          />
        </Field>
      )}
      {preset === null && (
        <Field label="Addresses">
          <UrlsField urls={draft.urls} onChange={(urls) => onChange({ ...draft, urls })} />
        </Field>
      )}
      {preset !== null && <PlanField preset={preset} draft={draft} onChange={onChange} />}
      {preset !== null && <AddressList urls={addressesOf(preset, draft)} />}
      {preset?.endpoint !== undefined && (
        <Field label="Endpoint" htmlFor="provider-endpoint">
          <InputGroup>
            <InputGroupInput
              id="provider-endpoint"
              value={draft.endpoint}
              onChange={(event) => onChange({ ...draft, endpoint: event.target.value })}
              placeholder={preset.endpoint}
              spellCheck={false}
              className="font-mono text-xs md:text-xs"
              autoFocus={autoFocusKey}
              data-testid="provider-endpoint"
            />
            <InputGroupAddon align="inline-end" className="font-mono text-xs font-normal">
              {AZURE_PATH}
            </InputGroupAddon>
          </InputGroup>
        </Field>
      )}
      {preset?.cloud === 'vertex' ? (
        <Field label="Project" htmlFor="provider-project">
          <Input
            id="provider-project"
            value={draft.project}
            onChange={(event) => onChange({ ...draft, project: event.target.value })}
            placeholder="my-project"
            spellCheck={false}
            className="font-mono text-xs md:text-xs"
            autoFocus={autoFocusKey}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) onSubmit()
            }}
            data-testid="provider-project"
          />
        </Field>
      ) : (
        <Field label="API key" htmlFor="provider-key">
          <KeyField
            value={draft.apiKey}
            onChange={(apiKey) => onChange({ ...draft, apiKey })}
            keyUrl={keyUrl}
            autoFocus={autoFocusKey && preset !== null && preset.endpoint === undefined}
            onEnter={onSubmit}
          />
        </Field>
      )}
      <Field label="Models">
        <ModelPicker
          // A new list for another plan's catalog.
          key={catalog ?? 'none'}
          catalog={catalogModelIds(catalogs, catalog)}
          picked={draft.models}
          onChange={(models) => onChange({ ...draft, models })}
        />
      </Field>
    </div>
  )
}

/** The mark a provider's form is headed by: its preset's, or a plus for one of the user's own. */
export function FormTitleMark({ preset }: { preset: ProviderPreset | null }) {
  return preset === null ? (
    <PlusIcon className="size-5 shrink-0 text-muted-foreground" />
  ) : (
    <ProviderMarkIcon mark={preset.mark} className="size-5 shrink-0" />
  )
}

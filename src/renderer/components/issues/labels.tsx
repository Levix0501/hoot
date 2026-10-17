import { Combobox as ComboboxPrimitive } from '@base-ui/react'
import { PlusIcon, TagIcon, XIcon } from 'lucide-react'
import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { Issue } from '../../../shared/issues'
import {
  labelName,
  labelOrder,
  labelText,
  randomLabelColor,
  sameName,
  type NamedLabel,
} from '../../../shared/labels'
import { cn } from '../../lib/utils'
import { issueLabelsOf, useAppStore, type LabelMatch } from '../../store/app-store'
import { Button } from '../ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../ui/combobox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

/** A label's color, as a dot. */
export function LabelDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: `#${color}` }}
      data-testid="label-dot"
      data-color={color}
    />
  )
}

/**
 * A label as an issue shows it: its color and how it is written, such as
 * `Spec-driven › triaging`, in a pill; with a ✕ that takes it off when
 * `onRemove` is given.
 */
export function LabelChip({
  label,
  onRemove,
  className,
}: {
  label: NamedLabel
  onRemove?(): void
  className?: string
}) {
  const text = labelText(label.name, label.group)
  return (
    <span
      className={cn(
        'group/label inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2 text-xs text-foreground',
        onRemove && 'pr-0.5',
        className,
      )}
      title={label.description === '' ? text : `${text}: ${label.description}`}
      data-testid="label-chip"
      data-label-id={label.id}
      data-label={text}
    >
      <LabelDot color={label.color} />
      <span className="min-w-0 truncate">{text}</span>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5 rounded-full opacity-60 hover:opacity-100"
          aria-label={`Remove label ${text}`}
          onClick={onRemove}
          data-testid="label-chip-remove"
        >
          <XIcon />
        </Button>
      )}
    </span>
  )
}

/** The item of the label picker that creates a label named as typed. */
interface CreateItem {
  create: string
}
type PickerItem = NamedLabel | CreateItem
const isCreateItem = (item: PickerItem): item is CreateItem => 'create' in item

/** Whether a label is found by what is typed in a search field: by its name, or how it is written. */
function labelMatches(label: NamedLabel, typed: string): boolean {
  const query = typed.trim().toLowerCase()
  return labelText(label.name, label.group).toLowerCase().includes(query)
}

/**
 * The label picker of an issue, as Linear's: a search field over every
 * label, each with its color, how it is written and its description, those
 * the issue has checked. Checking one gives it to the issue, which then no
 * longer has the other label of its group; unchecking it takes it off. When
 * what is typed is no label's name, its last item creates a label of that
 * name, with a color Hoot picks, and gives it to the issue.
 */
export function LabelPicker({
  issue,
  trigger,
  children,
}: {
  issue: Issue
  /** The button that opens it, rendering `children`. */
  trigger: ReactElement
  children: ReactNode
}) {
  const labels = useAppStore((state) => state.labels)
  const carried = useAppStore((state) => issueLabelsOf(state, issue.id))
  const changeIssueLabels = useAppStore((state) => state.changeIssueLabels)
  const createLabel = useAppStore((state) => state.createLabel)
  const [query, setQuery] = useState('')
  const ordered = useMemo(() => labelOrder(labels), [labels])
  const name = labelName(query)
  const creatable = name !== '' && !ordered.some((label) => sameName(label.name, name))
  const items = useMemo(
    (): PickerItem[] => (creatable ? [...ordered, { create: name }] : ordered),
    [ordered, creatable, name],
  )
  const value = useMemo(
    () => ordered.filter((label) => carried.some((entry) => entry.id === label.id)),
    [ordered, carried],
  )

  const pick = (next: PickerItem[]) => {
    const created = next.find(isCreateItem)
    if (created) {
      void createLabel({
        name: created.create,
        color: randomLabelColor(),
        description: '',
        groupId: null,
        issueId: issue.id,
      }).then((done) => {
        if (done) setQuery('')
      })
      return
    }
    const picked = next.filter((item): item is NamedLabel => !isCreateItem(item))
    const add = picked.filter((label) => !value.includes(label)).map((label) => label.id)
    const remove = value.filter((label) => !picked.includes(label)).map((label) => label.id)
    if (add.length > 0 || remove.length > 0) void changeIssueLabels(issue.id, { add, remove })
  }

  return (
    <Combobox
      multiple
      items={items}
      value={value}
      onValueChange={(next: PickerItem[]) => pick(next)}
      inputValue={query}
      onInputValueChange={(typed) => setQuery(typed)}
      isItemEqualToValue={(item: PickerItem, other: PickerItem) =>
        !isCreateItem(item) && !isCreateItem(other) && item.id === other.id
      }
      filter={(item: PickerItem, typed) => isCreateItem(item) || labelMatches(item, typed)}
      itemToStringLabel={(item: PickerItem) =>
        isCreateItem(item) ? item.create : labelText(item.name, item.group)
      }
      autoHighlight
    >
      {/* Without the chevron of the pickers that show a value: it adds one. */}
      <ComboboxPrimitive.Trigger render={trigger}>{children}</ComboboxPrimitive.Trigger>
      <ComboboxContent className="w-72 [app-region:no-drag]" data-testid="label-picker">
        <ComboboxInput
          showTrigger={false}
          placeholder="Change labels…"
          aria-label="Search labels"
          data-testid="label-picker-search"
        />
        <ComboboxEmpty>No labels.</ComboboxEmpty>
        <ComboboxList>
          {(item: PickerItem) =>
            isCreateItem(item) ? (
              <ComboboxItem
                key="create"
                value={item}
                className="text-muted-foreground"
                data-testid="label-picker-create"
              >
                <PlusIcon />
                <span className="min-w-0 flex-1 truncate">
                  Create new label: "<span data-user-text="">{item.create}</span>"
                </span>
              </ComboboxItem>
            ) : (
              <ComboboxItem
                key={item.id}
                value={item}
                className="items-start"
                data-testid="label-picker-item"
                data-label-id={item.id}
                data-label={labelText(item.name, item.group)}
              >
                <LabelDot color={item.color} className="mt-1.5" />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate">{labelText(item.name, item.group)}</span>
                  {item.description !== '' && (
                    <span
                      className="truncate text-xs text-muted-foreground"
                      data-testid="label-picker-description"
                    >
                      {item.description}
                    </span>
                  )}
                </span>
              </ComboboxItem>
            )
          }
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

/**
 * The Labels section of an issue's properties: the labels it has, each with
 * a ✕ that takes it off, and Add label, which opens the label picker.
 */
export function IssueLabels({ issue, className }: { issue: Issue; className?: string }) {
  const carried = useAppStore((state) => issueLabelsOf(state, issue.id))
  const changeIssueLabels = useAppStore((state) => state.changeIssueLabels)
  return (
    <section
      aria-label="Labels"
      className={cn('grid w-full min-w-0 gap-1 pt-3', className)}
      data-testid="issue-labels"
      data-count={carried.length}
    >
      <h2 className="px-2.5 pb-0.5 text-xs font-medium text-muted-foreground">Labels</h2>
      <div className="flex min-w-0 flex-wrap items-center gap-1 px-1.5">
        {carried.map((label) => (
          <LabelChip
            key={label.id}
            label={label}
            onRemove={() => void changeIssueLabels(issue.id, { remove: [label.id] })}
          />
        ))}
        <LabelPicker
          issue={issue}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 rounded-full px-2 text-xs font-normal text-muted-foreground"
              data-testid="issue-add-label"
            />
          }
        >
          <PlusIcon />
          Add label
        </LabelPicker>
      </div>
    </section>
  )
}

/** How the Label filter matches the labels checked in it, as it offers it. */
const MATCH_ITEMS: Array<{ value: LabelMatch; label: string }> = [
  { value: 'any', label: 'Has any of' },
  { value: 'all', label: 'Has all of' },
]

/** What the Label filter's button says: Labels, the label checked, or how many are. */
function filterLabel(checked: readonly NamedLabel[]): string {
  if (checked.length === 0) return 'All labels'
  if (checked.length > 1) return `${checked.length} labels`
  return labelText(checked[0]!.name, checked[0]!.group)
}

/**
 * The issue list's Label filter: which labels the issues it shows have, any
 * number of them checked at once, and whether the issues have any of them
 * or all of them, any at first. With none checked, the list shows every
 * issue.
 */
export function LabelFilter() {
  const labels = useAppStore((state) => state.labels)
  const checkedIds = useAppStore((state) => state.checkedLabels)
  const match = useAppStore((state) => state.labelMatch)
  const setCheckedLabels = useAppStore((state) => state.setCheckedLabels)
  const setLabelMatch = useAppStore((state) => state.setLabelMatch)
  const ordered = useMemo(() => labelOrder(labels), [labels])
  const checked = useMemo(
    () => ordered.filter((label) => checkedIds.includes(label.id)),
    [ordered, checkedIds],
  )

  return (
    <div className="flex shrink-0 items-center gap-1">
      {checked.length > 0 && (
        <Select
          items={MATCH_ITEMS}
          value={match}
          onValueChange={(next) => setLabelMatch(next as LabelMatch)}
        >
          <SelectTrigger
            size="sm"
            className="h-7 border-none bg-transparent text-xs text-muted-foreground shadow-none dark:bg-transparent"
            aria-label="Match labels"
            data-testid="issues-label-match"
            data-match={match}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="[app-region:no-drag]">
            <SelectItem value="any" data-testid="issues-label-match-any">
              Has any of
            </SelectItem>
            <SelectItem value="all" data-testid="issues-label-match-all">
              Has all of
            </SelectItem>
          </SelectContent>
        </Select>
      )}
      <Combobox
        multiple
        items={ordered}
        value={checked}
        onValueChange={(next: NamedLabel[]) => setCheckedLabels(next.map((label) => label.id))}
        isItemEqualToValue={(item: NamedLabel, other: NamedLabel) => item.id === other.id}
        filter={(item: NamedLabel, typed) => labelMatches(item, typed)}
        itemToStringLabel={(item: NamedLabel) => labelText(item.name, item.group)}
        autoHighlight
      >
        <ComboboxTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="max-w-56 shrink-0 font-normal text-muted-foreground"
              data-testid="issues-label-filter"
            />
          }
        >
          <TagIcon />
          <span className="min-w-0 truncate">{filterLabel(checked)}</span>
        </ComboboxTrigger>
        <ComboboxContent align="end" className="w-64 [app-region:no-drag]">
          <ComboboxInput showTrigger={false} placeholder="Search labels…" aria-label="Labels" />
          <ComboboxEmpty>No labels.</ComboboxEmpty>
          <ComboboxList>
            {(label: NamedLabel) => (
              <ComboboxItem
                key={label.id}
                value={label}
                data-testid="issues-label-option"
                data-label-id={label.id}
                data-label={labelText(label.name, label.group)}
              >
                <LabelDot color={label.color} />
                <span className="min-w-0 flex-1 truncate">
                  {labelText(label.name, label.group)}
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  )
}

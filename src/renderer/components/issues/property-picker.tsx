import { FolderIcon, FolderXIcon } from 'lucide-react'
import { useMemo, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import type { IssuePriority, IssueStatus } from '../../../shared/issues'
import {
  optionOfDigit,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  type PropertyOption,
} from '../../lib/issue-properties'
import { projectOptions, type ProjectChoice } from '../../lib/project-choices'
import { cn } from '../../lib/utils'
import { useAppStore } from '../../store/app-store'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../ui/combobox'
import { Kbd } from '../ui/kbd'
import { PriorityIcon, StatusIcon } from './issue-icons'

type FinalFocus = ComponentProps<typeof ComboboxContent>['finalFocus']

interface PickerProps<T> {
  value: T
  onChange(value: T): void
  /** The button that opens the picker, rendering this content; without it, it opens at `anchor`. */
  children?: ReactNode
  /** Props of the button that opens the picker. */
  triggerProps?: Omit<ComponentProps<typeof ComboboxTrigger>, 'children'>
  /** What the picker opens next to without a button, such as the row of an issue in a list. */
  anchor?: ComponentProps<typeof ComboboxContent>['anchor']
  open?: boolean
  onOpenChange?(open: boolean): void
  /** Where the keyboard focus goes when the picker closes; by default, back to where it was. */
  finalFocus?: FinalFocus
}

/**
 * A picker of one of an issue's properties, as Linear's: a search field over
 * the values, each with its icon and the digit, if any, that picks it at once.
 */
function PropertyPicker<T>({
  options,
  placeholder,
  Icon,
  label,
  value,
  onChange,
  children,
  triggerProps,
  anchor,
  open,
  onOpenChange,
  finalFocus,
}: PickerProps<T> & {
  options: ReadonlyArray<PropertyOption<T>>
  /** What the search field says while empty, such as "Change status…". */
  placeholder: string
  Icon: ComponentType<{ value: T }>
  /** What the picker is called, for assistive technologies. */
  label: string
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const isOpen = open ?? ownOpen
  const setOpen = (next: boolean) => (onOpenChange ?? setOwnOpen)(next)
  const selected = options.find((option) => option.value === value) ?? null

  return (
    <Combobox
      items={options as Array<PropertyOption<T>>}
      value={selected}
      onValueChange={(option: PropertyOption<T> | null) => {
        if (option !== null && option.value !== value) onChange(option.value)
      }}
      open={isOpen}
      onOpenChange={setOpen}
      autoHighlight
    >
      {children !== undefined && <ComboboxTrigger {...triggerProps}>{children}</ComboboxTrigger>}
      <ComboboxContent
        anchor={anchor}
        finalFocus={finalFocus}
        className="w-56 [app-region:no-drag]"
      >
        <ComboboxInput
          showTrigger={false}
          placeholder={placeholder}
          aria-label={label}
          onKeyDown={(event) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return
            const option = optionOfDigit(options, event.key)
            if (option === null) return
            // A digit picks its value at once: no value has a digit in its name.
            event.preventDefault()
            if (option.value !== value) onChange(option.value)
            setOpen(false)
          }}
        />
        <ComboboxEmpty>No matches.</ComboboxEmpty>
        <ComboboxList>
          {(option: PropertyOption<T>) => (
            <ComboboxItem key={String(option.value)} value={option} data-value={option.value}>
              <Icon value={option.value} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.shortcut !== undefined && <Kbd>{option.shortcut}</Kbd>}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function StatusOptionIcon({ value }: { value: IssueStatus }) {
  return <StatusIcon status={value} />
}

export function PriorityOptionIcon({ value }: { value: IssuePriority }) {
  return <PriorityIcon priority={value} />
}

export function StatusPicker(props: PickerProps<IssueStatus>) {
  return (
    <PropertyPicker
      {...props}
      options={STATUS_OPTIONS}
      placeholder="Change status…"
      label="Status"
      Icon={StatusOptionIcon}
    />
  )
}

export function PriorityPicker(props: PickerProps<IssuePriority>) {
  return (
    <PropertyPicker
      {...props}
      options={PRIORITY_OPTIONS}
      placeholder="Set priority…"
      label="Priority"
      Icon={PriorityOptionIcon}
    />
  )
}

/** The icon of a project, or of no project. */
export function ProjectOptionIcon({
  value,
  className,
}: {
  value: ProjectChoice
  className?: string
}) {
  const Icon = value === null ? FolderXIcon : FolderIcon
  return <Icon aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', className)} />
}

/** A picker of the project an issue belongs to: no project, or one of the list's, in its order. */
export function ProjectPicker(props: PickerProps<ProjectChoice>) {
  const projects = useAppStore((state) => state.projects)
  const options = useMemo(() => projectOptions(projects), [projects])
  return (
    <PropertyPicker
      {...props}
      options={options}
      placeholder="Set project…"
      label="Project"
      Icon={ProjectOptionIcon}
    />
  )
}

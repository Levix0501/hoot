import type { ComponentType, KeyboardEvent } from 'react'
import { optionOfDigit, type PropertyOption } from '../../lib/issue-properties'
import {
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuShortcut,
} from '../ui/context-menu'

/** A property of an issue as a context menu offers it: its values, the issue's, and how it changes. */
export interface PropertyMenu<T> {
  Icon: ComponentType<{ value: T }>
  options: ReadonlyArray<PropertyOption<T>>
  value: T
  onChange(value: T): void
}

/** A property's values as a context menu's items, each with its digit, the issue's marked. */
export function PropertyMenuItems<T extends string | number | null>({
  Icon,
  options,
  value,
  onChange,
}: PropertyMenu<T>) {
  return (
    <ContextMenuRadioGroup
      value={value}
      onValueChange={(next: T) => {
        if (next !== value) onChange(next)
      }}
    >
      {options.map((option) => (
        <ContextMenuRadioItem
          key={String(option.value)}
          value={option.value}
          closeOnClick
          data-value={String(option.value)}
        >
          <Icon value={option.value} />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.shortcut !== undefined && (
            <ContextMenuShortcut>{option.shortcut}</ContextMenuShortcut>
          )}
        </ContextMenuRadioItem>
      ))}
    </ContextMenuRadioGroup>
  )
}

/**
 * What a menu of a property's values does with a key: a digit picks the
 * value with that digit, if any, and closes the menu with `close`.
 */
export function pickByDigit<T>(
  { options, value, onChange }: PropertyMenu<T>,
  close: () => void,
): (event: KeyboardEvent) => void {
  return (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const option = optionOfDigit(options, event.key)
    if (option === null) return
    event.preventDefault()
    if (option.value !== value) onChange(option.value)
    close()
  }
}

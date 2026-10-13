import type { ComponentProps } from 'react'
import { ISSUE_TITLE_MAX_LENGTH, oneLineTitle } from '../../../shared/issues'
import { cn } from '../../lib/utils'
import { Textarea } from '../ui/textarea'

/**
 * An issue's title, typed where it shows, as Linear's: one paragraph that
 * wraps, without a frame. Line breaks become spaces; Enter calls `onEnter`
 * (such as moving on to the description), and Esc `onEscape` when given.
 */
export function TitleField({
  value,
  onChange,
  onEnter,
  onEscape,
  className,
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'value' | 'onChange'> & {
  value: string
  onChange(value: string): void
  onEnter?(): void
  onEscape?(field: HTMLTextAreaElement): void
}) {
  return (
    <Textarea
      rows={1}
      value={value}
      maxLength={ISSUE_TITLE_MAX_LENGTH}
      spellCheck={false}
      onChange={(event) => onChange(oneLineTitle(event.target.value))}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault()
          onEnter?.()
        } else if (event.key === 'Escape' && onEscape) {
          onEscape(event.currentTarget)
        }
      }}
      className={cn(
        'min-h-0 resize-none rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

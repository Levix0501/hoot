import { lazy, Suspense, type Ref } from 'react'
import { cn } from '../../lib/utils'

export interface DescriptionEditorHandle {
  /** Puts the keyboard focus at the start of the description, or at its end. */
  focus(at?: 'start' | 'end'): void
  /** Hands on what was typed and not handed on yet. */
  flush(): void
}

export interface DescriptionEditorProps {
  /** What the editor starts with; later changes to it are not shown. */
  markdown: string
  onChange(markdown: string): void
  placeholder?: string
  /** Whether Esc takes the focus out of the editor, instead of reaching the dialog it is in. */
  escapeBlurs?: boolean
  /** Classes of the element around the editor; `[&_.tiptap]:` ones reach the editor itself. */
  className?: string
  testId: string
  ref?: Ref<DescriptionEditorHandle>
}

/** The editor itself, with notra-editor, which is loaded the first time a description shows. */
const NotraDescription = lazy(() => import('./description-notra'))

/**
 * An issue's description, edited in place as Linear's are, in notra-editor:
 * formatted as it is typed (`# `, `- `, `[ ] ` and the like), with a `/`
 * menu of blocks and a toolbar over selected text, and kept as GitHub
 * Flavored Markdown. What is typed is handed to `onChange` as Markdown once
 * typing pauses, when the editor loses the focus or goes away, and before an
 * issue is sent to an agent; never just for showing the description.
 */
export function DescriptionEditor(props: DescriptionEditorProps) {
  return (
    <Suspense fallback={<div className={cn('min-w-0', props.className)} />}>
      <NotraDescription {...props} />
    </Suspense>
  )
}

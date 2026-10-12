import { Extension, type AnyExtension } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'

/**
 * What a description's editor understands: GitHub Flavored Markdown, read
 * and written as Markdown, with headings, lists, task lists, code, quotes,
 * tables and links. Underlines, which Markdown cannot keep, are left out.
 */
export function descriptionExtensions(placeholder: string): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false,
      // Viewing a description must not change it, by adding an empty paragraph at its end.
      trailingNode: false,
      link: {
        // A click opens a link in the default browser, through the editor's click handler.
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { target: null, rel: null },
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder }),
    Markdown.configure({ markedOptions: { gfm: true } }),
    Extension.create({
      name: 'noUnderline',
      // Markdown has no underline, which ⌘U would otherwise make.
      addKeyboardShortcuts: () => ({ 'Mod-u': () => true }),
    }),
  ]
}

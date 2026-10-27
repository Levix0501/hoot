import type { ComponentType, ReactNode } from 'react'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from './ui/context-menu'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from './ui/dropdown-menu'

/**
 * The parts a menu of a sidebar row is made of: those of its `⋯` menu, or of
 * its context menu, which list the same items.
 */
export interface MenuParts {
  Item: ComponentType<{
    children?: ReactNode
    variant?: 'default' | 'destructive'
    disabled?: boolean
    onClick?: () => void
    'data-testid'?: string
  }>
  Separator: ComponentType
  Sub: ComponentType<{ children?: ReactNode }>
  SubTrigger: ComponentType<{ children?: ReactNode; 'data-testid'?: string }>
  SubContent: ComponentType<{ children?: ReactNode; className?: string }>
}

export const dropdownMenuParts: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
}

export const contextMenuParts: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
}

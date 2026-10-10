import { DatabaseIcon, FolderSearchIcon } from 'lucide-react'
import { api } from '../lib/api'
import { Button } from './ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from './ui/empty'

/**
 * What the window shows, and all it shows, when Hoot cannot open its
 * database: why, where the file is, and buttons to show it in Finder or to
 * quit. Hoot leaves the file as it is.
 */
export function DatabaseErrorPage({ message, path }: { message: string; path: string }) {
  return (
    <div className="flex h-svh flex-col bg-background text-foreground" data-testid="database-error">
      {/* The window's top row, which drags the window. */}
      <div className="h-11 shrink-0 [app-region:drag]" />
      <Empty className="min-h-0 overflow-y-auto">
        <EmptyHeader className="max-w-lg">
          <EmptyMedia variant="icon">
            <DatabaseIcon />
          </EmptyMedia>
          <EmptyTitle>Hoot cannot open its database</EmptyTitle>
          <EmptyDescription>
            Your projects and their issues are kept in it. Hoot has left the file as it is: fix what
            went wrong, then open Hoot again.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-lg gap-3">
          <p
            className="w-full rounded-lg bg-muted px-3 py-2 text-left font-mono text-xs break-words whitespace-pre-wrap select-text"
            role="alert"
            data-user-text=""
            data-testid="database-error-message"
          >
            {message}
          </p>
          <p
            className="w-full text-left font-mono text-xs break-all text-muted-foreground select-text"
            data-path=""
            data-testid="database-error-path"
          >
            {path}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => api.revealDatabase()}
              data-testid="database-error-reveal"
            >
              <FolderSearchIcon />
              Show in Finder
            </Button>
            <Button onClick={() => api.quit()} data-testid="database-error-quit">
              Quit
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </div>
  )
}

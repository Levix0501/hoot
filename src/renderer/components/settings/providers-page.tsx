import { ChevronRightIcon, PlusIcon } from 'lucide-react'
import { cn } from 'cn'
import { useState } from 'react'
import { harnessesOf, maskKey, providerMark, type Provider } from '../../../shared/providers'
import { getCodingTool } from '../../../shared/tools'
import { useAppStore } from '../../store/app-store'
import { ProviderMarkIcon } from '../provider-icon'
import { ToolIcon } from '../tool-icon'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { CATALOG_SEARCH, ProviderCatalog, useInstalled } from './provider-catalog'
import { ProviderPanel, type ProviderTarget } from './provider-panel'

/** The installed harnesses that can run a provider, as small marks. */
function HarnessMarks({ provider }: { provider: Provider }) {
  const installed = useInstalled()
  const harnesses = harnessesOf(provider).filter((harness) => installed.includes(harness))
  return (
    <span className="flex shrink-0 items-center gap-1" data-testid="provider-harness-marks">
      {harnesses.map((harness) => (
        <Tooltip key={harness}>
          <TooltipTrigger render={<span className="flex" />}>
            <ToolIcon toolId={harness} className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>{getCodingTool(harness).label} can run it</TooltipContent>
        </Tooltip>
      ))}
    </span>
  )
}

/**
 * A provider's row: its mark, name and models, the harnesses that can run
 * it, its key. A click opens it in the panel.
 */
function ProviderRow({
  provider,
  selected,
  onOpen,
}: {
  provider: Provider
  /** Whether the panel shows it. */
  selected: boolean
  onOpen: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'flex w-full cursor-default items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40',
        selected && 'bg-muted/60 hover:bg-muted/60',
      )}
      data-testid="provider-row"
      data-provider={provider.id}
    >
      <ProviderMarkIcon mark={providerMark(provider)} className="size-5 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium" data-testid="provider-row-name">
            {provider.name}
          </span>
        </span>
        {provider.models.length > 0 && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {provider.models.join(' · ')}
          </span>
        )}
      </span>
      <HarnessMarks provider={provider} />
      <span className="w-24 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {maskKey(provider.apiKey)}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </div>
  )
}

/**
 * The settings' Providers page: the user's providers, then every preset to
 * add one of, or one of the user's own, which Add provider goes to; each
 * provider, and each one being added, in the panel. The harnesses' own
 * models are no provider here: each harness's agent of them is on the
 * Agents page.
 */
export function ProvidersPage() {
  const providers = useAppStore((state) => state.providers)
  const [target, setTarget] = useState<ProviderTarget>(null)
  const listed = providers?.providers ?? []
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background" data-testid="providers-page">
      {/* The page's part of the window's top row, which drags the window. */}
      <div className="h-11.5 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-2 pb-10">
          <div className="flex min-h-7 items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Providers</h1>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const search = document.getElementById(CATALOG_SEARCH)
                search?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                search?.focus({ preventScroll: true })
              }}
              data-testid="add-provider"
            >
              <PlusIcon />
              Add provider
            </Button>
          </div>
          {listed.length > 0 && (
            <div
              className="flex flex-col divide-y overflow-hidden rounded-xl border"
              data-testid="providers-list"
            >
              {listed.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  selected={target !== null && 'id' in target && target.id === provider.id}
                  onOpen={() => setTarget({ id: provider.id })}
                />
              ))}
            </div>
          )}
          <ProviderCatalog onPick={(presetId) => setTarget({ presetId })} />
        </div>
      </div>
      <ProviderPanel target={target} onTargetChange={setTarget} />
    </div>
  )
}

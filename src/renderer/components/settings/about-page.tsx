import { ArrowUpRightIcon, CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { environmentEntries, environmentText, type AppInfo } from '../../../shared/app-info'
import { HOOT_NEW_ISSUE_URL, HOOT_REPOSITORY_URL, releaseNotesUrl } from '../../../shared/links'
import { firstLine, type UpdateCheck, type UpdateState } from '../../../shared/updates'
import hootOwl from '../../assets/hoot-owl.png'
import { api } from '../../lib/api'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { Progress } from '../ui/progress'
import { Spinner } from '../ui/spinner'

/** Opens the link in the default browser: the window itself never leaves its page. */
function openInBrowser(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  api.openExternalLink(event.currentTarget.href)
}

/** A row of Hoot's group that opens a page in the default browser. */
function LinkRow({ href, label, testId }: { href: string; label: string; testId: string }) {
  return (
    <a
      href={href}
      onClick={openInBrowser}
      className="flex items-center justify-between gap-3 px-4 py-3 text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
      data-testid={testId}
    >
      <span className="min-w-0">{label}</span>
      <ArrowUpRightIcon className="size-4 text-muted-foreground" aria-hidden />
    </a>
  )
}

/** A link inside a line of text, to a page that opens in the default browser. */
function TextLink({
  href,
  children,
  testId,
}: {
  href: string
  children: ReactNode
  testId: string
}) {
  return (
    <a
      href={href}
      onClick={openInBrowser}
      className="inline-flex items-center gap-0.5 rounded-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      data-testid={testId}
    >
      {children}
      <ArrowUpRightIcon className="size-3.5" aria-hidden />
    </a>
  )
}

/** Hoot's icon: the owl on white, in the rounded square the app icon has. */
function HootIcon() {
  return (
    <img
      src={hootOwl}
      alt=""
      draggable={false}
      className="size-12 shrink-0 rounded-[22%] bg-white shadow-xs ring-1 ring-foreground/10"
      data-testid="about-icon"
    />
  )
}

/** Hoot's name and version, and where to read what changed, to see its code and to report an issue. */
function HootGroup({ info }: { info: AppInfo }) {
  return (
    <div
      className="flex flex-col divide-y overflow-hidden rounded-xl border"
      data-testid="about-hoot"
    >
      <div className="flex items-center gap-4 px-4 py-4">
        <HootIcon />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base leading-6 font-semibold" data-testid="about-name">
            Hoot
          </span>
          <span
            className="text-sm break-words text-muted-foreground"
            data-testid="about-version"
          >{`Version ${info.version}`}</span>
        </div>
      </div>
      <LinkRow
        href={releaseNotesUrl(info.version)}
        label="Release notes"
        testId="about-release-notes"
      />
      <LinkRow href={HOOT_REPOSITORY_URL} label="GitHub" testId="about-github" />
      <LinkRow href={HOOT_NEW_ISSUE_URL} label="Report an issue" testId="about-report-issue" />
    </div>
  )
}

/** A named group, whose name stands above it, with something to do with the group at the name's right. */
function Group({
  title,
  action,
  testId,
  children,
}: {
  title: string
  action?: ReactNode
  testId: string
  children: ReactNode
}) {
  const heading = useId()
  return (
    <section className="flex flex-col gap-2" aria-labelledby={heading} data-testid={testId}>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 id={heading} className="text-sm font-medium">
          {title}
        </h2>
        {action}
      </div>
      <div className="flex flex-col divide-y overflow-hidden rounded-xl border">{children}</div>
    </section>
  )
}

/** The row's text on the left, and on the right what can be done. */
function UpdateRow({
  action,
  testId,
  children,
}: {
  action?: ReactNode
  testId: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3" data-testid={testId}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function CheckForUpdatesButton({ disabled = false }: { disabled?: boolean }) {
  const checkForUpdates = useAppStore((state) => state.checkForUpdates)
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={checkForUpdates}
      disabled={disabled}
      data-testid="about-check-for-updates"
    >
      Check for Updates
    </Button>
  )
}

/** Why a look for a newer version failed: the first line of the reason, and all of it on request. */
function FailedRow({ message }: { message: string }) {
  const [open, setOpen] = useState(false)
  const reason = firstLine(message)
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid="about-update-failed">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
          <span>Couldn&apos;t check for updates.</span>
          <span
            className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]"
            data-testid="about-update-reason"
          >
            {reason}
            {reason !== '' && ' '}
            <CollapsibleTrigger
              render={
                <Button
                  variant="link"
                  size="xs"
                  className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                  data-testid="about-update-details"
                />
              }
            >
              {open ? 'Hide details' : 'Show details'}
            </CollapsibleTrigger>
          </span>
        </div>
        <div className="shrink-0">
          <CheckForUpdatesButton />
        </div>
      </div>
      <CollapsibleContent>
        <pre
          className="mx-4 mb-3 max-h-72 overflow-y-auto rounded-md bg-muted px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground select-text"
          data-testid="about-update-reason-full"
        >
          {message}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The Updates group's one row, by what comes first of what Hoot knows. */
function UpdatesRow({ update, check }: { update: UpdateState; check: UpdateCheck | null }) {
  const installUpdate = useAppStore((state) => state.installUpdate)
  // Not read yet: the row stays empty, which is as high as the rows are.
  if (check === null) return <UpdateRow testId="about-update-unknown">{null}</UpdateRow>
  if (check.kind === 'unsupported') {
    return (
      <UpdateRow testId="about-update-source">
        This Hoot was built from source, so it doesn&apos;t update itself.
      </UpdateRow>
    )
  }

  switch (update.kind) {
    case 'downloading':
      return (
        <div
          className="flex min-h-14 flex-col justify-center gap-2 px-4 py-3"
          data-testid="about-update-downloading"
        >
          <span className="text-sm tabular-nums">{`Downloading ${update.version}… ${update.percent}%`}</span>
          <Progress
            value={update.percent}
            aria-label={`Downloading ${update.version}`}
            data-testid="about-update-progress"
          />
        </div>
      )
    case 'downloaded':
      return (
        <UpdateRow
          testId="about-update-downloaded"
          action={
            <Button size="sm" onClick={installUpdate} data-testid="about-restart-to-update">
              Restart to Update
            </Button>
          }
        >
          {`Hoot ${update.version} is downloaded.`}
        </UpdateRow>
      )
    case 'restarting':
      return (
        <UpdateRow testId="about-update-restarting">
          <Spinner className="size-4 text-muted-foreground" aria-hidden />
          Restarting…
        </UpdateRow>
      )
    case 'none':
    case 'available':
      break
  }

  // Before the first look, one is on its way: showing the page starts it.
  if (check.kind === 'checking' || check.kind === 'idle') {
    return (
      <UpdateRow testId="about-update-checking" action={<CheckForUpdatesButton disabled />}>
        <Spinner className="size-4 text-muted-foreground" aria-hidden />
        Checking for updates…
      </UpdateRow>
    )
  }
  if (update.kind === 'available') {
    return (
      <UpdateRow
        testId="about-update-available"
        action={
          <Button size="sm" onClick={installUpdate} data-testid="about-update">
            {`Update to ${update.version}`}
          </Button>
        }
      >
        {`Hoot ${update.version} is available.`}
        <TextLink href={releaseNotesUrl(update.version)} testId="about-update-release-notes">
          Release notes
        </TextLink>
      </UpdateRow>
    )
  }
  if (check.kind === 'failed') return <FailedRow message={check.message} />
  return (
    <UpdateRow testId="about-update-up-to-date" action={<CheckForUpdatesButton />}>
      Hoot is up to date.
    </UpdateRow>
  )
}

/** Puts the environment, for a bug report, on the clipboard; the button shows it has. */
function CopyEnvironmentButton({ info }: { info: AppInfo }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        api.writeClipboardText(environmentText(info))
        setCopied(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setCopied(false), 1500)
      }}
      data-testid="about-copy"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      Copy
    </Button>
  )
}

/** What Hoot runs on: the system, and Electron with the Chromium and Node.js in it. */
function EnvironmentRows({ info }: { info: AppInfo }) {
  return environmentEntries(info).map(({ name, value }) => (
    <div key={name} className="px-4 py-2.5 text-sm [overflow-wrap:anywhere]">
      <span className="inline-block w-24 align-top text-muted-foreground">{name}</span>{' '}
      <span className="tabular-nums">{value}</span>
    </div>
  ))
}

/**
 * The settings' About page: Hoot's name and version with links to what
 * changed in it, to its code and to reporting an issue; whether a newer
 * version is out, which showing the page looks for, and downloading it; and
 * what Hoot runs on, which Copy puts on the clipboard.
 */
export function AboutPage() {
  const info = useAppStore((state) => state.appInfo)
  const update = useAppStore((state) => state.update)
  const check = useAppStore((state) => state.updateCheck)
  const checkForUpdates = useAppStore((state) => state.checkForUpdates)
  useEffect(() => {
    checkForUpdates()
  }, [checkForUpdates])

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background" data-testid="about-page">
      {/* The page's part of the window's top row, which drags the window. */}
      <div className="h-11.5 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-2 pb-10">
          <h1 className="text-2xl font-semibold tracking-tight">About</h1>
          {info && (
            <>
              <HootGroup info={info} />
              <Group title="Updates" testId="about-updates">
                <UpdatesRow update={update} check={check} />
              </Group>
              <Group
                title="Environment"
                action={<CopyEnvironmentButton info={info} />}
                testId="about-environment"
              >
                <EnvironmentRows info={info} />
              </Group>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

import { useId } from 'react'
import { APPEARANCES, isAppearance, type Appearance } from '../../../shared/appearance'
import { useAppStore } from '../../store/app-store'
import { Label } from '../ui/label'
import { RadioGroup, RadioGroupItem } from '../ui/radio-group'
import { ThemePreview } from './theme-preview'

const THEME_NAMES: Record<Appearance, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
}

/**
 * The cards of the appearances, in a row. Picking one, by clicking it or with
 * the arrow keys once it has the keyboard focus, applies it at once.
 */
function ThemeCards({ labelledBy }: { labelledBy: string }) {
  const appearance = useAppStore((state) => state.appearance)
  const setAppearance = useAppStore((state) => state.setAppearance)
  const picked = APPEARANCES.indexOf(appearance)
  return (
    <RadioGroup
      value={appearance}
      onValueChange={(value) => {
        if (isAppearance(value)) setAppearance(value)
      }}
      // The arrow keys stop at either end of the row instead of going round.
      onKeyDown={(event) => {
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        if ((forward && picked === APPEARANCES.length - 1) || (backward && picked === 0)) {
          event.preventDefault()
          event.preventBaseUIHandler()
        }
      }}
      aria-labelledby={labelledBy}
      className="grid-cols-3 gap-3"
      data-testid="theme-cards"
    >
      {APPEARANCES.map((value) => (
        // The choice cards of shadcn's fields: the card shows the radio's focus.
        <Label
          key={value}
          className="group/field-label flex-col items-stretch gap-2.5 rounded-xl p-1.5 pb-2 ring-primary outline-ring has-data-checked:ring-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2"
          data-testid={`theme-card-${value}`}
          data-selected={value === appearance}
        >
          <ThemePreview appearance={value} />
          <span className="flex min-w-0 items-center gap-2 px-1">
            <RadioGroupItem value={value} />
            <span className="truncate">{THEME_NAMES[value]}</span>
          </span>
        </Label>
      ))}
    </RadioGroup>
  )
}

/** The settings' Appearance page, which picks the appearance Hoot shows in. */
export function AppearancePage() {
  const themeHeading = useId()
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background" data-testid="appearance-page">
      {/* The page's part of the window's top row, which drags the window. */}
      <div className="h-11 shrink-0 [app-region:drag]" />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 pt-2 pb-10">
          <h1 className="text-2xl font-semibold tracking-tight">Appearance</h1>
          <section className="flex flex-col gap-4" aria-labelledby={themeHeading}>
            <div className="flex flex-col gap-1">
              <h2 id={themeHeading} className="text-base font-medium">
                Theme
              </h2>
              <p className="text-sm text-muted-foreground">
                System follows the appearance of macOS.
              </p>
            </div>
            <ThemeCards labelledBy={themeHeading} />
          </section>
        </div>
      </div>
    </div>
  )
}

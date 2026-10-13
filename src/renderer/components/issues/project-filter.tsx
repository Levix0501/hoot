import { useMemo } from 'react'
import type { PropertyOption } from '../../lib/issue-properties'
import { projectFilterLabel, projectOptions, type ProjectChoice } from '../../lib/project-choices'
import { useAppStore } from '../../store/app-store'
import { Button } from '../ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '../ui/combobox'
import { ProjectOptionIcon } from './property-picker'

type ProjectOption = PropertyOption<ProjectChoice>

/**
 * The issue list's Project filter: which projects' issues the list shows, and
 * whether those without a project, any number of them checked at once. It
 * says what is checked; a search field over the choices narrows them to
 * those whose names match. With nothing checked, the list shows every issue.
 */
export function ProjectFilter() {
  const projects = useAppStore((state) => state.projects)
  const checked = useAppStore((state) => state.checkedProjects)
  const setCheckedProjects = useAppStore((state) => state.setCheckedProjects)
  const options = useMemo(() => projectOptions(projects), [projects])
  const value = useMemo(
    () => options.filter((option) => checked.includes(option.value)),
    [options, checked],
  )

  return (
    <Combobox
      multiple
      items={options}
      value={value}
      onValueChange={(next: ProjectOption[]) =>
        setCheckedProjects(next.map((option) => option.value))
      }
      isItemEqualToValue={(item: ProjectOption, other: ProjectOption) => item.value === other.value}
      autoHighlight
    >
      <ComboboxTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 font-normal text-muted-foreground"
            data-testid="issues-project-filter"
          />
        }
      >
        {projectFilterLabel(checked, projects)}
      </ComboboxTrigger>
      <ComboboxContent align="end" className="w-56 [app-region:no-drag]">
        <ComboboxInput showTrigger={false} placeholder="Search projects…" aria-label="Projects" />
        <ComboboxEmpty>No matches.</ComboboxEmpty>
        <ComboboxList>
          {(option: ProjectOption) => (
            <ComboboxItem
              key={String(option.value)}
              value={option}
              data-testid="issues-project-option"
              data-value={String(option.value)}
            >
              <ProjectOptionIcon value={option.value} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

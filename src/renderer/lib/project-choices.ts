import type { Project } from '../../shared/ipc'
import { listOrder, type Issue, type IssueView } from '../../shared/issues'
import type { PropertyOption } from './issue-properties'

/**
 * A project as the list's Project filter and the project pickers offer it: a
 * project's id, or `null` for no project.
 */
export type ProjectChoice = number | null

/**
 * The choices, in the order they are offered: no project, then the projects
 * of the list in the sidebar's order.
 */
export function projectOptions(projects: readonly Project[]): PropertyOption<ProjectChoice>[] {
  return [
    { value: null, label: 'No project' },
    ...projects.map((project) => ({ value: project.id, label: project.name })),
  ]
}

/**
 * Whether the list shows an issue for what is checked in its Project filter:
 * the issues of the projects checked, and those without a project when No
 * project is checked. With nothing checked, it shows every issue.
 */
export function isOnList(
  issue: Pick<Issue, 'projectId'>,
  checked: readonly ProjectChoice[],
): boolean {
  return checked.length === 0 || checked.includes(issue.projectId)
}

/**
 * What the Project filter says: "All projects" with nothing checked, what is
 * checked when that is one choice, or else how many are checked.
 */
export function projectFilterLabel(
  checked: readonly ProjectChoice[],
  projects: readonly Project[],
): string {
  if (checked.length === 0) return 'All projects'
  if (checked.length > 1) return `${checked.length} projects`
  const [only] = checked
  return projectOptions(projects).find((option) => option.value === only)?.label ?? ''
}

/**
 * The project of an issue created from the list: the project checked in its
 * Project filter when that is the only choice checked; otherwise none.
 */
export function listProject(checked: readonly ProjectChoice[]): ProjectChoice {
  return checked.length === 1 ? (checked[0] ?? null) : null
}

/**
 * The issues an issue's page steps through, and counts: those of the list,
 * in the order its view shows them; or, when that does not show the issue,
 * every issue in the order of all issues with nothing checked.
 */
export function issuePageOrder(
  issueId: number,
  shown: readonly Issue[],
  all: readonly Issue[],
  view: IssueView,
): Issue[] {
  const order = listOrder(shown, view)
  return order.some(({ id }) => id === issueId) ? order : listOrder(all, 'all')
}

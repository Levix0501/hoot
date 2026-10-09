import path from 'node:path'
import Conf from 'conf'
import type { Project } from '../../shared/ipc'

interface StoredProjects {
  projects: Array<{ root: string }>
}

export function projectFromRoot(root: string): Project {
  return { root, name: path.basename(root) || root }
}

/** The project list, persisted as JSON in the user data directory. */
export class ProjectStore {
  private readonly config: Conf<StoredProjects>

  constructor(directory: string) {
    this.config = new Conf<StoredProjects>({
      cwd: directory,
      configName: 'projects',
      defaults: { projects: [] },
      clearInvalidConfig: true,
    })
  }

  list(): Project[] {
    const stored = this.config.get('projects')
    const roots = Array.isArray(stored)
      ? stored
          .map((entry) => entry?.root)
          .filter((root): root is string => typeof root === 'string' && root.length > 0)
      : []
    return [...new Set(roots)].map(projectFromRoot)
  }

  find(root: string): Project | undefined {
    return this.list().find((project) => project.root === root)
  }

  add(root: string): { added: boolean; project: Project } {
    const existing = this.find(root)
    if (existing) return { added: false, project: existing }
    this.save([...this.list().map((project) => project.root), root])
    return { added: true, project: projectFromRoot(root) }
  }

  remove(root: string): boolean {
    const projects = this.list()
    if (!projects.some((project) => project.root === root)) return false
    this.save(projects.map((project) => project.root).filter((entry) => entry !== root))
    return true
  }

  private save(roots: string[]): void {
    this.config.set(
      'projects',
      roots.map((root) => ({ root })),
    )
  }
}

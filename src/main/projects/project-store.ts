import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Project } from '../../shared/ipc'
import { transaction } from '../database/database'

interface ProjectRow {
  id: number
  root: string
}

function projectFromRow(row: ProjectRow): Project {
  return { id: row.id, root: row.root, name: path.basename(row.root) || row.root }
}

/**
 * The project list, kept in the database. A removed project keeps its row,
 * and so its id and its issues, and the same root added again brings it back
 * at the end of the list.
 */
export class ProjectStore {
  private readonly statements

  constructor(private readonly db: DatabaseSync) {
    this.statements = {
      list: db.prepare(
        'SELECT id, root FROM projects WHERE list_position IS NOT NULL ORDER BY list_position',
      ),
      byRoot: db.prepare('SELECT id, root, list_position FROM projects WHERE root = ?'),
      nextPosition: db.prepare(
        'SELECT coalesce(max(list_position), 0) + 1 AS position FROM projects',
      ),
      insert: db.prepare('INSERT INTO projects (root, list_position) VALUES (?, ?)'),
      setPosition: db.prepare('UPDATE projects SET list_position = ? WHERE id = ?'),
      unlist: db.prepare(
        'UPDATE projects SET list_position = NULL WHERE root = ? AND list_position IS NOT NULL',
      ),
    }
  }

  /** The projects in the list, in its order. */
  list(): Project[] {
    return (this.statements.list.all() as unknown as ProjectRow[]).map(projectFromRow)
  }

  /** The project in the list with this root. */
  find(root: string): Project | undefined {
    return this.list().find((project) => project.root === root)
  }

  /** Adds a project to the end of the list, unless it is in the list already. */
  add(root: string): { added: boolean; project: Project } {
    return transaction(this.db, () => {
      const row = this.statements.byRoot.get(root) as
        | (ProjectRow & { list_position: number | null })
        | undefined
      if (row && row.list_position !== null) return { added: false, project: projectFromRow(row) }
      const { position } = this.statements.nextPosition.get() as { position: number }
      if (row) {
        this.statements.setPosition.run(position, row.id)
        return { added: true, project: projectFromRow(row) }
      }
      const { lastInsertRowid } = this.statements.insert.run(root, position)
      return { added: true, project: projectFromRow({ id: Number(lastInsertRowid), root }) }
    })
  }

  /** Takes a project out of the list; its row and issues stay. */
  remove(root: string): boolean {
    return transaction(this.db, () => this.statements.unlist.run(root).changes > 0)
  }
}

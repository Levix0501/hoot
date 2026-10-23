import type { DatabaseSync } from 'node:sqlite'

/** A worktree Hoot made while asking for its name, as its row shows it. */
export interface RecordedWorktree {
  /** Its root directory, as Git records it. */
  path: string
  name: string
  /** Milliseconds since the Unix epoch, when Hoot made it. */
  createdAt: number
}

interface WorktreeRow {
  path: string
  name: string
  created_at: number
}

/**
 * The worktrees Hoot made with the New Worktree dialog, kept in the database
 * by root: their names and when Hoot made them. Worktrees made any other way
 * have no row here, and show without a name.
 */
export class WorktreeStore {
  private readonly statements

  constructor(db: DatabaseSync) {
    this.statements = {
      forProject: db.prepare('SELECT path, name, created_at FROM worktrees WHERE project_root = ?'),
      record: db.prepare(
        `INSERT INTO worktrees (path, project_root, name, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET project_root = excluded.project_root,
                                          name = excluded.name,
                                          created_at = excluded.created_at`,
      ),
      remove: db.prepare('DELETE FROM worktrees WHERE path = ?'),
    }
  }

  /** The worktrees Hoot made in a project, by root. */
  forProject(projectRoot: string): Map<string, RecordedWorktree> {
    const rows = this.statements.forProject.all(projectRoot) as unknown as WorktreeRow[]
    return new Map(
      rows.map((row) => [row.path, { path: row.path, name: row.name, createdAt: row.created_at }]),
    )
  }

  /** Records a worktree Hoot made, with the name it showed and when it made it. */
  record(projectRoot: string, path: string, name: string, createdAt: number): void {
    this.statements.record.run(path, projectRoot, name, createdAt)
  }

  /** Forgets a worktree that is deleted or removed. */
  remove(path: string): void {
    this.statements.remove.run(path)
  }
}

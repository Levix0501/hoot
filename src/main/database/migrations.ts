/**
 * The changes that bring the database's tables from one version to the next,
 * in order: the database at version `n` has had the first `n` applied, and
 * records `n` in its `PRAGMA user_version`. Add new changes at the end; never
 * change one that a released Hoot may have applied.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: projects and their issues.
  `
  -- Every project ever added. A project keeps its row, and so its id and
  -- issues, when it is removed from the list, and comes back with them when
  -- the same root is added again.
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The canonical path of the main worktree's top-level directory.
    root TEXT NOT NULL UNIQUE,
    -- Where the project is in the list, which is ordered by it; NULL while it is not in the list.
    list_position INTEGER UNIQUE
  ) STRICT;

  CREATE TABLE issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects (id),
    title TEXT NOT NULL CHECK (title <> ''),
    -- Markdown, as entered; may be empty.
    description TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
    -- Milliseconds since the Unix epoch.
    created_at INTEGER NOT NULL,
    -- When the issue was last closed, in milliseconds since the Unix epoch; NULL until then.
    closed_at INTEGER
  ) STRICT;

  CREATE INDEX issues_by_project ON issues (project_id, state);
  `,
]

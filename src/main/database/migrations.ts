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
  // 2: Linear's statuses and priorities, and numbers within a project.
  `
  -- The number the project's next issue gets; numbers are never reused.
  ALTER TABLE projects ADD COLUMN next_issue_number INTEGER NOT NULL DEFAULT 1
    CHECK (next_issue_number > 0);

  CREATE TABLE issues_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects (id),
    -- From 1 within the project, in the order the issues were created.
    number INTEGER NOT NULL CHECK (number > 0),
    title TEXT NOT NULL CHECK (title <> ''),
    -- Markdown; may be empty.
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'canceled')),
    -- 0 for none, then 1 (urgent) to 4 (low).
    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 4),
    -- Milliseconds since the Unix epoch.
    created_at INTEGER NOT NULL,
    -- When the issue last became done or canceled, in milliseconds since the
    -- Unix epoch; NULL while it is neither.
    completed_at INTEGER,
    UNIQUE (project_id, number),
    CHECK ((completed_at IS NOT NULL) = (status IN ('done', 'canceled')))
  ) STRICT;

  -- Open issues are to do, closed ones done.
  INSERT INTO issues_new
    (id, project_id, number, title, description, status, priority, created_at, completed_at)
  SELECT id, project_id, row_number() OVER (PARTITION BY project_id ORDER BY id), title,
    description, CASE state WHEN 'open' THEN 'todo' ELSE 'done' END, 0, created_at,
    CASE state WHEN 'open' THEN NULL ELSE coalesce(closed_at, created_at) END
  FROM issues;

  UPDATE projects SET next_issue_number =
    1 + coalesce((SELECT max(number) FROM issues_new WHERE project_id = projects.id), 0);

  -- Keep the highest id ever used, so that the ids of deleted issues are not reused either.
  DELETE FROM sqlite_sequence WHERE name = 'issues_new';
  UPDATE sqlite_sequence SET name = 'issues_new' WHERE name = 'issues';
  DROP TABLE issues;
  ALTER TABLE issues_new RENAME TO issues;
  `,
]

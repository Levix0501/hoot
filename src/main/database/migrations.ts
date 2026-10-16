/**
 * The changes that bring the database's tables from one version to the next,
 * in order: the database at version `n` has had the first `n` applied, and
 * records `n` in its `PRAGMA user_version`. Add new changes at the end; never
 * change one that a released Hoot may have applied.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: projects and issues.
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
    -- Also the issue's number, as in ISS-12: from 1 in the order the issues
    -- were created. AUTOINCREMENT never gives a number again, not even one of
    -- an issue that was deleted.
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The project it belongs to; NULL for none.
    project_id INTEGER REFERENCES projects (id),
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
    CHECK ((completed_at IS NOT NULL) = (status IN ('done', 'canceled')))
  ) STRICT;

  CREATE INDEX issues_by_project ON issues (project_id);
  `,
  // 2: the issues' progress through their workflow.
  `
  -- What happened to each issue in its workflow, in the order it happened: a
  -- run of a step started, the outcome of a run was reported, or the user
  -- started the workflow over. An issue's progress is read from its last
  -- record; an issue without any has not started. The records go with their
  -- issue when it is deleted.
  CREATE TABLE workflow_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('step-started', 'step-reported', 'started-over')),
    -- The id of the step in the workflow's definition; NULL when the workflow started over.
    step TEXT,
    -- The name of the outcome reported; NULL for any other record.
    outcome TEXT,
    -- Who reported the outcome, 'agent' or 'user'; NULL for any other record.
    reporter TEXT CHECK (reporter IN ('agent', 'user')),
    -- The agent's summary of the step, in Markdown; NULL for any other record.
    summary TEXT,
    -- Milliseconds since the Unix epoch.
    at INTEGER NOT NULL,
    CHECK ((step IS NULL) = (kind = 'started-over')),
    CHECK ((outcome IS NOT NULL) = (kind = 'step-reported')),
    CHECK ((reporter IS NOT NULL) = (kind = 'step-reported')),
    CHECK ((summary IS NOT NULL) = (reporter IS 'agent'))
  ) STRICT;

  CREATE INDEX workflow_records_by_issue ON workflow_records (issue_id, id);
  `,
  // 3: sub-issues.
  `
  -- The parent of each issue that has one, one row per sub-issue, in the
  -- order the sub-issues last became sub-issues of their parent: an issue
  -- that gets another parent gets a new row, and so goes after the parent's
  -- other sub-issues. An issue without a row is a top-level issue. Deleting
  -- either issue deletes the row, so the sub-issues of a deleted issue become
  -- top-level issues, keeping their own sub-issues.
  CREATE TABLE sub_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id INTEGER NOT NULL UNIQUE REFERENCES issues (id) ON DELETE CASCADE,
    parent_id INTEGER NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    CHECK (issue_id <> parent_id)
  ) STRICT;

  CREATE INDEX sub_issues_by_parent ON sub_issues (parent_id, id);
  `,
  // 4: dependencies between issues.
  `
  -- That an issue is blocked by another, which it waits for, one row per
  -- dependency, in the order they were made. The issues may belong to
  -- different projects, or to none. Deleting either issue deletes the row.
  CREATE TABLE issue_dependencies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- The issue that waits.
    issue_id INTEGER NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    -- The issue it waits for.
    blocked_by_id INTEGER NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
    UNIQUE (issue_id, blocked_by_id),
    CHECK (issue_id <> blocked_by_id)
  ) STRICT;

  CREATE INDEX issue_dependencies_by_blocker ON issue_dependencies (blocked_by_id, id);
  `,
]

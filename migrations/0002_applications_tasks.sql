-- Candidate-controlled applications, employer assessment requests, and task submissions.

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  role_id TEXT,
  display_name TEXT,                 -- what the employer sees; never the account email
  requirements TEXT NOT NULL,        -- JSON snapshot [{skill, level, importance}]
  declared TEXT NOT NULL DEFAULT '{}',    -- JSON {skill: level the candidate states}
  resolutions TEXT NOT NULL DEFAULT '{}', -- JSON {skill: 'task' | 'evidence' | 'disclose'}
  share_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);

-- The employer asks, the candidate decides. status: pending | accepted | declined | submitted
CREATE TABLE IF NOT EXISTS assessment_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  task_id TEXT,
  seed INTEGER NOT NULL,
  requested_by TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','submitted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (application_id, skill_id)
);

-- Stored answers. They are not scored: status stays 'submitted' until a scoring step exists.
CREATE TABLE IF NOT EXISTS task_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  request_id INTEGER REFERENCES assessment_requests(id) ON DELETE SET NULL,
  answer TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON task_submissions(user_id);

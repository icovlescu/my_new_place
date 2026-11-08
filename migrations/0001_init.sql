-- D1 schema. Rows are small and capped by the API so the free tier is not a concern.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- lowercased Google email
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  linkedin_url TEXT,
  linkedin_text TEXT,
  cv_text TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per piece of evidence about a skill. type: claim | survey | badge | reference | test
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('claim','survey','badge','reference','test')),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  title TEXT,
  issuer TEXT,
  url TEXT,
  contact TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',   -- cv | linkedin | manual | survey
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_evidence_user ON evidence(user_id, skill_id);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  url TEXT,
  text TEXT NOT NULL,
  role_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);

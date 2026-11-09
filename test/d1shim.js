// Minimal D1 look-alike over node:sqlite so the Worker can be integration-tested without wrangler.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of ['0001_init.sql', '0002_applications_tasks.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }; },
    async all() { return { results: db.prepare(sql).all(...args).map((r) => ({ ...r })) }; },
    async first() { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(stmts) { const out = []; db.exec('BEGIN'); try { for (const s of stmts) out.push(await s.run()); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return out; },
  };
}

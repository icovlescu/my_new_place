import { SKILLS, SKILL_BY_ID, ROLES } from './ontology.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
// Alias must not be glued to other letters/digits (so "r" never matches inside words).
const MATCHERS = SKILLS.map((s) => {
  const terms = [...new Set([...s.aliases, s.label.toLowerCase()])].sort((a, b) => b.length - a.length);
  return { id: s.id, re: new RegExp(`(?<![a-z0-9+#])(?:${terms.map(esc).join('|')})(?![a-z0-9+#])`, 'g') };
});

export function normalise(text) {
  return String(text || '').replace(/\r/g, '').replace(/[‘’]/g, "'").toLowerCase();
}

/** Find skills mentioned in free text. Returns Map<skillId, {count, snippet}>. */
export function extractSkills(text) {
  const t = normalise(text);
  const found = new Map();
  for (const m of MATCHERS) {
    m.re.lastIndex = 0;
    let hit, count = 0, first = -1;
    while ((hit = m.re.exec(t))) { count++; if (first < 0) first = hit.index; }
    if (count) {
      const start = Math.max(0, first - 40);
      found.set(m.id, { count, snippet: t.slice(start, first + 80).replace(/\s+/g, ' ').trim() });
    }
  }
  return found;
}

// ---- LinkedIn data-export helpers (we do not scrape LinkedIn: the user pastes text or uploads the export) ----
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Turn an uploaded LinkedIn export CSV (Skills / Positions / Certifications) into plain text. */
export function linkedinCsvToText(csv) {
  const rows = parseCsv(csv);
  if (rows.length < 2) return '';
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const keep = ['name', 'title', 'company name', 'description', 'authority', 'skills', 'headline', 'summary']
    .map((k) => head.indexOf(k)).filter((i) => i >= 0);
  if (!keep.length) return rows.slice(1).map((r) => r.join(' ')).join('\n');
  return rows.slice(1).map((r) => keep.map((i) => r[i] || '').filter(Boolean).join(' - ')).join('\n');
}

// ---- Job description -> requirements ----
const OPTIONAL_RE = /nice to have|preferred|bonus|a plus|\bplus\b|ideally|desirable|would be great/;
const STRONG_RE = /\bmust\b|required|essential|strong|proven|expert|extensive|solid|hands-on/;
const SOFT_RE = /familiarity|exposure|basic|awareness|some experience|interest in/;
const ADV_RE = /expert|advanced|deep|extensive|mastery/;
const SENIOR_RE = /\b(senior|sr\.?|lead|principal|staff|head of|manager|director)\b/;
const JUNIOR_RE = /\b(junior|jr\.?|entry[- ]level|associate|graduate|intern)\b/;
const OPT_SECTION = /nice to have|preferred|bonus|plus|desirable/;
const REQ_SECTION = /requirements|qualifications|what you('| wi)ll (bring|need)|you have|you bring|must have|about you|who you are/;

export function yearsToLevel(years) {
  if (years < 2) return 2;
  if (years < 4) return 3;
  if (years < 7) return 4;
  return 5;
}

export function detectRole(text, title = '') {
  const t = normalise(`${title}\n${String(text || '').slice(0, 400)}`);
  let best = null;
  for (const r of ROLES) {
    for (const m of r.match) {
      if (t.includes(m) && (!best || m.length > best.len)) best = { role: r, len: m.length };
    }
  }
  return best ? best.role.id : null;
}

/**
 * Heuristic requirement extraction from a job description.
 * Returns [{skill, level, importance, evidence}] where importance 1 (optional) .. 3 (must have).
 */
export function extractRequirements(jobText, title = '') {
  const lines = normalise(jobText).split(/\n+|(?<=[.!?;])\s+/).map((l) => l.trim()).filter(Boolean);
  const head = normalise(`${title} ${String(jobText || '').slice(0, 300)}`);
  const base = JUNIOR_RE.test(head) ? 2 : SENIOR_RE.test(head) ? 4 : 3;
  const reqs = new Map();
  let section = 'unknown';
  for (const line of lines) {
    if (line.length < 70 && !/[.;]$/.test(line)) {
      if (OPT_SECTION.test(line)) section = 'optional';
      else if (REQ_SECTION.test(line)) section = 'required';
    }
    for (const [id] of extractSkills(line)) {
      let importance = 2;
      if (OPTIONAL_RE.test(line) || section === 'optional') importance = 1;
      else if (STRONG_RE.test(line) || section === 'required') importance = 3;
      let level = base;
      const y = line.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs)/);
      if (y) level = yearsToLevel(Number(y[1]));
      if (ADV_RE.test(line)) level += 1;
      if (SOFT_RE.test(line)) { level -= 1; importance = Math.min(importance, 2); }
      level = Math.max(1, Math.min(5, level));
      const prev = reqs.get(id);
      if (!prev) reqs.set(id, { skill: id, level, importance, evidence: line.slice(0, 160) });
      else {
        prev.level = Math.max(prev.level, level);
        prev.importance = Math.max(prev.importance, importance);
      }
    }
  }
  return [...reqs.values()].filter((r) => SKILL_BY_ID[r.skill]);
}

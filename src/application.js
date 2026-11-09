import { SKILL_BY_ID } from './ontology.js';
import { TIER_LABEL } from './evidence.js';
import { clampLevel } from './evidence.js';

/** Random URL-safe token for a read-only employer link. */
export function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Keep only known skills with a level 1..5. */
export function cleanDeclared(input, reqs) {
  const asked = new Set(reqs.map((r) => r.skill));
  const out = {};
  for (const [k, v] of Object.entries(input && typeof input === 'object' ? input : {})) {
    if (!SKILL_BY_ID[k] || !asked.has(k)) continue;
    const n = Math.round(Number(v));
    if (n >= 1 && n <= 5) out[k] = clampLevel(n);
  }
  return out;
}

export function cleanResolutions(input, reqs) {
  const asked = new Set(reqs.map((r) => r.skill));
  const out = {};
  for (const [k, v] of Object.entries(input && typeof input === 'object' ? input : {})) {
    if (asked.has(k) && ['task', 'evidence', 'disclose'].includes(v)) out[k] = v;
  }
  return out;
}

/** Starting point for a new application: the level the evidence already supports. */
export function defaultDeclared(reqs, levels) {
  const out = {};
  for (const r of reqs) { const l = levels.get(r.skill); if (l && l.level > 0) out[r.skill] = l.level; }
  return out;
}

/**
 * One row per required skill: what the candidate states, what the evidence supports, and the flag between them.
 * Flags: above_evidence (stated level is higher than the evidence supports), claim_only (matches, but only a CV claim), null.
 * Every required skill is listed, so a gap cannot be hidden by leaving a skill out.
 */
export function applicationItems(reqs, levels, declared, resolutions = {}, requestsBySkill = new Map()) {
  return reqs.map((r) => {
    const sk = SKILL_BY_ID[r.skill];
    const have = levels.get(r.skill) || null;
    const evidenced = have ? have.level : 0;
    const stated = declared[r.skill] || 0;
    let flag = null;
    if (stated > evidenced) flag = 'above_evidence';
    else if (stated > 0 && have && have.tier === 'claim') flag = 'claim_only';
    const status = stated >= r.level ? 'met' : stated >= r.level - 1 && stated > 0 ? 'close' : stated > 0 ? 'gap' : 'missing';
    const req = requestsBySkill.get(r.skill) || null;
    return {
      skill: r.skill, label: sk ? sk.label : r.skill, required: r.level, importance: r.importance || 2,
      stated, evidenced, tier: have ? have.tier : null, tierLabel: have ? TIER_LABEL[have.tier] : 'No evidence',
      flag, status, resolution: resolutions[r.skill] || null,
      request: req && { id: req.id, status: req.status, task_id: req.task_id, requested_by: req.requested_by, note: req.note },
    };
  }).sort((a, b) => b.importance - a.importance || a.label.localeCompare(b.label));
}

export function summarise(items) {
  const must = items.filter((i) => i.importance === 3);
  return {
    mustHaveTotal: must.length,
    mustHaveStated: must.filter((i) => i.stated >= i.required).length,
    mustHaveEvidenced: must.filter((i) => i.evidenced >= i.required).length,
    flagged: items.filter((i) => i.flag === 'above_evidence').length,
    gaps: items.filter((i) => i.status === 'gap' || i.status === 'missing').length,
  };
}

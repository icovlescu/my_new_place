import { SKILL_BY_ID, ADJACENCY, ROLE_BY_ID, CATEGORIES } from './ontology.js';
import { TIER_LABEL } from './evidence.js';

const STRONG = new Set(['survey', 'badge', 'reference', 'test']);

/** Best transferable level for a skill from adjacent skills the person has. */
export function transferFor(skillId, levels) {
  let best = null;
  for (const n of ADJACENCY.get(skillId) || []) {
    const have = levels.get(n.id);
    if (!have) continue;
    const t = Math.round(have.level * n.w * 10) / 10;
    if (!best || t > best.level) best = { from: n.id, fromLabel: SKILL_BY_ID[n.id].label, fromLevel: have.level, weight: n.w, level: t };
  }
  return best;
}

/**
 * Compare requirements [{skill, level, importance}] with the person's skill levels (Map).
 * status: met | close | transferable | gap | missing
 */
export function analyse(requirements, levels) {
  const items = [];
  let num = 0, den = 0, vnum = 0;
  for (const r of requirements) {
    const sk = SKILL_BY_ID[r.skill];
    if (!sk) continue;
    const have = levels.get(r.skill) || null;
    const direct = have ? have.level : 0;
    const tr = transferFor(r.skill, levels);
    const transfer = tr ? tr.level : 0;
    let status;
    if (direct >= r.level) status = 'met';
    else if (direct >= r.level - 1 && direct > 0) status = 'close';
    else if (transfer >= r.level - 1 && transfer > 0) status = 'transferable';
    else if (direct > 0 || transfer > 0) status = 'gap';
    else status = 'missing';
    const eff = Math.max(direct, transfer);
    const w = r.importance || 2;
    num += w * Math.min(1, eff / r.level);
    den += w;
    // "verified" fit counts only levels backed by more than a self-claim
    const vDirect = have && STRONG.has(have.tier) ? have.level : 0;
    vnum += w * Math.min(1, vDirect / r.level);
    items.push({
      skill: r.skill, label: sk.label, cat: sk.cat, required: r.level, importance: w,
      have: direct, tier: have ? have.tier : null, tierLabel: have ? TIER_LABEL[have.tier] : null,
      confidence: have ? have.confidence : null,
      transfer: tr, status, needsEvidence: !have || !STRONG.has(have.tier),
      actions: status === 'met' && have && STRONG.has(have.tier) ? [] : ['take_survey', 'add_reference', 'add_badge'],
      context: r.evidence || '',
    });
  }
  const order = { missing: 0, gap: 1, close: 2, transferable: 3, met: 4 };
  items.sort((a, b) => order[a.status] - order[b.status] || b.importance - a.importance);
  const counts = items.reduce((c, i) => ((c[i.status] = (c[i.status] || 0) + 1), c), {});
  const mustHave = items.filter((i) => i.importance === 3);
  return {
    fit: den ? Math.round((100 * num) / den) : 0,
    verifiedFit: den ? Math.round((100 * vnum) / den) : 0,
    counts,
    mustHaveMet: mustHave.filter((i) => i.status === 'met' || i.status === 'transferable').length,
    mustHaveTotal: mustHave.length,
    items,
    hiddenFit: items.filter((i) => i.status === 'transferable'),
  };
}

export function roleRequirements(roleId) {
  const role = ROLE_BY_ID[roleId];
  if (!role) return null;
  return Object.entries(role.req).map(([skill, [level, importance]]) => ({ skill, level, importance }));
}

/** Skills the person has at level >= 3 that the target does not ask for. */
export function extraStrengths(requirements, levels) {
  const asked = new Set(requirements.map((r) => r.skill));
  return [...levels.values()].filter((l) => l.level >= 3 && !asked.has(l.skill))
    .map((l) => ({ skill: l.skill, label: SKILL_BY_ID[l.skill].label, level: l.level, tier: l.tier }));
}

/** Nodes and edges for the skill graph; optional requirements overlay. */
export function buildGraph(levels, requirements = null) {
  const reqBy = new Map((requirements || []).map((r) => [r.skill, r]));
  const analysis = requirements ? analyse(requirements, levels) : null;
  const statusBy = new Map((analysis ? analysis.items : []).map((i) => [i.skill, i]));
  const ids = new Set([...levels.keys(), ...reqBy.keys()]);
  const nodes = [...ids].map((id) => {
    const sk = SKILL_BY_ID[id];
    const have = levels.get(id);
    const req = reqBy.get(id);
    const st = statusBy.get(id);
    return {
      id, label: sk.label, cat: sk.cat, kind: sk.kind,
      level: have ? have.level : 0, tier: have ? have.tier : null, confidence: have ? have.confidence : null,
      evidenceCount: have ? have.evidence.length : 0,
      required: req ? req.level : null, importance: req ? req.importance : null,
      status: st ? st.status : null,
      transfer: st && st.transfer ? { from: st.transfer.from, level: st.transfer.level } : null,
    };
  });
  const edges = [];
  for (const a of ids) for (const n of ADJACENCY.get(a) || []) if (a < n.id && ids.has(n.id)) edges.push({ a, b: n.id, w: n.w });
  const cats = Object.entries(CATEGORIES).map(([id, label]) => {
    const ns = nodes.filter((n) => n.cat === id);
    const had = ns.filter((n) => n.level > 0);
    return { id, label, count: ns.length, avg: had.length ? Math.round((10 * had.reduce((s, n) => s + n.level, 0)) / had.length) / 10 : 0 };
  }).filter((c) => c.count);
  return { nodes, edges, categories: cats, summary: analysis && { fit: analysis.fit, verifiedFit: analysis.verifiedFit, counts: analysis.counts } };
}

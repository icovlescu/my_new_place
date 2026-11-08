// Evidence ladder: what kind of proof backs a claimed level.
// claim < survey (self-assessed on behavioural anchors) < badge / reference (attested, not verified by us yet) < test (measured, reserved).
export const TIERS = ['claim', 'survey', 'badge', 'reference', 'test'];
export const TIER_CAP = { claim: 2, survey: 3, badge: 3, reference: 3, test: 5 };
export const TIER_LABEL = {
  claim: 'Claimed', survey: 'Self-assessed', badge: 'Badge', reference: 'Reference', test: 'Measured',
};

export function clampLevel(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(1, Math.min(5, v)) : 1;
}

/**
 * Combine evidence rows into one level per skill.
 * Effective level of a row = min(declared level, cap of its tier). Skill level = max over rows.
 * Confidence: low = claim only; medium = one non-claim tier; high = two or more distinct non-claim tiers or a measured test.
 */
export function skillLevels(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!TIERS.includes(r.type)) continue;
    const eff = Math.min(clampLevel(r.level || 1), TIER_CAP[r.type]);
    const cur = by.get(r.skill_id) || { skill: r.skill_id, level: 0, tier: null, tiers: new Set(), evidence: [] };
    cur.tiers.add(r.type);
    cur.evidence.push({ id: r.id, type: r.type, level: clampLevel(r.level || 1), effective: eff, title: r.title || '', issuer: r.issuer || '', url: r.url || '', contact: r.contact || '', note: r.note || '', source: r.source || 'manual' });
    if (eff > cur.level || (eff === cur.level && TIERS.indexOf(r.type) > TIERS.indexOf(cur.tier))) {
      cur.level = eff;
      cur.tier = r.type;
    }
    by.set(r.skill_id, cur);
  }
  const out = new Map();
  for (const [id, v] of by) {
    const strong = [...v.tiers].filter((t) => t !== 'claim');
    const confidence = v.tiers.has('test') || strong.length >= 2 ? 'high' : strong.length === 1 ? 'medium' : 'low';
    out.set(id, { skill: id, level: v.level, tier: v.tier, confidence, evidence: v.evidence });
  }
  return out;
}

/** Level 0..5 to claim level for a CV/LinkedIn mention count (self-claims never exceed level 2). */
export function claimLevelFromMentions(count) {
  return count >= 2 ? 2 : 1;
}

/** Survey: answers is an array of 5 booleans ("I have done this" per level). Level = highest contiguous ticked level. */
export function surveyLevel(answers, example = '') {
  let level = 0;
  for (let i = 0; i < 5; i++) { if (answers[i]) level = i + 1; else break; }
  // Levels 3+ need one concrete example, otherwise the answer is capped at 2.
  if (level >= 3 && String(example || '').trim().length < 20) level = 2;
  return level;
}

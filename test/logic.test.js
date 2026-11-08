import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, ROLES, ADJACENCY, SKILL_BY_ID } from '../src/ontology.js';
import { extractSkills, extractRequirements, detectRole, parseCsv, linkedinCsvToText, yearsToLevel } from '../src/extract.js';
import { skillLevels, surveyLevel, claimLevelFromMentions } from '../src/evidence.js';
import { analyse, roleRequirements, buildGraph, transferFor } from '../src/gap.js';

test('ontology is consistent', () => {
  assert.equal(new Set(SKILLS.map((s) => s.id)).size, SKILLS.length);
  for (const r of ROLES) for (const [sk, [lvl, imp]] of Object.entries(r.req)) {
    assert.ok(SKILL_BY_ID[sk], `${r.id} uses unknown skill ${sk}`);
    assert.ok(lvl >= 1 && lvl <= 5 && imp >= 1 && imp <= 3);
  }
  assert.ok(ADJACENCY.get('statistics').length > 0);
});

test('extraction respects word boundaries', () => {
  const m = extractSkills('I like R programming and python. Our company is great. We use SQL daily, and sql again.');
  assert.ok(m.has('r') && m.has('python'));
  assert.equal(m.get('sql').count, 2);
  assert.ok(!extractSkills('the great company ran research').has('r'));
  assert.ok(extractSkills('Experience with A/B testing and CI/CD').has('ab_testing'));
});

test('job requirement extraction: importance, years, seniority', () => {
  const jd = `Senior Data Scientist
Requirements:
- 6+ years of Python and SQL experience
- Strong knowledge of machine learning
Nice to have:
- Familiarity with Spark`;
  const reqs = Object.fromEntries(extractRequirements(jd).map((r) => [r.skill, r]));
  assert.equal(reqs.python.level, 4);
  assert.equal(reqs.python.importance, 3);
  assert.equal(reqs.machine_learning.importance, 3);
  assert.equal(reqs.spark.importance, 1);
  assert.ok(reqs.spark.level <= reqs.python.level);
  assert.equal(yearsToLevel(1), 2);
  assert.equal(yearsToLevel(8), 5);
});

test('role detection prefers the longest title match', () => {
  assert.equal(detectRole('', 'Senior Data Scientist'), 'senior_data_scientist');
  assert.equal(detectRole('We are hiring a Manager, Data Science to lead the team'), 'ds_manager');
  assert.equal(detectRole('', 'Data Scientist'), 'data_scientist');
  assert.equal(detectRole('', 'Florist'), null);
});

test('LinkedIn CSV export parsing', () => {
  assert.deepEqual(parseCsv('Name\n"Machine Learning"\n"A, B"\n'), [['Name'], ['Machine Learning'], ['A, B']]);
  const t = linkedinCsvToText('Company Name,Title,Description\nAcme,Data Analyst,"Built dashboards in Tableau, wrote SQL"\n');
  assert.ok(extractSkills(t).has('sql') && extractSkills(t).has('data_viz'));
});

test('evidence ladder caps by tier and reports confidence', () => {
  const lv = skillLevels([
    { id: 1, skill_id: 'python', type: 'claim', level: 5 },
    { id: 2, skill_id: 'sql', type: 'claim', level: 1 }, { id: 3, skill_id: 'sql', type: 'survey', level: 3 },
    { id: 4, skill_id: 'sql', type: 'reference', level: 3 },
    { id: 5, skill_id: 'git', type: 'badge', level: 5 },
  ]);
  assert.equal(lv.get('python').level, 2); // a claim never exceeds level 2
  assert.equal(lv.get('python').confidence, 'low');
  assert.equal(lv.get('sql').confidence, 'high');
  assert.equal(lv.get('git').level, 3); // a badge is capped at 3
  assert.equal(lv.get('sql').tier, 'reference');
  assert.equal(claimLevelFromMentions(1), 1);
});

test('survey needs an example for level 3+', () => {
  assert.equal(surveyLevel([true, true, true, false, false], ''), 2);
  assert.equal(surveyLevel([true, true, true, false, false], 'Shipped a churn model used by the CRM team'), 3);
  assert.equal(surveyLevel([true, false, true, true, true], 'x'.repeat(40)), 1); // must be contiguous
  assert.equal(surveyLevel([false, true, true, true, true], 'x'.repeat(40)), 0);
});

test('gap analysis: met, close, transferable, missing', () => {
  const levels = skillLevels([
    { id: 1, skill_id: 'python', type: 'reference', level: 3 },
    { id: 2, skill_id: 'statistics', type: 'survey', level: 3 },
    { id: 3, skill_id: 'customer_analytics', type: 'survey', level: 3 },
    { id: 4, skill_id: 'sql', type: 'claim', level: 2 },
  ]);
  const a = analyse([
    { skill: 'python', level: 3, importance: 3 },
    { skill: 'sql', level: 3, importance: 3 },
    { skill: 'hypothesis_testing', level: 3, importance: 2 }, // transfer from statistics (0.8 * 3 = 2.4)
    { skill: 'recsys', level: 4, importance: 1 }, // weak transfer from customer analytics
    { skill: 'people_mgmt', level: 4, importance: 3 },
  ], levels);
  const by = Object.fromEntries(a.items.map((i) => [i.skill, i]));
  assert.equal(by.python.status, 'met');
  assert.equal(by.python.needsEvidence, false);
  assert.equal(by.sql.status, 'close');
  assert.equal(by.hypothesis_testing.status, 'transferable');
  assert.equal(by.hypothesis_testing.transfer.from, 'statistics');
  assert.equal(by.people_mgmt.status, 'missing');
  assert.ok(a.verifiedFit <= a.fit);
  assert.equal(a.items[0].skill, 'people_mgmt'); // worst first
  assert.equal(transferFor('people_mgmt', levels), null);
});

test('graph overlay includes required-but-missing skills and edges', () => {
  const levels = skillLevels([{ id: 1, skill_id: 'python', type: 'survey', level: 3 }]);
  const g = buildGraph(levels, roleRequirements('data_scientist'));
  const sql = g.nodes.find((n) => n.id === 'sql');
  assert.equal(sql.level, 0);
  assert.equal(sql.required, 3);
  assert.ok(g.categories.length > 1);
  assert.ok(g.summary.fit < 100);
  assert.equal(roleRequirements('nope'), null);
});

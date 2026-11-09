import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/worker.js';
import { makeD1 } from './d1shim.js';
import { instantiate, listTasks, TASKS } from '../src/tasks.js';
import { applicationItems, cleanDeclared } from '../src/application.js';
import { skillLevels } from '../src/evidence.js';

const HOST = 'https://covlescu.com';
const P = '/my_new_place/api';
function setup() {
  const env = { DB: makeD1(), SESSION_SECRET: 's', ENVIRONMENT: 'development', DEV_AUTH_EMAIL: 'me@gmail.com', ASSETS: { fetch: async () => new Response('x') } };
  const handler = createHandler();
  const call = async (method, path, body, cookie) => {
    const res = await handler(new Request(HOST + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, res };
  };
  const login = async (email) => { env.DEV_AUTH_EMAIL = email; return (await call('POST', `${P}/auth/dev`)).res.headers.get('set-cookie').split(';')[0]; };
  return { call, login };
}

test('tasks: same seed gives the same variant, different seeds differ, every task is well formed', () => {
  assert.ok(TASKS.some((t) => t.role === 'senior_data_scientist') && TASKS.some((t) => t.role === 'ds_manager'));
  for (const t of TASKS) {
    const a = instantiate(t.id, 7), b = instantiate(t.id, 7);
    assert.deepEqual(a, b);
    const variants = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => { const i = instantiate(t.id, s); return JSON.stringify([i.scenario, i.data]); }));
    assert.ok(variants.size > 1, `${t.id} varies with the seed`);
    assert.ok(a.questions.length >= 3 && a.rubric.length >= 3 && a.skills.length >= 3);
    for (const r of a.rubric) assert.deepEqual(Object.keys(r.signals), ['3', '4', '5']);
  }
  assert.equal(listTasks('ds_manager').every((t) => t.role === 'ds_manager'), true);
});

test('experiment task: the randomisation really is broken in the generated numbers', () => {
  const t = instantiate('sds_experiment_readout', 123);
  const [ctrl, trt] = t.data.rows;
  assert.ok(trt[1] < ctrl[1] * 0.98, 'treatment has fewer users than the planned 50/50 split');
});

test('application items flag stated levels above the evidence and never drop a required skill', () => {
  const levels = skillLevels([{ skill_id: 'sql', type: 'claim', level: 3 }, { skill_id: 'python', type: 'survey', level: 3 }]);
  const reqs = [{ skill: 'sql', level: 4, importance: 3 }, { skill: 'python', level: 3, importance: 3 }, { skill: 'strategy', level: 4, importance: 2 }];
  const items = Object.fromEntries(applicationItems(reqs, levels, { sql: 4, python: 3 }).map((i) => [i.skill, i]));
  assert.equal(items.sql.evidenced, 2); // claims cap at 2
  assert.equal(items.sql.flag, 'above_evidence');
  assert.equal(items.python.flag, null);
  assert.equal(items.strategy.status, 'missing'); // still listed
  assert.deepEqual(cleanDeclared({ sql: 9, python: '3', nope: 4, strategy: 0 }, reqs), { python: 3 });
});

test('candidate-controlled flow: state levels, employer requests an assessment, candidate declines or accepts and submits', async () => {
  const { call, login } = setup();
  const ck = await login('cand@gmail.com');
  await call('PUT', `${P}/profile`, { cv_text: 'Senior data scientist. Python, SQL, A/B testing, machine learning, causal inference, stakeholder management.' }, ck);

  // create against the generic senior role; candidate raises one level above the evidence
  let r = await call('POST', `${P}/applications`, { role_id: 'senior_data_scientist', display_name: 'A. Candidate' }, ck);
  assert.equal(r.status, 201);
  const id = r.data.id, token = r.data.share_token;
  assert.equal(token.length, 48);
  assert.ok(r.data.items.length >= 10, 'all role requirements are listed');
  r = await call('PUT', `${P}/applications/${id}`, { declared: { ab_testing: 4, python: 4 }, resolutions: { ab_testing: 'task', python: 'disclose', bogus: 'task' } }, ck);
  const ab = r.data.items.find((i) => i.skill === 'ab_testing');
  assert.equal(ab.stated, 4);
  assert.equal(ab.flag, 'above_evidence');
  assert.equal(ab.resolution, 'task');
  assert.ok(r.data.flagged.includes('ab_testing'));

  // employer view: no login, no email, no ranking number, evidence tier next to the stated level
  r = await call('GET', `${P}/share/${token}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.display_name, 'A. Candidate');
  const text = JSON.stringify(r.data);
  assert.ok(!text.includes('cand@gmail.com'), 'candidate email is never exposed');
  assert.ok(!('fit' in r.data) && !('fit' in r.data.summary), 'no single score is published');
  const eab = r.data.items.find((i) => i.skill === 'ab_testing');
  assert.equal(eab.flag, 'above_evidence');
  assert.equal(eab.tierLabel, 'Claimed');
  assert.equal((await call('GET', `${P}/share/nope`)).status, 404);

  // employer requests an assessment for the flagged skill (and a skill not in the application is refused)
  r = await call('POST', `${P}/share/${token}/request`, { skill: 'ab_testing', requested_by: 'Acme hiring', note: 'Please evidence experimentation depth.' });
  assert.equal(r.status, 201);
  assert.equal(r.data.hasTask, true);
  assert.equal((await call('POST', `${P}/share/${token}/request`, { skill: 'ab_testing' })).status, 409);
  assert.equal((await call('POST', `${P}/share/${token}/request`, { skill: 'excel' })).status, 400);

  // candidate sees the pending request and decides
  r = await call('GET', `${P}/applications/${id}`, null, ck);
  assert.equal(r.data.requests.length, 1);
  const reqId = r.data.requests[0].id;
  assert.equal((await call('GET', `${P}/applications`, null, ck)).data.applications[0].pending, 1);

  // another user cannot respond to it
  const other = await login('other@gmail.com');
  assert.equal((await call('POST', `${P}/requests/${reqId}/respond`, { action: 'accept' }, other)).status, 404);
  assert.equal((await call('GET', `${P}/applications/${id}`, null, other)).status, 404);

  r = await call('POST', `${P}/requests/${reqId}/respond`, { action: 'accept' }, ck);
  assert.equal(r.data.task.id, 'sds_experiment_readout');
  const seed = r.data.task.seed;

  // the task the candidate receives is the one the employer's request fixed
  r = await call('GET', `${P}/tasks/${r.data.task.id}?seed=${seed}`, null, ck);
  assert.equal(r.data.seed, seed);

  // too-short answers are refused; a real one is stored but not scored and does not change the level
  assert.equal((await call('POST', `${P}/tasks/sds_experiment_readout/submit`, { seed, answer: 'short', request_id: reqId }, ck)).status, 400);
  assert.equal((await call('POST', `${P}/tasks/sds_churn_model_review/submit`, { seed, answer: 'x'.repeat(200), request_id: reqId }, ck)).status, 400, 'wrong task for this request');
  r = await call('POST', `${P}/tasks/sds_experiment_readout/submit`, { seed, answer: 'The sample ratio is off: treatment lost about four percent of users, so randomisation is broken. '.repeat(3), request_id: reqId, share_with_employer: true }, ck);
  assert.equal(r.status, 201);
  assert.equal(r.data.scored, false);
  const prof = await call('GET', `${P}/profile`, null, ck);
  assert.ok(prof.data.skills.find((s) => s.skill === 'ab_testing').level <= 2, 'unscored task does not raise the level');
  assert.ok(!prof.data.skills.some((s) => s.tier === 'test'));

  r = await call('GET', `${P}/share/${token}`);
  const done = r.data.items.find((i) => i.skill === 'ab_testing');
  assert.equal(done.request.status, 'submitted');
  assert.equal(done.request.submission.scored, false);
  assert.ok(done.request.submission.answer.includes('sample ratio'));
  assert.equal(done.flag, 'above_evidence', 'flag stays: the task has not been scored');

  // declining is visible to the employer
  await call('POST', `${P}/share/${token}/request`, { skill: 'causal_inference' });
  const reqs = (await call('GET', `${P}/applications/${id}`, null, ck)).data.requests;
  const second = reqs.find((q) => q.skill_id === 'causal_inference');
  await call('POST', `${P}/requests/${second.id}/respond`, { action: 'decline' }, ck);
  r = await call('GET', `${P}/share/${token}`);
  assert.equal(r.data.items.find((i) => i.skill === 'causal_inference').request.status, 'declined');

  // request cap
  for (const s of ['python', 'sql', 'statistics']) await call('POST', `${P}/share/${token}/request`, { skill: s });
  assert.equal((await call('POST', `${P}/share/${token}/request`, { skill: 'machine_learning' })).status, 429);

  // deleting the application invalidates the link
  await call('DELETE', `${P}/applications/${id}`, null, ck);
  assert.equal((await call('GET', `${P}/share/${token}`)).status, 404);
});

test('unshared answers are hidden from the employer and tasks need sign-in', async () => {
  const { call, login } = setup();
  assert.equal((await call('GET', `${P}/tasks`)).status, 401);
  const ck = await login('c2@gmail.com');
  const a = (await call('POST', `${P}/applications`, { role_id: 'ds_manager' }, ck)).data;
  await call('POST', `${P}/share/${a.share_token}/request`, { skill: 'coaching' });
  const rid = (await call('GET', `${P}/applications/${a.id}`, null, ck)).data.requests[0].id;
  await call('POST', `${P}/requests/${rid}/respond`, { action: 'accept' }, ck);
  await call('POST', `${P}/tasks/dsm_performance_and_retention/submit`, { seed: 5, answer: 'I would start by asking the new hire how onboarding went and what the goals meant to them. '.repeat(3), request_id: rid, share_with_employer: false }, ck);
  const v = (await call('GET', `${P}/share/${a.share_token}`)).data.items.find((i) => i.skill === 'coaching');
  assert.equal(v.request.submission.answer, null);
  assert.equal(v.request.submission.shared, false);
});

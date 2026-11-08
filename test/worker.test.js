import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, safeJobUrl, htmlToText } from '../src/worker.js';
import { makeD1 } from './d1shim.js';
import { signSession, verifySession, verifyGoogleIdToken, b64urlEncode } from '../src/auth.js';

const HOST = 'https://covlescu.com';
function setup(extraEnv = {}, deps = {}) {
  const env = {
    DB: makeD1(), SESSION_SECRET: 'test-secret', ENVIRONMENT: 'development', DEV_AUTH_EMAIL: 'me@gmail.com', GOOGLE_CLIENT_ID: 'cid',
    ASSETS: { fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`) }, ...extraEnv,
  };
  const handler = createHandler(deps);
  const call = async (method, path, body, cookie, headers = {}) => {
    const res = await handler(new Request(HOST + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, res };
  };
  const login = async (email) => {
    env.DEV_AUTH_EMAIL = email;
    const r = await call('POST', '/my_new_place/api/auth/dev');
    return r.res.headers.get('set-cookie').split(';')[0];
  };
  return { env, call, login };
}
const P = '/my_new_place/api';

test('static assets and redirects', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/my_new_place/')).data, 'asset:/my_new_place/index.html');
  assert.equal((await call('GET', '/my_new_place/app.js')).data, 'asset:/my_new_place/app.js');
  assert.equal((await call('GET', '/my_new_place')).res.status, 301);
});

test('API requires sign-in; config and ontology are public', async () => {
  const { call } = setup();
  assert.equal((await call('GET', `${P}/profile`)).status, 401);
  assert.equal((await call('GET', `${P}/graph`)).status, 401);
  assert.equal((await call('GET', `${P}/config`)).data.googleClientId, 'cid');
  assert.ok((await call('GET', `${P}/ontology`)).data.skills.length > 30);
});

test('dev login is disabled outside development', async () => {
  const { call } = setup({ ENVIRONMENT: 'production' });
  assert.equal((await call('POST', `${P}/auth/dev`)).status, 404);
});

test('allow-list blocks other accounts', async () => {
  const { call } = setup({ ALLOWED_EMAILS: 'someone@gmail.com' });
  assert.equal((await call('POST', `${P}/auth/dev`)).status, 403);
});

test('full flow: profile -> role prompts -> survey -> evidence -> job gap -> graph', async () => {
  const { call, login } = setup();
  const ck = await login('me@gmail.com');
  assert.equal((await call('GET', `${P}/me`, null, ck)).data.email, 'me@gmail.com');

  let r = await call('PUT', `${P}/profile`, {
    linkedin_url: 'https://www.linkedin.com/in/someone',
    cv_text: 'Data analyst. Built dashboards in Tableau, wrote SQL daily, ran A/B testing for the marketing team. Managed a team of 3 analysts and did hiring.',
  }, ck);
  assert.equal(r.status, 200);
  assert.ok(r.data.skillsFound >= 5);

  r = await call('GET', `${P}/profile`, null, ck);
  const have = Object.fromEntries(r.data.skills.map((s) => [s.skill, s]));
  assert.equal(have.sql.tier, 'claim');
  assert.ok(have.people_mgmt && have.ab_testing);

  // role template: everything is claim-level, so evidence is asked for
  r = await call('GET', `${P}/roles/data_scientist`, null, ck);
  assert.equal(r.status, 200);
  const sqlItem = r.data.analysis.items.find((i) => i.skill === 'sql');
  assert.equal(sqlItem.needsEvidence, true);
  assert.deepEqual(sqlItem.actions, ['take_survey', 'add_reference', 'add_badge']);

  // survey: level 3 with example
  r = await call('GET', `${P}/survey/sql`, null, ck);
  assert.equal(r.data.levels.length, 5);
  r = await call('POST', `${P}/survey/sql`, { answers: [true, true, true, false, false], example: 'Wrote the SQL behind the weekly retention report used by 20 people.' }, ck);
  assert.equal(r.data.level, 3);
  r = await call('POST', `${P}/survey/sql`, { answers: [true, true, true, false, false], example: '' }, ck);
  assert.equal(r.data.level, 2); // replaces the previous survey row, capped without an example

  // badge + reference
  r = await call('POST', `${P}/evidence`, { type: 'badge', skill_id: 'python', title: 'Python for Data Science', issuer: 'Coursera', url: 'https://coursera.org/verify/abc', level: 3 }, ck);
  assert.equal(r.status, 201);
  const badgeId = r.data.id;
  assert.equal((await call('POST', `${P}/evidence`, { type: 'badge', skill_id: 'python', title: '' }, ck)).status, 400);
  assert.equal((await call('POST', `${P}/evidence`, { type: 'badge', skill_id: 'nope', title: 'x' }, ck)).status, 400);
  assert.equal((await call('POST', `${P}/evidence`, { type: 'test', skill_id: 'python', title: 'x' }, ck)).status, 400, 'users cannot self-grant measured tests');

  // job gap
  const jd = `Manager, Data Science
Requirements:
- 4+ years of people management and hiring
- Strong stakeholder management and strategy skills
- Experience with A/B testing and machine learning
Nice to have: Spark`;
  r = await call('POST', `${P}/gap`, { text: jd, title: 'Manager, Data Science' }, ck);
  assert.equal(r.status, 200);
  assert.equal(r.data.detectedRoleId, 'ds_manager');
  const items = Object.fromEntries(r.data.analysis.items.map((i) => [i.skill, i]));
  assert.equal(items.people_mgmt.status, 'gap'); // one CV mention is a level-1 claim, far below a manager role
  assert.ok(items.machine_learning.status !== 'met');
  assert.ok(r.data.analysis.fit > 0 && r.data.analysis.fit < 100);
  const jobId = r.data.jobId;
  assert.ok(jobId);

  r = await call('GET', `${P}/graph?job=${jobId}`, null, ck);
  assert.equal(r.data.overlay, 'Manager, Data Science');
  assert.ok(r.data.nodes.some((n) => n.id === 'strategy' && n.required));
  r = await call('GET', `${P}/graph?role=data_scientist`, null, ck);
  assert.ok(r.data.nodes.length > 8);
  assert.equal((await call('GET', `${P}/graph?role=nope`, null, ck)).status, 404);

  await call('DELETE', `${P}/evidence/${badgeId}`, null, ck);
  r = await call('GET', `${P}/profile`, null, ck);
  assert.equal(r.data.skills.find((s) => s.skill === 'python'), undefined, 'python had only the badge, which is now deleted');
  r = await call('GET', `${P}/jobs`, null, ck);
  assert.equal(r.data.jobs.length, 1);
});

test('users cannot see or delete each other\'s data', async () => {
  const { call, login } = setup();
  const a = await login('a@gmail.com');
  const b = await login('b@gmail.com');
  await call('PUT', `${P}/profile`, { cv_text: 'python and sql and statistics' }, a);
  const g = await call('POST', `${P}/gap`, { text: 'Data Scientist. Requirements: python, sql, statistics and machine learning experience.' }, a);
  assert.equal((await call('GET', `${P}/profile`, null, b)).data.skills.length, 0);
  assert.equal((await call('GET', `${P}/graph?job=${g.data.jobId}`, null, b)).status, 404);
  await call('DELETE', `${P}/jobs/${g.data.jobId}`, null, b);
  assert.equal((await call('GET', `${P}/jobs`, null, a)).data.jobs.length, 1);
});

test('input validation and cross-origin refusal', async () => {
  const { call, login } = setup();
  const ck = await login('v@gmail.com');
  assert.equal((await call('PUT', `${P}/profile`, { linkedin_url: 'https://evil.example/in/x' }, ck)).status, 400);
  assert.equal((await call('PUT', `${P}/profile`, { linkedin_url: 'javascript:alert(1)' }, ck)).status, 400);
  assert.equal((await call('POST', `${P}/gap`, { text: 'too short' }, ck)).status, 400);
  assert.equal((await call('POST', `${P}/gap`, { text: 'We want someone who loves gardening, painting and long walks on the beach every day.' }, ck)).status, 422);
  assert.equal((await call('POST', `${P}/gap`, { url: 'http://localhost/x' }, ck)).status, 400);
  assert.equal((await call('PUT', `${P}/profile`, { cv_text: 'sql' }, ck, { origin: 'https://evil.example' })).status, 403);
});

test('job URL import uses the injected fetcher and falls back cleanly', async () => {
  let asked;
  const { call, login } = setup({}, { fetchJobText: async (u) => { asked = u; return u.includes('good') ? 'Data Analyst role. Requirements: SQL, Excel, Tableau dashboards and strong communication with stakeholders.' : ''; } });
  const ck = await login('u@gmail.com');
  let r = await call('POST', `${P}/gap`, { url: 'https://jobs.example.com/good' }, ck);
  assert.equal(r.status, 200);
  assert.equal(asked, 'https://jobs.example.com/good');
  assert.equal(r.data.detectedRoleId, 'data_analyst');
  r = await call('POST', `${P}/gap`, { url: 'https://jobs.example.com/blocked' }, ck);
  assert.equal(r.status, 422);
  assert.equal((await call('POST', `${P}/gap`, { url: 'https://www.linkedin.com/jobs/view/1' }, ck)).status, 400);
});

test('helpers: safeJobUrl and htmlToText', () => {
  assert.equal(safeJobUrl('https://boards.example.com/job/1'), 'https://boards.example.com/job/1');
  for (const bad of ['http://x.com', 'https://127.0.0.1/a', 'https://localhost/a', 'https://[::1]/a', 'ftp://x.com', 'nonsense']) assert.equal(safeJobUrl(bad), null, bad);
  assert.equal(htmlToText('<h1>Hi</h1><script>x()</script><p>a &amp; b</p>'), 'Hi\n a & b');
});

test('session cookies: tampering and expiry are rejected', async () => {
  const good = await signSession({ email: 'a@b.c', exp: Date.now() + 1000 }, 's');
  assert.equal((await verifySession(good, 's')).email, 'a@b.c');
  assert.equal(await verifySession(good, 'other'), null);
  assert.equal(await verifySession(good.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')), 's'), null);
  assert.equal(await verifySession(await signSession({ email: 'a@b.c', exp: Date.now() - 1 }, 's'), 's'), null);
});

test('Google ID token verification', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
  const enc = (o) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
  const mint = async (claims, kid = 'k1') => {
    const head = enc({ alg: 'RS256', kid });
    const body = enc(claims);
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${b64urlEncode(new Uint8Array(sig))}`;
  };
  const now = Date.now();
  const ok = { iss: 'https://accounts.google.com', aud: 'cid', exp: Math.floor(now / 1000) + 600, email: 'Me@Gmail.com', email_verified: true, name: 'Me' };
  const opts = { clientId: 'cid', jwks: { keys: [jwk] }, now };
  assert.equal((await verifyGoogleIdToken(await mint(ok), opts)).email, 'me@gmail.com');
  await assert.rejects(verifyGoogleIdToken(await mint({ ...ok, aud: 'other' }), opts), /audience/);
  await assert.rejects(verifyGoogleIdToken(await mint({ ...ok, iss: 'https://evil' }), opts), /issuer/);
  await assert.rejects(verifyGoogleIdToken(await mint({ ...ok, exp: 1 }), opts), /expired/);
  await assert.rejects(verifyGoogleIdToken(await mint({ ...ok, email_verified: false }), opts), /verified/);
  await assert.rejects(verifyGoogleIdToken(await mint(ok, 'zzz'), opts), /key id/);
  const t = await mint(ok);
  const tampered = t.split('.'); tampered[1] = enc({ ...ok, email: 'evil@gmail.com' });
  await assert.rejects(verifyGoogleIdToken(tampered.join('.'), opts), /signature/);
});

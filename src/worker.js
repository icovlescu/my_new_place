import { SKILLS, SKILL_BY_ID, ROLES, ROLE_BY_ID, ANCHORS, LEVEL_NAMES, CATEGORIES } from './ontology.js';
import { extractSkills, extractRequirements, detectRole, linkedinCsvToText } from './extract.js';
import { skillLevels, claimLevelFromMentions, surveyLevel, clampLevel, TIERS, TIER_LABEL, TIER_CAP } from './evidence.js';
import { analyse, roleRequirements, extraStrengths, buildGraph } from './gap.js';
import { TASK_BY_ID, instantiate, listTasks, tasksForSkill } from './tasks.js';
import { newToken, cleanDeclared, cleanResolutions, defaultDeclared, applicationItems, summarise } from './application.js';
import { signSession, verifySession, verifyGoogleIdToken, getGoogleJwks, parseCookies } from './auth.js';

export const BASE = '/my_new_place';
const COOKIE = 'mnp_session';
const SESSION_MS = 14 * 24 * 3600 * 1000;
const LIMITS = { cv: 60000, linkedin: 60000, job: 30000, evidence: 300, jobs: 30, short: 200, applications: 20, requests: 5, answer: 12000 };

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (status, error) => json({ error }, status);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const httpUrl = (v) => {
  const s = str(v, 500);
  if (!s) return '';
  try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : ''; } catch { return ''; }
};

async function currentUser(request, env) {
  const c = parseCookies(request.headers.get('cookie'))[COOKIE];
  const s = await verifySession(c, env.SESSION_SECRET);
  return s ? { id: s.email, email: s.email } : null;
}

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=${BASE}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function startSession(env, email, name) {
  const lower = email.toLowerCase();
  const allowed = String(env.ALLOWED_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(lower)) return fail(403, 'This account is not on the allow-list.');
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, name) VALUES (?, ?)').bind(lower, name || '').run();
  const token = await signSession({ email: lower, exp: Date.now() + SESSION_MS }, env.SESSION_SECRET);
  return json({ email: lower }, 200, { 'set-cookie': sessionCookie(token, SESSION_MS / 1000) });
}

async function loadLevels(env, userId) {
  const { results } = await env.DB.prepare('SELECT * FROM evidence WHERE user_id = ?').bind(userId).all();
  return { rows: results, levels: skillLevels(results) };
}

async function loadProfile(env, userId) {
  return (await env.DB.prepare('SELECT linkedin_url, linkedin_text, cv_text, updated_at FROM profiles WHERE user_id = ?').bind(userId).first())
    || { linkedin_url: '', linkedin_text: '', cv_text: '', updated_at: null };
}

// ---- Fetching a public job posting by URL (best effort; many boards block this, then the user pastes the text) ----
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function safeJobUrl(v) {
  const u = httpUrl(v);
  if (!u) return null;
  const url = new URL(u);
  if (url.protocol !== 'https:') return null;
  const h = url.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':')) return null;
  if (/linkedin\.com$/.test(h)) return null; // LinkedIn blocks automated access; the user pastes the text
  return url.toString();
}

async function fetchJobText(url, fetchFn = fetch) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetchFn(url, { signal: ctl.signal, headers: { 'user-agent': 'my-new-place/0.1 (+job description import)' }, redirect: 'follow' });
    if (!r.ok) return '';
    const ct = r.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(ct)) return '';
    return htmlToText((await r.text()).slice(0, 500000)).slice(0, LIMITS.job);
  } catch { return ''; } finally { clearTimeout(t); }
}

// ---- Handlers ----
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

route('GET', '/api/config', async (ctx) => json({
  googleClientId: ctx.env.GOOGLE_CLIENT_ID || '',
  devAuth: ctx.env.ENVIRONMENT === 'development' && !!ctx.env.DEV_AUTH_EMAIL,
}));

route('GET', '/api/ontology', async () => json({
  categories: CATEGORIES,
  skills: SKILLS.map(({ id, label, cat, kind }) => ({ id, label, cat, kind })),
  roles: ROLES.map((r) => ({ id: r.id, title: r.title, level: r.level, skills: Object.keys(r.req).length })),
  levelNames: LEVEL_NAMES,
  tiers: TIERS.map((t) => ({ id: t, label: TIER_LABEL[t], cap: TIER_CAP[t] })),
}));

route('POST', '/api/auth/google', async (ctx) => {
  if (!ctx.env.GOOGLE_CLIENT_ID) return fail(500, 'GOOGLE_CLIENT_ID is not configured.');
  if (!ctx.env.SESSION_SECRET) return fail(500, 'SESSION_SECRET is not configured.');
  const body = await ctx.body();
  try {
    const jwks = await getGoogleJwks();
    const who = await verifyGoogleIdToken(str(body.credential, 4000), { clientId: ctx.env.GOOGLE_CLIENT_ID, jwks });
    return startSession(ctx.env, who.email, who.name);
  } catch (e) { return fail(401, `Sign-in failed: ${e.message}`); }
});

route('POST', '/api/auth/dev', async (ctx) => {
  if (ctx.env.ENVIRONMENT !== 'development' || !ctx.env.DEV_AUTH_EMAIL) return fail(404, 'Not found');
  return startSession(ctx.env, ctx.env.DEV_AUTH_EMAIL, 'Dev user');
});

route('POST', '/api/auth/logout', async () => json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) }));

route('GET', '/api/me', async (ctx) => (ctx.user ? json({ email: ctx.user.email }) : fail(401, 'Not signed in')));

route('GET', '/api/profile', async (ctx) => {
  const profile = await loadProfile(ctx.env, ctx.user.id);
  const { levels } = await loadLevels(ctx.env, ctx.user.id);
  return json({ profile, skills: [...levels.values()].map((l) => ({ ...l, label: SKILL_BY_ID[l.skill]?.label })) });
});

route('PUT', '/api/profile', async (ctx) => {
  const b = await ctx.body();
  const linkedinUrl = httpUrl(b.linkedin_url);
  if (b.linkedin_url && (!linkedinUrl || !/linkedin\.com\/in\//i.test(linkedinUrl))) return fail(400, 'Enter a LinkedIn profile URL such as https://www.linkedin.com/in/your-name');
  let linkedinText = str(b.linkedin_text, LIMITS.linkedin);
  if (b.linkedin_csv) linkedinText = `${linkedinText}\n${linkedinCsvToText(str(b.linkedin_csv, 400000))}`.trim().slice(0, LIMITS.linkedin);
  const cvText = str(b.cv_text, LIMITS.cv);
  const uid = ctx.user.id;
  const stmts = [
    ctx.env.DB.prepare(`INSERT INTO profiles (user_id, linkedin_url, linkedin_text, cv_text, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET linkedin_url = ?2, linkedin_text = ?3, cv_text = ?4, updated_at = datetime('now')`).bind(uid, linkedinUrl, linkedinText, cvText),
    ctx.env.DB.prepare("DELETE FROM evidence WHERE user_id = ? AND type = 'claim' AND source IN ('cv','linkedin')").bind(uid),
  ];
  let added = 0;
  for (const [source, text] of [['cv', cvText], ['linkedin', linkedinText]]) {
    for (const [skill, info] of extractSkills(text)) {
      added++;
      stmts.push(ctx.env.DB.prepare("INSERT INTO evidence (user_id, skill_id, type, level, title, note, source) VALUES (?, ?, 'claim', ?, ?, ?, ?)")
        .bind(uid, skill, claimLevelFromMentions(info.count), `Mentioned ${info.count}× in ${source === 'cv' ? 'CV' : 'LinkedIn'}`, info.snippet.slice(0, 200), source));
    }
  }
  await ctx.env.DB.batch(stmts);
  return json({ ok: true, skillsFound: added });
});

route('POST', '/api/evidence', async (ctx) => {
  const b = await ctx.body();
  const type = str(b.type, 20);
  if (!['claim', 'badge', 'reference'].includes(type)) return fail(400, 'type must be claim, badge or reference (use the survey endpoint for surveys).');
  if (!SKILL_BY_ID[b.skill_id]) return fail(400, 'Unknown skill.');
  const title = str(b.title, LIMITS.short);
  if (type !== 'claim' && !title) return fail(400, type === 'badge' ? 'Give the badge or certificate a name.' : 'Give the reference a name or role (who can vouch).');
  const { n } = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM evidence WHERE user_id = ?').bind(ctx.user.id).first();
  if (n >= LIMITS.evidence) return fail(400, 'Evidence limit reached.');
  const level = clampLevel(b.level || 1);
  const r = await ctx.env.DB.prepare('INSERT INTO evidence (user_id, skill_id, type, level, title, issuer, url, contact, note, source) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(ctx.user.id, b.skill_id, type, level, title, str(b.issuer, LIMITS.short), httpUrl(b.url), str(b.contact, LIMITS.short), str(b.note, 500), 'manual').run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null, effectiveLevel: Math.min(level, TIER_CAP[type]) }, 201);
});

route('DELETE', '/api/evidence/:id', async (ctx) => {
  await ctx.env.DB.prepare('DELETE FROM evidence WHERE id = ? AND user_id = ?').bind(Number(ctx.params.id), ctx.user.id).run();
  return json({ ok: true });
});

route('GET', '/api/survey/:skill', async (ctx) => {
  const sk = SKILL_BY_ID[ctx.params.skill];
  if (!sk) return fail(404, 'Unknown skill.');
  return json({
    skill: sk.id, label: sk.label,
    levels: ANCHORS[sk.kind].map((t, i) => ({ level: i + 1, name: LEVEL_NAMES[i + 1], text: t.replaceAll('{s}', sk.label) })),
    note: 'Tick every level you have genuinely done. Levels 3 and above need one concrete example, otherwise the result is capped at level 2.',
  });
});

route('POST', '/api/survey/:skill', async (ctx) => {
  const sk = SKILL_BY_ID[ctx.params.skill];
  if (!sk) return fail(404, 'Unknown skill.');
  const b = await ctx.body();
  const answers = Array.isArray(b.answers) ? b.answers.slice(0, 5).map(Boolean) : [];
  const example = str(b.example, 600);
  const level = surveyLevel(answers, example);
  const uid = ctx.user.id;
  const stmts = [ctx.env.DB.prepare("DELETE FROM evidence WHERE user_id = ? AND skill_id = ? AND type = 'survey'").bind(uid, sk.id)];
  if (level > 0) stmts.push(ctx.env.DB.prepare("INSERT INTO evidence (user_id, skill_id, type, level, title, note, source) VALUES (?, ?, 'survey', ?, ?, ?, 'survey')")
    .bind(uid, sk.id, level, `Self-assessed ${LEVEL_NAMES[level]} (level ${level})`, example));
  await ctx.env.DB.batch(stmts);
  return json({ ok: true, level, levelName: LEVEL_NAMES[level] || 'None', capped: answers[2] && level === 2 && example.length < 20 });
});

route('GET', '/api/roles/:id', async (ctx) => {
  const reqs = roleRequirements(ctx.params.id);
  if (!reqs) return fail(404, 'Unknown role.');
  const { levels } = await loadLevels(ctx.env, ctx.user.id);
  return json({ role: ROLE_BY_ID[ctx.params.id].title, analysis: analyse(reqs, levels), strengths: extraStrengths(reqs, levels) });
});

route('POST', '/api/gap', async (ctx) => {
  const b = await ctx.body();
  let text = str(b.text, LIMITS.job);
  let title = str(b.title, LIMITS.short);
  const url = str(b.url, 500) ? safeJobUrl(b.url) : '';
  if (b.url && !url && !text) return fail(400, 'That URL cannot be fetched (it must be a public https page; LinkedIn pages need the text pasted). Paste the job description instead.');
  if (!text && url) {
    text = await ctx.fetchJobText(url);
    if (!text) return fail(422, 'Could not read that page (it may need a login or block automated access). Paste the job description text instead.');
  }
  if (text.length < 40) return fail(400, 'Paste a job description (or a link to one).');
  const reqs = extractRequirements(text, title);
  if (!reqs.length) return fail(422, 'No known skills were found in that text. Try the full description with responsibilities and requirements.');
  const roleId = detectRole(text, title);
  const { n } = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM jobs WHERE user_id = ?').bind(ctx.user.id).first();
  let jobId = null;
  if (b.save !== false && n < LIMITS.jobs) {
    const r = await ctx.env.DB.prepare('INSERT INTO jobs (user_id, title, url, text, role_id) VALUES (?,?,?,?,?)').bind(ctx.user.id, title, url || '', text, roleId).run();
    jobId = r.meta?.last_row_id ?? null;
  }
  const { levels } = await loadLevels(ctx.env, ctx.user.id);
  return json({ jobId, title, detectedRole: roleId && ROLE_BY_ID[roleId].title, detectedRoleId: roleId, requirements: reqs, analysis: analyse(reqs, levels), strengths: extraStrengths(reqs, levels) });
});

route('GET', '/api/jobs', async (ctx) => {
  const { results } = await ctx.env.DB.prepare('SELECT id, title, url, role_id, created_at FROM jobs WHERE user_id = ? ORDER BY id DESC').bind(ctx.user.id).all();
  return json({ jobs: results });
});

route('DELETE', '/api/jobs/:id', async (ctx) => {
  await ctx.env.DB.prepare('DELETE FROM jobs WHERE id = ? AND user_id = ?').bind(Number(ctx.params.id), ctx.user.id).run();
  return json({ ok: true });
});

route('GET', '/api/graph', async (ctx) => {
  const { levels } = await loadLevels(ctx.env, ctx.user.id);
  let reqs = null, label = null;
  const jobId = ctx.url.searchParams.get('job');
  const roleId = ctx.url.searchParams.get('role');
  if (jobId) {
    const job = await ctx.env.DB.prepare('SELECT title, text FROM jobs WHERE id = ? AND user_id = ?').bind(Number(jobId), ctx.user.id).first();
    if (!job) return fail(404, 'Job not found.');
    reqs = extractRequirements(job.text, job.title); label = job.title || 'Saved job';
  } else if (roleId) {
    reqs = roleRequirements(roleId);
    if (!reqs) return fail(404, 'Unknown role.');
    label = ROLE_BY_ID[roleId].title;
  }
  return json({ overlay: label, ...buildGraph(levels, reqs) });
});

// ---- Assessment tasks (template layer; answers are stored, not scored) ----
const randomSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0] % 1000000) + 1;

route('GET', '/api/tasks', async (ctx) => json({ tasks: listTasks(ctx.url.searchParams.get('role') || null), generator: 'template', scoring: 'none' }));

route('GET', '/api/tasks/:id', async (ctx) => {
  const seed = Number(ctx.url.searchParams.get('seed')) || randomSeed();
  const t = instantiate(ctx.params.id, seed);
  return t ? json(t) : fail(404, 'Unknown task.');
});

route('POST', '/api/tasks/:id/submit', async (ctx) => {
  const t = TASK_BY_ID[ctx.params.id];
  if (!t) return fail(404, 'Unknown task.');
  const b = await ctx.body();
  const answer = str(b.answer, LIMITS.answer);
  if (answer.length < 80) return fail(400, 'Write your answer first (at least a few sentences).');
  const seed = Math.max(1, Math.round(Number(b.seed)) || randomSeed());
  let requestId = null;
  if (b.request_id) {
    const rq = await ctx.env.DB.prepare('SELECT r.id, r.status, r.task_id FROM assessment_requests r JOIN applications a ON a.id = r.application_id WHERE r.id = ? AND a.user_id = ?').bind(Number(b.request_id), ctx.user.id).first();
    if (!rq || rq.status === 'declined') return fail(404, 'Request not found or declined.');
    if (rq.task_id && rq.task_id !== t.id) return fail(400, 'This request is for a different task.');
    requestId = rq.id;
  }
  const r = await ctx.env.DB.prepare('INSERT INTO task_submissions (user_id, task_id, seed, request_id, answer, shared) VALUES (?,?,?,?,?,?)')
    .bind(ctx.user.id, t.id, seed, requestId, answer, b.share_with_employer === false ? 0 : 1).run();
  if (requestId) await ctx.env.DB.prepare("UPDATE assessment_requests SET status = 'submitted', updated_at = datetime('now') WHERE id = ?").bind(requestId).run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null, status: 'submitted', scored: false, note: 'Saved. There is no scoring step yet, so this does not change your level. If you shared it, the employer sees it as submitted and not scored.' }, 201);
});

// ---- Applications: the candidate states levels; the employer can request an assessment; the candidate decides ----
async function buildApplicationView(env, app, levels, { forEmployer = false } = {}) {
  const reqs = JSON.parse(app.requirements);
  const declared = JSON.parse(app.declared);
  const resolutions = JSON.parse(app.resolutions);
  const { results: rq } = await env.DB.prepare('SELECT id, skill_id, task_id, seed, requested_by, note, status, created_at FROM assessment_requests WHERE application_id = ? ORDER BY id').bind(app.id).all();
  const bySkill = new Map(rq.map((r) => [r.skill_id, r]));
  const items = applicationItems(reqs, levels, declared, resolutions, bySkill);
  const base = { id: app.id, title: app.title, role_id: app.role_id, display_name: app.display_name, summary: summarise(items), items };
  if (forEmployer) {
    const { results: subs } = await env.DB.prepare('SELECT request_id, answer, shared, created_at FROM task_submissions WHERE request_id IN (SELECT id FROM assessment_requests WHERE application_id = ?) ORDER BY id').bind(app.id).all();
    const latest = new Map(subs.map((s) => [s.request_id, s]));
    for (const it of items) {
      if (!it.request) continue;
      const s = latest.get(it.request.id);
      it.request = { status: it.request.status, requested_by: it.request.requested_by, note: it.request.note,
        submission: s ? { scored: false, answer: s.shared ? s.answer : null, shared: !!s.shared } : null };
    }
    return base;
  }
  return { ...base, share_token: app.share_token, requests: rq, flagged: items.filter((i) => i.flag === 'above_evidence').map((i) => i.skill) };
}

async function ownApplication(ctx) {
  return ctx.env.DB.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').bind(Number(ctx.params.id), ctx.user.id).first();
}

route('GET', '/api/applications', async (ctx) => {
  const { results } = await ctx.env.DB.prepare(`SELECT a.id, a.title, a.role_id, a.display_name, a.updated_at,
    (SELECT COUNT(*) FROM assessment_requests r WHERE r.application_id = a.id AND r.status = 'pending') AS pending
    FROM applications a WHERE a.user_id = ? ORDER BY a.id DESC`).bind(ctx.user.id).all();
  return json({ applications: results });
});

route('POST', '/api/applications', async (ctx) => {
  const b = await ctx.body();
  let reqs, title = str(b.title, LIMITS.short), roleId = null;
  if (b.job_id) {
    const job = await ctx.env.DB.prepare('SELECT title, text, role_id FROM jobs WHERE id = ? AND user_id = ?').bind(Number(b.job_id), ctx.user.id).first();
    if (!job) return fail(404, 'Job not found.');
    reqs = extractRequirements(job.text, job.title); title = title || job.title || 'Application'; roleId = job.role_id;
  } else if (b.role_id) {
    reqs = roleRequirements(b.role_id);
    if (!reqs) return fail(404, 'Unknown role.');
    roleId = b.role_id; title = title || ROLE_BY_ID[b.role_id].title;
  } else return fail(400, 'Choose a saved job or a role.');
  if (!reqs.length) return fail(422, 'No requirements to apply against.');
  const { n } = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM applications WHERE user_id = ?').bind(ctx.user.id).first();
  if (n >= LIMITS.applications) return fail(400, 'Application limit reached. Remove an old one first.');
  const { levels } = await loadLevels(ctx.env, ctx.user.id);
  const declared = b.declared ? cleanDeclared(b.declared, reqs) : defaultDeclared(reqs, levels);
  const r = await ctx.env.DB.prepare('INSERT INTO applications (user_id, title, role_id, display_name, requirements, declared, share_token) VALUES (?,?,?,?,?,?,?)')
    .bind(ctx.user.id, title, roleId, str(b.display_name, 80) || 'Candidate', JSON.stringify(reqs), JSON.stringify(declared), newToken()).run();
  const app = await ctx.env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(r.meta.last_row_id).first();
  return json(await buildApplicationView(ctx.env, app, levels), 201);
});

route('GET', '/api/applications/:id', async (ctx) => {
  const app = await ownApplication(ctx);
  if (!app) return fail(404, 'Application not found.');
  const { levels } = await loadLevels(ctx.env, ctx.user.id);
  return json(await buildApplicationView(ctx.env, app, levels));
});

route('PUT', '/api/applications/:id', async (ctx) => {
  const app = await ownApplication(ctx);
  if (!app) return fail(404, 'Application not found.');
  const b = await ctx.body();
  const reqs = JSON.parse(app.requirements);
  const declared = b.declared ? JSON.stringify(cleanDeclared(b.declared, reqs)) : app.declared;
  const resolutions = b.resolutions ? JSON.stringify(cleanResolutions(b.resolutions, reqs)) : app.resolutions;
  const name = b.display_name !== undefined ? (str(b.display_name, 80) || 'Candidate') : app.display_name;
  await ctx.env.DB.prepare("UPDATE applications SET declared = ?, resolutions = ?, display_name = ?, updated_at = datetime('now') WHERE id = ?").bind(declared, resolutions, name, app.id).run();
  const { levels } = await loadLevels(ctx.env, ctx.user.id);
  return json(await buildApplicationView(ctx.env, { ...app, declared, resolutions, display_name: name }, levels));
});

route('DELETE', '/api/applications/:id', async (ctx) => {
  await ctx.env.DB.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').bind(Number(ctx.params.id), ctx.user.id).run();
  return json({ ok: true });
});

route('POST', '/api/requests/:id/respond', async (ctx) => {
  const b = await ctx.body();
  if (!['accept', 'decline'].includes(b.action)) return fail(400, 'action must be accept or decline.');
  const rq = await ctx.env.DB.prepare('SELECT r.* FROM assessment_requests r JOIN applications a ON a.id = r.application_id WHERE r.id = ? AND a.user_id = ?').bind(Number(ctx.params.id), ctx.user.id).first();
  if (!rq) return fail(404, 'Request not found.');
  if (rq.status === 'submitted') return fail(400, 'Already submitted.');
  const status = b.action === 'accept' ? 'accepted' : 'declined';
  await ctx.env.DB.prepare("UPDATE assessment_requests SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(status, rq.id).run();
  return json({ ok: true, status, task: status === 'accepted' && rq.task_id ? { id: rq.task_id, seed: rq.seed } : null });
});

// ---- Employer side: read-only link. No account, no email, no ranking; the employer may ask for an assessment. ----
route('GET', '/api/share/:token', async (ctx) => {
  const app = await ctx.env.DB.prepare('SELECT * FROM applications WHERE share_token = ?').bind(ctx.params.token).first();
  if (!app) return fail(404, 'This link is not valid.');
  const { levels } = await loadLevels(ctx.env, app.user_id);
  return json({ ...(await buildApplicationView(ctx.env, app, levels, { forEmployer: true })), canRequest: LIMITS.requests });
});

route('POST', '/api/share/:token/request', async (ctx) => {
  const app = await ctx.env.DB.prepare('SELECT * FROM applications WHERE share_token = ?').bind(ctx.params.token).first();
  if (!app) return fail(404, 'This link is not valid.');
  const b = await ctx.body();
  const reqs = JSON.parse(app.requirements);
  if (!reqs.some((r) => r.skill === b.skill)) return fail(400, 'That skill is not part of this application.');
  const { n } = await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM assessment_requests WHERE application_id = ?').bind(app.id).first();
  if (n >= LIMITS.requests) return fail(429, 'The request limit for this application is reached.');
  const exists = await ctx.env.DB.prepare('SELECT id FROM assessment_requests WHERE application_id = ? AND skill_id = ?').bind(app.id, b.skill).first();
  if (exists) return fail(409, 'An assessment was already requested for this skill.');
  const role = reqs.find((r) => r.skill === b.skill);
  const task = tasksForSkill(b.skill, app.role_id)[0] || tasksForSkill(b.skill)[0] || null;
  await ctx.env.DB.prepare('INSERT INTO assessment_requests (application_id, skill_id, task_id, seed, requested_by, note) VALUES (?,?,?,?,?,?)')
    .bind(app.id, b.skill, task ? task.id : null, randomSeed(), str(b.requested_by, 80) || 'Hiring team', str(b.note, 300)).run();
  return json({ ok: true, status: 'pending', hasTask: !!task, requiredLevel: role.level }, 201);
});

export function createHandler(deps = {}) {
  return async function fetch(request, env, ctx0) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === BASE) return Response.redirect(`${url.origin}${BASE}/`, 301);
    if (!path.startsWith(`${BASE}/api/`)) {
      return env.ASSETS.fetch(path === `${BASE}/` ? new Request(new URL(`${BASE}/index.html`, url), request) : request);
    }
    const apiPath = path.slice(BASE.length);
    if (!['GET', 'HEAD'].includes(request.method)) {
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== url.host) return fail(403, 'Cross-origin request refused.');
    }
    const r = routes.find((x) => x.method === request.method && x.re.test(apiPath));
    if (!r) return fail(404, 'Not found');
    const params = apiPath.match(r.re).groups || {};
    const isPublic = ['/api/config', '/api/ontology', '/api/auth/google', '/api/auth/dev', '/api/auth/logout', '/api/me'].includes(apiPath) || apiPath.startsWith('/api/share/');
    const user = await currentUser(request, env);
    if (!user && !isPublic) return fail(401, 'Not signed in');
    const body = async () => {
      try { const j = await request.json(); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
    };
    try {
      return await r.handler({ env, request, url, params, user, body, fetchJobText: deps.fetchJobText || fetchJobText });
    } catch (e) {
      console.error('handler error', e);
      return fail(500, 'Something went wrong.');
    }
  };
}

export default { fetch: createHandler() };

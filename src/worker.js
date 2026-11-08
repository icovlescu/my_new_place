import { SKILLS, SKILL_BY_ID, ROLES, ROLE_BY_ID, ANCHORS, LEVEL_NAMES, CATEGORIES } from './ontology.js';
import { extractSkills, extractRequirements, detectRole, linkedinCsvToText } from './extract.js';
import { skillLevels, claimLevelFromMentions, surveyLevel, clampLevel, TIERS, TIER_LABEL, TIER_CAP } from './evidence.js';
import { analyse, roleRequirements, extraStrengths, buildGraph } from './gap.js';
import { signSession, verifySession, verifyGoogleIdToken, getGoogleJwks, parseCookies } from './auth.js';

export const BASE = '/my_new_place';
const COOKIE = 'mnp_session';
const SESSION_MS = 14 * 24 * 3600 * 1000;
const LIMITS = { cv: 60000, linkedin: 60000, job: 30000, evidence: 300, jobs: 30, short: 200 };

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
    const isPublic = ['/api/config', '/api/ontology', '/api/auth/google', '/api/auth/dev', '/api/auth/logout', '/api/me'].includes(apiPath);
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

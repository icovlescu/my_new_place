import { createGraph, TIER_COLOR } from '/my_new_place/graph.js';

const BASE = '/my_new_place';
const app = document.getElementById('app');
const state = { cfg: null, ont: null, me: null, tab: 'match', overlay: { type: '', id: '' }, appId: null };
const TIER_LABEL = { claim: 'Claimed', survey: 'Self-assessed', badge: 'Badge', reference: 'Reference', test: 'Measured' };
const STATUS_TEXT = { met: 'Met', close: 'Close', transferable: 'Transferable', gap: 'Gap', missing: 'Missing' };

// ---------- helpers ----------
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
}
async function api(path, method = 'GET', body) {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data = {};
  try { data = await r.json(); } catch { /* empty */ }
  if (r.status === 401 && path !== '/me') { state.me = null; renderSignIn(); throw new Error('Please sign in again.'); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
const msg = (text, kind = 'err') => el('div', { class: `msg ${kind}` }, text);
async function guarded(box, fn) {
  box.replaceChildren();
  try { await fn(); } catch (e) { box.replaceChildren(msg(e.message)); }
}
const pill = (cls, text) => el('span', { class: `pill ${cls || ''}` }, text);
const skillLabel = (id) => state.ont.skills.find((s) => s.id === id)?.label || id;
const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(f); });

// ---------- modal ----------
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
function openModal(...kids) { modalBody.replaceChildren(...kids); modal.hidden = false; }
function closeModal() { modal.hidden = true; modalBody.replaceChildren(); }

async function openSurvey(skillId, done) {
  const s = await api(`/survey/${skillId}`);
  const boxes = s.levels.map((l) => el('input', { type: 'checkbox' }));
  const example = el('textarea', { placeholder: 'One concrete example: what you did, how big, what changed (needed for level 3+).', style: 'min-height:80px' });
  const out = el('div');
  const save = el('button', { class: 'btn', onclick: async () => {
    save.disabled = true;
    await guarded(out, async () => {
      const r = await api(`/survey/${skillId}`, 'POST', { answers: boxes.map((b) => b.checked), example: example.value });
      closeModal();
      done && done(r);
    });
    save.disabled = false;
  } }, 'Save self-assessment');
  openModal(
    el('h2', {}, `How far have you taken ${s.label}?`),
    el('p', { class: 'muted small' }, s.note),
    ...s.levels.map((l, i) => el('label', { class: 'anchor' }, boxes[i], el('span', {}, el('b', {}, `${l.level} · ${l.name}: `), l.text))),
    el('label', {}, 'Example'), example, out,
    el('div', { class: 'row', style: 'margin-top:12px' }, save, el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel')),
  );
}

function openEvidence(type, skillId, done) {
  const isBadge = type === 'badge';
  const f = { title: el('input', { placeholder: isBadge ? 'e.g. Google Data Analytics Certificate' : 'e.g. Former manager at Acme (describes your SQL work)' }),
    issuer: el('input', { placeholder: isBadge ? 'Issuer (Coursera, Credly, MIT…)' : 'Company / relationship' }),
    url: el('input', { placeholder: isBadge ? 'Public verification link' : 'Link to work they can vouch for (optional)' }),
    contact: el('input', { placeholder: 'Their email (optional; stored only for you, not contacted yet)' }),
    level: el('select', {}, [1, 2, 3].map((n) => el('option', { value: n, selected: n === 3 }, `${n} · ${state.ont.levelNames[n]}`))),
    note: el('textarea', { style: 'min-height:70px', placeholder: 'What exactly does this show?' }) };
  const out = el('div');
  const save = el('button', { class: 'btn', onclick: async () => {
    save.disabled = true;
    await guarded(out, async () => {
      await api('/evidence', 'POST', { type, skill_id: skillId, title: f.title.value, issuer: f.issuer.value, url: f.url.value, contact: isBadge ? '' : f.contact.value, level: Number(f.level.value), note: f.note.value });
      closeModal(); done && done();
    });
    save.disabled = false;
  } }, 'Save');
  openModal(
    el('h2', {}, `${isBadge ? 'Add a badge or certificate' : 'Add a reference'} for ${skillLabel(skillId)}`),
    el('p', { class: 'muted small' }, 'Badges and references count up to level 3. They are shown as attested, not yet verified by us. Level 4+ needs a measured test (coming).'),
    el('label', {}, isBadge ? 'Badge / certificate' : 'Who can vouch'), f.title,
    el('label', {}, isBadge ? 'Issuer' : 'Relationship'), f.issuer,
    el('label', {}, 'Link'), f.url,
    isBadge ? null : [el('label', {}, 'Contact'), f.contact],
    el('label', {}, 'Level this supports'), f.level,
    el('label', {}, 'Note'), f.note, out,
    el('div', { class: 'row', style: 'margin-top:12px' }, save, el('button', { class: 'btn secondary', onclick: closeModal }, 'Cancel')),
  );
}

// ---------- sign-in ----------
function renderSignIn() {
  document.getElementById('nav').hidden = true;
  document.getElementById('who').replaceChildren();
  const g = el('div', { id: 'g-btn', style: 'margin-top:16px' });
  const out = el('div');
  app.replaceChildren(el('div', { class: 'card' },
    el('h2', {}, 'Find the skills you already have'),
    el('p', { class: 'muted' }, 'Bring your LinkedIn profile, CV, badges and references. Paste a job description, and see where you already fit, where you are close, and what evidence would close the gap.'),
    g, out,
    state.cfg.devAuth ? el('button', { class: 'btn secondary', style: 'margin-top:12px', onclick: async () => { await api('/auth/dev', 'POST'); await start(); } }, 'Dev sign-in (local only)') : null,
    !state.cfg.googleClientId ? msg('Google sign-in is not configured yet (GOOGLE_CLIENT_ID). See the README.') : null,
  ));
  if (!state.cfg.googleClientId) return;
  const s = el('script', { src: 'https://accounts.google.com/gsi/client', async: true, defer: true });
  s.onload = () => {
    window.google.accounts.id.initialize({ client_id: state.cfg.googleClientId, callback: async (resp) => {
      await guarded(out, async () => { await api('/auth/google', 'POST', { credential: resp.credential }); await start(); });
    } });
    window.google.accounts.id.renderButton(g, { theme: 'outline', size: 'large', text: 'signin_with' });
  };
  document.head.appendChild(s);
}

// ---------- shell ----------
async function start() {
  try { state.me = await api('/me'); } catch { state.me = null; }
  if (!state.me) return renderSignIn();
  document.getElementById('nav').hidden = false;
  document.getElementById('who').replaceChildren(state.me.email, el('button', { class: 'btn secondary small', onclick: async () => { await api('/auth/logout', 'POST'); state.me = null; renderSignIn(); } }, 'Sign out'));
  show(state.tab);
}
function show(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  ({ match: renderMatch, graph: renderGraph, applications: renderApplications, tasks: renderTasks, profile: renderProfile, evidence: renderEvidence })[tab]().catch?.((e) => app.replaceChildren(msg(e.message)));
}
document.getElementById('nav').addEventListener('click', (e) => { const t = e.target.dataset?.tab; if (t) show(t); });

// ---------- match a job ----------
function renderMatch() {
  const result = el('div');
  const title = el('input', { placeholder: 'Job title (optional)' });
  const url = el('input', { placeholder: 'https://… link to a public job posting' });
  const text = el('textarea', { placeholder: 'Or paste the job description here (works for LinkedIn postings too).' });
  const out = el('div');
  const run = el('button', { class: 'btn', onclick: async () => {
    run.disabled = true;
    await guarded(out, async () => {
      const body = { title: title.value, url: url.value, text: text.value };
      const rerun = async () => showAnalysis(result, await api('/gap', 'POST', { ...body, save: false }), rerun);
      showAnalysis(result, await api('/gap', 'POST', body), rerun);
    });
    run.disabled = false;
  } }, 'Map my skills to this job');
  const roles = el('div', { class: 'row' }, state.ont.roles.map((r) => el('button', { class: 'btn secondary', onclick: async () => {
    await guarded(out, async () => {
      const rerun = async () => showRole(result, r.id, rerun);
      await showRole(result, r.id, rerun);
    });
  } }, r.title)));
  app.replaceChildren(
    el('h2', {}, 'Match yourself to a job'),
    el('p', { class: 'muted' }, 'Many people do not realise they have the right skills in a different setting. Paste a role and we map what it asks for onto what you have shown, including adjacent skills that carry over.'),
    el('div', { class: 'card' },
      el('div', { class: 'row' }, el('div', { class: 'grow' }, el('label', {}, 'Job link'), url), el('div', { class: 'grow' }, el('label', {}, 'Title'), title)),
      el('label', {}, 'Job description'), text, out, el('div', { style: 'margin-top:10px' }, run)),
    el('div', { class: 'card' }, el('b', {}, 'Or measure yourself against a generic role'), el('p', { class: 'muted small' }, 'We will ask for references, badges or a short self-assessment on the skills that matter for the role.'), roles),
    result,
  );
}

async function showRole(box, roleId, rerun) {
  const r = await api(`/roles/${roleId}`);
  const needs = r.analysis.items.filter((i) => i.needsEvidence).length;
  showAnalysis(box, { title: r.role, detectedRole: null, analysis: r.analysis, strengths: r.strengths, roleId, rolePrompt: needs ? `To be assessed as a ${r.role} we need evidence for ${needs} of ${r.analysis.items.length} skills. Add a reference or badge, or take the short self-assessment.` : null }, rerun);
}

function showAnalysis(box, res, rerun) {
  const a = res.analysis;
  const refresh = () => rerun && rerun();
  const bar = (v) => el('div', { class: 'bar' }, el('i', { style: `width:${Math.min(100, v)}%` }));
  const rows = a.items.map((i) => el('tr', {},
    el('td', {}, el('b', {}, i.label), i.importance === 3 ? el('span', { class: 'muted small' }, ' · must have') : i.importance === 1 ? el('span', { class: 'muted small' }, ' · nice to have') : null),
    el('td', {}, `L${i.required}`),
    el('td', {}, i.have ? `L${i.have}` : '–', i.transfer && i.status !== 'met' ? el('div', { class: 'muted small' }, `via ${i.transfer.fromLabel} (L${i.transfer.fromLevel}) ≈ L${i.transfer.level}`) : null),
    el('td', {}, i.tierLabel ? el('span', {}, el('span', { class: 'dot', style: `background:${TIER_COLOR[i.tier]}` }), i.tierLabel) : el('span', { class: 'muted' }, 'none')),
    el('td', {}, pill(i.status, STATUS_TEXT[i.status])),
    el('td', {}, i.actions.length ? el('span', { class: 'row', style: 'gap:6px' },
      el('button', { class: 'btn small', onclick: () => openSurvey(i.skill, refresh) }, 'Self-assess'),
      el('button', { class: 'btn small secondary', onclick: () => openEvidence('reference', i.skill, refresh) }, 'Reference'),
      el('button', { class: 'btn small secondary', onclick: () => openEvidence('badge', i.skill, refresh) }, 'Badge')) : el('span', { class: 'muted small' }, 'evidenced')),
  ));
  box.replaceChildren(
    el('h3', {}, res.title ? `Fit for: ${res.title}` : 'Fit for this job'),
    res.rolePrompt ? msg(res.rolePrompt, 'ok') : null,
    el('div', { class: 'card kpis' },
      el('div', { class: 'kpi' }, el('span', { class: 'muted small' }, 'Fit with everything you have shown'), el('b', {}, `${a.fit}%`), bar(a.fit)),
      el('div', { class: 'kpi' }, el('span', { class: 'muted small' }, 'Fit backed by more than a claim'), el('b', {}, `${a.verifiedFit}%`), bar(a.verifiedFit)),
      el('div', { class: 'kpi' }, el('span', { class: 'muted small' }, 'Must-haves covered'), el('b', {}, `${a.mustHaveMet}/${a.mustHaveTotal}`)),
    ),
    res.detectedRole ? el('p', { class: 'muted' }, 'This looks like a ', el('b', {}, res.detectedRole), ' role. ', el('button', { class: 'btn small secondary', onclick: async () => { await guarded(box, async () => showRole(box, res.detectedRoleId, () => showRole(box, res.detectedRoleId))); } }, 'Check against the generic role')) : null,
    el('div', { class: 'card' }, el('table', {}, el('thead', {}, el('tr', {}, ['Skill', 'Needed', 'You', 'Evidence', 'Status', 'Strengthen'].map((h) => el('th', {}, h)))), el('tbody', {}, rows))),
    a.hiddenFit.length ? el('div', { class: 'card' }, el('b', {}, 'You may already have these in a different setting'), el('ul', {}, a.hiddenFit.map((i) => el('li', {}, `${i.label}: your ${i.transfer.fromLabel} (L${i.transfer.fromLevel}) carries over to about L${i.transfer.level}. Add a reference or example from that work to make it count.`)))) : null,
    res.strengths && res.strengths.length ? el('div', { class: 'card' }, el('b', {}, 'Strengths this role does not ask for, but you could mention'), el('p', {}, res.strengths.map((s) => `${s.label} (L${s.level})`).join(' · '))) : null,
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: async () => {
        await guarded(box, async () => {
          const a = await api('/applications', 'POST', res.jobId ? { job_id: res.jobId } : { role_id: res.roleId });
          state.appId = a.id; show('applications');
        });
      } }, 'Prepare an application from this'),
      el('button', { class: 'btn secondary', onclick: () => { state.overlay = res.jobId ? { type: 'job', id: res.jobId } : { type: 'role', id: res.roleId }; show('graph'); } }, 'See this on my skill graph'),
    ),
    el('p', { class: 'muted small' }, 'Requirements are read from the text with simple rules (keywords, years, “nice to have” sections). Check the levels before relying on them.'),
  );
}

// ---------- tasks (template mockups of the AI-generated assessment tasks) ----------
const roleTitle = (id) => state.ont.roles.find((r) => r.id === id)?.title || id;
const TASK_ROLES = { senior_data_scientist: 'Senior Data Scientist', ds_manager: 'Manager, Data Science & Analytics' };

async function renderTasks() {
  const { tasks } = await api('/tasks');
  const groups = Object.entries(TASK_ROLES).map(([role, title]) => el('div', {},
    el('h3', {}, title),
    el('div', { class: 'cards' }, tasks.filter((t) => t.role === role).map((t) => el('div', { class: 'card' },
      el('b', {}, t.title), el('div', { class: 'muted small' }, `${t.minutes} min · ${t.deliverable}`),
      el('div', { style: 'margin:8px 0' }, t.skills.map((s) => pill('', `${skillLabel(s.skill)} L${s.level}`))),
      el('button', { class: 'btn small', onclick: () => renderTask(t.id, null, null, () => show('tasks')) }, 'Open a practice version'))))));
  app.replaceChildren(
    el('h2', {}, 'Assessment tasks'),
    el('p', { class: 'muted' }, 'Short, realistic work samples for roles where a self-assessment is not enough. Each opening generates a variant with different numbers, so a shared answer does not transfer.'),
    msg('Mockup stage: variants come from templates today, and an AI generator will produce more in the same shape. Answers are stored but not scored yet, so a task does not change your level. A human or validated scoring step comes before any task can count as measured evidence.', 'ok'),
    ...groups,
  );
}

async function renderTask(taskId, seed, requestId, back) {
  const t = await api(`/tasks/${taskId}${seed ? `?seed=${seed}` : ''}`);
  const ans = el('textarea', { style: 'min-height:220px', placeholder: 'Write your answer. Keep to the deliverable and the time box.' });
  const share = el('input', { type: 'checkbox', checked: true });
  const out = el('div');
  const submit = el('button', { class: 'btn', onclick: async () => {
    submit.disabled = true;
    await guarded(out, async () => {
      const r = await api(`/tasks/${t.id}/submit`, 'POST', { seed: t.seed, answer: ans.value, request_id: requestId, share_with_employer: share.checked });
      out.replaceChildren(msg(r.note, 'ok'));
    });
    submit.disabled = false;
  } }, 'Submit answer');
  app.replaceChildren(
    el('button', { class: 'btn secondary small', onclick: back }, '← Back'),
    el('h2', { style: 'margin-top:10px' }, t.title),
    el('p', { class: 'muted small' }, `${roleTitle(t.role)} · about ${t.minutes} minutes · variant ${t.seed} · template-generated`),
    el('div', { class: 'card' }, el('b', {}, 'Scenario'), el('p', {}, t.scenario),
      el('table', {}, el('thead', {}, el('tr', {}, t.data.columns.map((c) => el('th', {}, c)))), el('tbody', {}, t.data.rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, String(c))))))),
      t.data.extra.map((x) => el('p', { class: 'muted small' }, x))),
    el('div', { class: 'card' }, el('b', {}, 'Questions'), el('ol', {}, t.questions.map((q) => el('li', {}, q))), el('p', { class: 'muted small' }, `Deliverable: ${t.deliverable}`)),
    el('details', { class: 'card' }, el('summary', {}, 'How answers will be read'), el('table', {}, el('thead', {}, el('tr', {}, ['Criterion', 'Level 3', 'Level 4', 'Level 5'].map((h) => el('th', {}, h)))),
      el('tbody', {}, t.rubric.map((r) => el('tr', {}, el('td', {}, r.criterion), el('td', {}, r.signals[3]), el('td', {}, r.signals[4]), el('td', {}, r.signals[5])))))),
    ans, el('label', { class: 'anchor' }, share, el('span', {}, 'Share this answer with the employer who requested it')), out, el('div', { style: 'margin-top:10px' }, submit),
  );
}

// ---------- applications: the candidate states levels and decides ----------
async function renderApplications() {
  if (state.appId) return renderApplication(state.appId);
  const { applications } = await api('/applications');
  app.replaceChildren(
    el('h2', {}, 'Applications'),
    el('p', { class: 'muted' }, 'You state your level for each requirement and decide how to handle each gap. Employers see your stated level next to what your evidence supports, and may ask for an assessment, which you can accept or decline.'),
    applications.length ? el('div', { class: 'card' }, el('table', {}, el('thead', {}, el('tr', {}, ['Application', 'Updated', 'Pending requests', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, applications.map((a) => el('tr', {}, el('td', {}, a.title), el('td', { class: 'muted' }, a.updated_at), el('td', {}, a.pending ? pill('gap', `${a.pending} waiting`) : '–'),
        el('td', {}, el('button', { class: 'btn small', onclick: () => { state.appId = a.id; renderApplications(); } }, 'Open'), ' ',
          el('button', { class: 'btn danger small', onclick: async () => { await api(`/applications/${a.id}`, 'DELETE'); renderApplications(); } }, 'Delete'))))))) : el('p', { class: 'muted' }, 'None yet. Run a job match and choose “Prepare an application from this”.'),
  );
}

async function renderApplication(id) {
  const a = await api(`/applications/${id}`);
  const declared = {}; const resolutions = {};
  a.items.forEach((i) => { if (i.stated) declared[i.skill] = i.stated; if (i.resolution) resolutions[i.skill] = i.resolution; });
  const name = el('input', { value: a.display_name || '' });
  const FLAG = { above_evidence: ['gap', 'Above evidence'], claim_only: ['', 'Claim only'] };
  const rows = a.items.map((i) => {
    const sel = el('select', { onchange: () => { if (sel.value) declared[i.skill] = Number(sel.value); else delete declared[i.skill]; } },
      el('option', { value: '' }, '–'), [1, 2, 3, 4, 5].map((n) => el('option', { value: n, selected: n === i.stated }, `L${n}`)));
    const res = el('select', { onchange: () => { if (res.value) resolutions[i.skill] = res.value; else delete resolutions[i.skill]; } },
      el('option', { value: '' }, 'Not decided'), el('option', { value: 'task', selected: i.resolution === 'task' }, 'Do a task'),
      el('option', { value: 'evidence', selected: i.resolution === 'evidence' }, 'Add evidence'), el('option', { value: 'disclose', selected: i.resolution === 'disclose' }, 'Submit with the gap'));
    const q = i.request;
    return el('tr', {},
      el('td', {}, el('b', {}, i.label), i.importance === 3 ? el('span', { class: 'muted small' }, ' · must have') : null),
      el('td', {}, `L${i.required}`), el('td', {}, sel),
      el('td', {}, i.evidenced ? `L${i.evidenced}` : '–', ' ', el('span', { class: 'muted small' }, i.tierLabel)),
      el('td', {}, i.flag ? pill(...FLAG[i.flag]) : pill(i.status, STATUS_TEXT[i.status] || i.status)), el('td', {}, res),
      el('td', {}, q ? requestCell(a, i, q) : el('span', { class: 'muted small' }, 'none')));
  });
  const link = `${location.origin}${BASE}/?share=${a.share_token}`;
  const out = el('div');
  app.replaceChildren(
    el('button', { class: 'btn secondary small', onclick: () => { state.appId = null; renderApplications(); } }, '← All applications'),
    el('h2', { style: 'margin-top:10px' }, a.title),
    el('div', { class: 'card kpis' },
      el('div', { class: 'kpi' }, el('span', { class: 'muted small' }, 'Must-haves you state as met'), el('b', {}, `${a.summary.mustHaveStated}/${a.summary.mustHaveTotal}`)),
      el('div', { class: 'kpi' }, el('span', { class: 'muted small' }, 'Must-haves your evidence supports'), el('b', {}, `${a.summary.mustHaveEvidenced}/${a.summary.mustHaveTotal}`)),
      el('div', { class: 'kpi' }, el('span', { class: 'muted small' }, 'Levels above your evidence'), el('b', {}, a.summary.flagged))),
    a.summary.flagged ? msg(`${a.summary.flagged} level${a.summary.flagged > 1 ? 's are' : ' is'} stated above what your evidence supports. The employer sees this and may ask for an assessment. For each one you can do a task, add a badge or reference, or submit with the gap visible.`, 'ok') : null,
    el('div', { class: 'card' }, el('table', {}, el('thead', {}, el('tr', {}, ['Requirement', 'Asked', 'You state', 'Evidence supports', 'Status', 'Your plan for the gap', 'Employer request'].map((h) => el('th', {}, h)))), el('tbody', {}, rows)),
      el('p', { class: 'muted small' }, 'All requirements are always shown to the employer, including the ones where you are below the ask.')),
    el('div', { class: 'row' }, el('div', { class: 'grow' }, el('label', {}, 'Name the employer sees (not your email)'), name)),
    out,
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'btn', onclick: async () => { await guarded(out, async () => { await api(`/applications/${id}`, 'PUT', { declared, resolutions, display_name: name.value }); renderApplication(id); }); } }, 'Save'),
      el('button', { class: 'btn secondary', onclick: () => show('evidence') }, 'Add evidence')),
    el('div', { class: 'card' }, el('b', {}, 'Employer link'), el('p', { class: 'muted small' }, 'Read-only, no account needed. Anyone with this link can view this application and request up to 5 assessments. Delete the application to revoke it.'),
      el('input', { value: link, readonly: true, onclick: (e) => e.target.select() })),
  );
}

function requestCell(a, i, q) {
  const label = { pending: 'Assessment requested', accepted: 'You accepted', declined: 'You declined', submitted: 'Submitted, not scored' }[q.status];
  const cell = el('div', {}, pill(q.status === 'declined' ? 'gap' : q.status === 'pending' ? 'close' : 'met', label), q.note ? el('div', { class: 'muted small' }, `“${q.note}”`) : null);
  const full = a.requests.find((r) => r.skill_id === i.skill);
  if (q.status === 'pending') cell.append(el('div', { class: 'row', style: 'gap:6px;margin-top:6px' },
    el('button', { class: 'btn small', onclick: async () => { await api(`/requests/${q.id}/respond`, 'POST', { action: 'accept' }); renderApplication(a.id); } }, 'Accept'),
    el('button', { class: 'btn danger small', onclick: async () => { await api(`/requests/${q.id}/respond`, 'POST', { action: 'decline' }); renderApplication(a.id); } }, 'Decline')));
  if (q.status === 'accepted' && q.task_id) cell.append(el('div', { style: 'margin-top:6px' }, el('button', { class: 'btn small', onclick: () => renderTask(q.task_id, full.seed, q.id, () => renderApplication(a.id)) }, 'Start the task')));
  return cell;
}

// ---------- employer view (no sign-in; link only) ----------
async function renderEmployer(token) {
  document.getElementById('nav').hidden = true;
  const a = await api(`/share/${token}`);
  const out = el('div');
  const by = el('input', { placeholder: 'Your name or team (shown to the candidate)' });
  const FLAGTXT = { above_evidence: ['gap', 'Stated above evidence'], claim_only: ['', 'Claim only'] };
  const rows = a.items.map((i) => el('tr', {},
    el('td', {}, el('b', {}, i.label), i.importance === 3 ? el('span', { class: 'muted small' }, ' · must have') : null),
    el('td', {}, `L${i.required}`), el('td', {}, i.stated ? `L${i.stated}` : '–'),
    el('td', {}, i.evidenced ? `L${i.evidenced}` : '–', ' ', el('span', { class: 'muted small' }, i.tierLabel)),
    el('td', {}, i.flag ? pill(...FLAGTXT[i.flag]) : pill(i.status, STATUS_TEXT[i.status] || i.status)),
    el('td', {}, i.resolution ? { task: 'Will do a task', evidence: 'Will add evidence', disclose: 'Submitted with the gap' }[i.resolution] : ''),
    el('td', {}, i.request ? el('div', {}, pill(i.request.status === 'declined' ? 'gap' : 'close', { pending: 'Requested, awaiting candidate', accepted: 'Candidate accepted', declined: 'Candidate declined', submitted: 'Answer submitted, not scored' }[i.request.status]),
        i.request.submission && i.request.submission.answer ? el('details', {}, el('summary', {}, 'Read the answer'), el('p', { style: 'white-space:pre-wrap' }, i.request.submission.answer)) : null)
      : el('button', { class: 'btn small secondary', onclick: async () => {
        await guarded(out, async () => { await api(`/share/${token}/request`, 'POST', { skill: i.skill, requested_by: by.value }); renderEmployer(token); });
      } }, 'Request assessment'))));
  app.replaceChildren(
    el('h2', {}, `${a.display_name} · ${a.title}`),
    el('p', { class: 'muted' }, 'The candidate stated each level and can change it. “Evidence supports” is what their CV, self-assessments, badges and references support. There is no overall score or ranking. A difference between the two columns is a reason to ask for an assessment, which the candidate may accept or decline.'),
    el('div', { class: 'card kpis' },
      el('div', { class: 'kpi' }, el('span', { class: 'muted small' }, 'Must-haves stated as met'), el('b', {}, `${a.summary.mustHaveStated}/${a.summary.mustHaveTotal}`)),
      el('div', { class: 'kpi' }, el('span', { class: 'muted small' }, 'Must-haves supported by evidence'), el('b', {}, `${a.summary.mustHaveEvidenced}/${a.summary.mustHaveTotal}`)),
      el('div', { class: 'kpi' }, el('span', { class: 'muted small' }, 'Levels stated above evidence'), el('b', {}, a.summary.flagged))),
    el('div', { class: 'card' }, el('table', {}, el('thead', {}, el('tr', {}, ['Requirement', 'Asked', 'Stated', 'Evidence supports', 'Flag', 'Candidate’s plan', 'Assessment'].map((h) => el('th', {}, h)))), el('tbody', {}, rows))),
    el('div', { class: 'row' }, el('div', { class: 'grow' }, el('label', {}, 'Requested by'), by)), out,
    el('p', { class: 'muted small' }, 'Assessment tasks are not scored yet. A hiring decision should rest on people, not on this page.'),
  );
}

// ---------- graph ----------
async function renderGraph() {
  const wrap = el('div', { id: 'graph-wrap' });
  const side = el('div', { class: 'side', hidden: true });
  const overlay = el('select', {});
  const level = el('select', {}, el('option', { value: 0 }, 'Off'), [1, 2, 3, 4, 5].map((n) => el('option', { value: n }, `${n} · ${state.ont.levelNames[n]}`)));
  const jobs = (await api('/jobs')).jobs;
  overlay.append(el('option', { value: '' }, 'Just my skills'),
    el('optgroup', { label: 'Generic roles' }, state.ont.roles.map((r) => el('option', { value: `role:${r.id}` }, r.title))),
    jobs.length ? el('optgroup', { label: 'Saved jobs' }, jobs.map((j) => el('option', { value: `job:${j.id}` }, j.title || `Job #${j.id}`))) : null);
  overlay.value = state.overlay.type ? `${state.overlay.type}:${state.overlay.id}` : '';
  if (overlay.value !== `${state.overlay.type}:${state.overlay.id}`) overlay.value = '';
  const status = el('span', { class: 'muted' });
  const graph = createGraph(wrap, { onSelect: (n) => showNode(side, n, load) });
  wrap.append(el('div', { class: 'graph-tools' },
    el('button', { class: 'btn secondary small', onclick: () => graph.zoomIn() }, '+'), el('button', { class: 'btn secondary small', onclick: () => graph.zoomOut() }, '−'), el('button', { class: 'btn secondary small', onclick: () => graph.reset() }, 'Reset')), side);
  async function load() {
    const v = overlay.value;
    state.overlay = v ? { type: v.split(':')[0], id: v.split(':')[1] } : { type: '', id: '' };
    const q = v ? (v.startsWith('job:') ? `?job=${v.slice(4)}` : `?role=${v.slice(5)}`) : '';
    const d = await api(`/graph${q}`);
    graph.setData(d);
    graph.setTargetLevel(Number(level.value));
    status.textContent = d.summary ? `${d.overlay}: fit ${d.summary.fit}% (${d.summary.verifiedFit}% backed by evidence)` : (d.nodes.length ? `${d.nodes.length} skills` : 'No skills yet: add your CV or LinkedIn text in My profile.');
  }
  overlay.addEventListener('change', () => { side.hidden = true; load(); });
  level.addEventListener('change', () => graph.setTargetLevel(Number(level.value)));
  app.replaceChildren(
    el('h2', {}, 'Your skill graph'),
    el('p', { class: 'muted' }, 'Scroll to zoom, drag to move. Click a group to zoom in, click a skill for its level ladder. Node size is your level; a dashed ring shows what the job or role asks for.'),
    el('div', { class: 'row' }, el('div', { class: 'grow' }, el('label', {}, 'Compare with'), overlay), el('div', { class: 'grow' }, el('label', {}, 'Job level check: highlight skills below level'), level)),
    el('div', { class: 'legend' }, Object.entries(TIER_LABEL).map(([k, v]) => el('span', {}, el('span', { class: 'dot', style: `background:${TIER_COLOR[k]}` }), v)), el('span', {}, '— dashed ring = required level (red gap, amber close, blue transferable, green met)')),
    status, wrap,
  );
  load().catch((e) => { status.textContent = e.message; });
}

async function showNode(side, n, reload) {
  side.hidden = false;
  const s = await api(`/survey/${n.id}`);
  side.replaceChildren(
    el('b', {}, n.label), ' ', n.tier ? pill('', TIER_LABEL[n.tier]) : pill('', 'no evidence'),
    el('p', {}, `Your level: ${n.level || '–'}${n.required ? ` · asked: L${n.required}` : ''}${n.status ? ` · ${STATUS_TEXT[n.status]}` : ''}`),
    n.transfer ? el('p', { class: 'muted' }, `Carries over from ${skillLabel(n.transfer.from)} (≈ L${n.transfer.level})`) : null,
    el('div', {}, s.levels.map((l) => el('div', { style: `padding:3px 0;${l.level === n.level ? 'font-weight:700;color:#2f6fed' : ''}${n.required === l.level ? ';border-left:3px solid #c98a00;padding-left:6px' : ''}` }, `L${l.level} ${l.name}: `, l.text))),
    el('div', { class: 'row', style: 'margin-top:8px;gap:6px' },
      el('button', { class: 'btn small', onclick: () => openSurvey(n.id, reload) }, 'Self-assess'),
      el('button', { class: 'btn small secondary', onclick: () => openEvidence('reference', n.id, reload) }, 'Reference'),
      el('button', { class: 'btn small secondary', onclick: () => openEvidence('badge', n.id, reload) }, 'Badge')),
  );
}

// ---------- profile ----------
async function renderProfile() {
  const { profile, skills } = await api('/profile');
  const li = el('input', { value: profile.linkedin_url || '', placeholder: 'https://www.linkedin.com/in/your-name' });
  const liText = el('textarea', { placeholder: 'Paste your LinkedIn About, Experience and Skills text here.' }); liText.value = profile.linkedin_text || '';
  const cv = el('textarea', { placeholder: 'Paste your CV as text.', style: 'min-height:220px' }); cv.value = profile.cv_text || '';
  let csv = '';
  const csvIn = el('input', { type: 'file', accept: '.csv', multiple: true, onchange: async (e) => { csv = (await Promise.all([...e.target.files].map(readFile))).join('\n'); } });
  const cvIn = el('input', { type: 'file', accept: '.txt,.md', onchange: async (e) => { if (e.target.files[0]) cv.value = await readFile(e.target.files[0]); } });
  const out = el('div');
  const save = el('button', { class: 'btn', onclick: async () => {
    save.disabled = true;
    await guarded(out, async () => {
      const r = await api('/profile', 'PUT', { linkedin_url: li.value, linkedin_text: liText.value, linkedin_csv: csv, cv_text: cv.value });
      out.replaceChildren(msg(`Saved. Found ${r.skillsFound} skill mentions.`, 'ok'));
      renderSkillTable();
    });
    save.disabled = false;
  } }, 'Save and find my skills');
  const table = el('div');
  async function renderSkillTable() {
    const p = await api('/profile');
    const rows = p.skills.sort((a, b) => b.level - a.level).map((s) => el('tr', {}, el('td', {}, s.label), el('td', {}, `L${s.level}`), el('td', {}, el('span', { class: 'dot', style: `background:${TIER_COLOR[s.tier]}` }), TIER_LABEL[s.tier]), el('td', {}, s.confidence)));
    table.replaceChildren(rows.length ? el('table', {}, el('thead', {}, el('tr', {}, ['Skill', 'Level', 'Best evidence', 'Confidence'].map((h) => el('th', {}, h)))), el('tbody', {}, rows)) : el('p', { class: 'muted' }, 'No skills yet.'));
  }
  const pick = el('select', {}, state.ont.skills.map((s) => el('option', { value: s.id }, s.label)));
  app.replaceChildren(
    el('h2', {}, 'My profile'),
    el('div', { class: 'card' },
      el('b', {}, 'LinkedIn'),
      el('p', { class: 'muted small' }, 'LinkedIn does not allow automated reading of profiles, so we keep your URL as a reference and read what you give us: paste profile text, or upload the CSV files from LinkedIn’s “Get a copy of your data” (Skills.csv, Positions.csv).'),
      el('label', {}, 'Profile URL'), li, el('label', {}, 'Pasted profile text'), liText, el('label', {}, 'LinkedIn export CSV files'), csvIn),
    el('div', { class: 'card' }, el('b', {}, 'CV'), el('label', {}, 'CV text (paste, or load a .txt / .md file; for PDF or Word, copy the text)'), cv, cvIn),
    out, save,
    el('h3', {}, 'Skills we found'), el('p', { class: 'muted small' }, 'Skills claimed in a CV or profile count up to level 2 until you add a self-assessment, badge or reference.'), table,
    el('h3', {}, 'Add a skill we missed'),
    el('div', { class: 'row' }, el('div', { class: 'grow' }, pick), el('button', { class: 'btn secondary', onclick: () => openSurvey(pick.value, renderSkillTable) }, 'Self-assess it')),
  );
  renderSkillTable();
}

// ---------- evidence ----------
async function renderEvidence() {
  const { skills } = await api('/profile');
  const rows = [];
  for (const s of skills) for (const e of s.evidence) rows.push({ s, e });
  const reload = () => renderEvidence();
  app.replaceChildren(
    el('h2', {}, 'Evidence'),
    el('p', { class: 'muted' }, 'Everything behind your levels. Higher rungs carry more weight: claimed (up to L2), self-assessed, badge or reference (up to L3), measured (up to L5, coming).'),
    rows.length ? el('div', { class: 'card' }, el('table', {}, el('thead', {}, el('tr', {}, ['Skill', 'Type', 'Level', 'Detail', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, rows.map(({ s, e }) => el('tr', {}, el('td', {}, s.label), el('td', {}, TIER_LABEL[e.type]), el('td', {}, `L${e.level}${e.effective < e.level ? ` → counts as L${e.effective}` : ''}`),
        el('td', {}, e.title, e.issuer ? ` · ${e.issuer}` : '', e.url ? el('span', {}, ' · ', el('a', { href: e.url, target: '_blank', rel: 'noopener noreferrer' }, 'link')) : null),
        el('td', {}, e.type === 'claim' && e.source !== 'manual' ? null : el('button', { class: 'btn danger small', onclick: async () => { await api(`/evidence/${e.id}`, 'DELETE'); reload(); } }, 'Remove'))))))) : el('p', { class: 'muted' }, 'No evidence yet. Save your CV in My profile, or run a job match and add a self-assessment.'),
  );
}

// ---------- boot ----------
(async () => {
  try {
    [state.cfg, state.ont] = await Promise.all([api('/config'), api('/ontology')]);
    const share = new URLSearchParams(location.search).get('share');
    if (share) { document.getElementById('who').replaceChildren(); return await renderEmployer(share); }
    await start();
  } catch (e) { app.replaceChildren(msg(`Could not start: ${e.message}`)); }
})();

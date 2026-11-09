# my_new_place

A discovery tool for the skills you already have. Give it your LinkedIn text/URL, CV, badges and references, paste a job description, and it maps what the role asks for onto what you have shown, including adjacent skills that carry over from a different setting.

Runs as one Cloudflare Worker with a D1 database (free tier), served at `https://covlescu.com/my_new_place`.

## What it does

| Area | Behaviour |
|---|---|
| Profile | LinkedIn URL (kept as a reference), pasted profile text, LinkedIn export CSVs, CV text. Skills are found with a built-in vocabulary of 44 skills |
| Evidence ladder | claim (max L2) < self-assessed survey (max L3) < badge / reference (max L3, attested, not verified yet) < measured test (max L5, reserved) |
| Generic roles | Data Analyst, Data Scientist, Senior Data Scientist, Manager Data Science, ML Engineer. Choosing one lists the skills that still need a reference, badge or self-assessment |
| Job match (main page) | Paste a job description or a public https link. Requirements, levels and must-haves are read with simple rules; the result shows fit, evidence-backed fit, gaps, and "you may already have this" transfers |
| Skill graph | Zoomable SVG: categories, then skills, then level ladders. Overlay a role or saved job; "job level check" highlights skills below a chosen level |

Honest limits: LinkedIn cannot be read automatically (no scraping; the EEA-only portability API is a later option). Requirement extraction is rule-based. Badges and references are not verified yet. The skill vocabulary and adjacency weights are a hand-built starter set, to be mapped to ESCO / O*NET.

## Layout

- `src/ontology.js` skills, adjacency, role templates, level anchors
- `src/extract.js` text to skills, job description to requirements, LinkedIn CSV
- `src/evidence.js` evidence ladder and survey scoring
- `src/gap.js` gap analysis and graph data
- `src/auth.js`, `src/worker.js` Google sign-in, sessions, API
- `public/my_new_place/` web interface
- `migrations/0001_init.sql` D1 schema
- `test/` unit and integration tests (`npm test`, Node 22, no dependencies; D1 is emulated with `node:sqlite`)

## Deploy

1. `npm install`
2. `npx wrangler d1 create my_new_place`, put the returned id in `wrangler.toml`
3. `npx wrangler d1 migrations apply my_new_place --remote`
4. Google Cloud Console: create an OAuth client of type "Web application", add `https://covlescu.com` as an authorised JavaScript origin, copy the client id into `GOOGLE_CLIENT_ID` in `wrangler.toml`
5. `npx wrangler secret put SESSION_SECRET` (a long random string)
6. Optional: set `ALLOWED_EMAILS` to restrict sign-in to your Gmail address
7. `npx wrangler deploy`. The route `covlescu.com/my_new_place*` needs covlescu.com on Cloudflare; it is more specific than any catch-all Worker already bound to the domain

## Local development

Create `.dev.vars`:

```
ENVIRONMENT=development
DEV_AUTH_EMAIL=you@gmail.com
SESSION_SECRET=local-secret
```

Then `npm run db:local` and `npm run dev`, and open `http://localhost:8787/my_new_place/`. The "Dev sign-in" button only exists when `ENVIRONMENT=development`; never set that in production.

## Privacy

Stores your profile text, evidence and saved jobs in D1 under your Google email. Referee contact details are stored for you only and nobody is contacted. Row sizes and counts are capped.

## Status

Not yet run under `wrangler dev` or deployed (built without registry access). Logic, API and auth are covered by `npm test`; the browser UI has only been syntax-checked.


## Applications and assessment tasks (added)

- **Applications tab**: from a job match, "Prepare an application". You state a level per requirement; the page shows what your evidence supports next to it and flags levels stated above the evidence. For each gap you pick: do a task, add evidence, or submit with the gap visible. Every requirement is always listed, so a gap cannot be hidden by omission.
- **Employer link** (`/my_new_place/?share=<token>`): read-only, no account, no email, no overall score or ranking. The employer can request an assessment for a skill (max 5); you accept or decline, and a decline is visible.
- **Tasks tab**: parametrised work samples for Senior Data Scientist and Manager, Data Science & Analytics. A seed fixes the numbers. These are templates today; an LLM generator is meant to produce more variants in the same shape (`brief` field per task).
- **Not scored yet**: answers are stored and never change a level. Only a scoring step (human reviewer or a validated rubric) may create `test` evidence.

Apply migrations again (`npm run db:remote`) to create the new tables.

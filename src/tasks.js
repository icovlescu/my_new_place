// Assessment tasks for roles where a self-assessment is not enough.
//
// STATUS: this is the template layer of the "AI-generated task" idea. Each task is a parametrised scenario:
// a seed fixes the numbers, so two candidates get different data and a shared answer does not transfer.
// The `brief` field is the instruction an LLM generator will receive to produce further variants in the same shape.
// Nothing here scores an answer. A submission is stored and shown as "submitted, not yet scored";
// only a scoring step (human reviewer or a validated rubric model) may later create `test` evidence.

// Small deterministic PRNG (mulberry32) so a seed always gives the same variant.
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi, step = 1) => lo + Math.floor((r() * (hi - lo)) / step + 1e-9) * step;
const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;

const SIGNALS = (l3, l4, l5) => ({ 3: l3, 4: l4, 5: l5 });

export const TASKS = [
  {
    id: 'sds_experiment_readout',
    role: 'senior_data_scientist',
    title: 'Experiment readout with a broken randomisation',
    minutes: 60,
    skills: [['ab_testing', 4], ['causal_inference', 3], ['statistics', 4], ['communication', 4], ['stakeholder', 4]],
    deliverable: 'A one-page decision memo (max 300 words) plus a short list of the checks you ran.',
    brief: 'Generate a two-arm product experiment readout where the headline lift is positive but one data-quality problem (sample ratio mismatch, novelty decay, or a segment mix shift) changes the decision. Randomise the numbers; keep the hidden flaw discoverable from the table alone.',
    build(r) {
      const n = between(r, 180, 260, 10) * 1000;
      const skew = between(r, 3, 6) / 100; // treatment loses this share of users to a logging bug
      const ctrlN = n;
      const trtN = Math.round(n * (1 - skew));
      const base = between(r, 38, 52) / 1000; // baseline conversion
      const lift = between(r, 6, 11) / 100; // relative headline lift
      const trtRate = base * (1 + lift);
      const week1 = trtRate * (1 + between(r, 14, 22) / 100);
      const week2 = trtRate * (1 - between(r, 2, 6) / 100);
      return {
        scenario: `Your team ran a 14-day test of a redesigned checkout reminder. Allocation was planned 50/50. The product lead wants to ship today and has asked you for a go / no-go.`,
        data: {
          columns: ['arm', 'users', 'orders', 'conversion'],
          rows: [
            ['control', ctrlN, Math.round(ctrlN * base), pct(Math.round(ctrlN * base), ctrlN)],
            ['treatment', trtN, Math.round(trtN * trtRate), pct(Math.round(trtN * trtRate), trtN)],
          ],
          extra: [`Treatment conversion in week 1: ${(week1 * 100).toFixed(2)}%; week 2: ${(week2 * 100).toFixed(2)}%.`, `Control is flat across both weeks.`],
        },
        questions: [
          'What is wrong, or possibly wrong, with this experiment? Name the check that shows it.',
          'What can and cannot be concluded about the effect? Give the estimate you would stand behind, with uncertainty.',
          'What do you recommend today, and what would change your mind?',
        ],
      };
    },
    rubric: [
      { criterion: 'Detects the sample ratio mismatch and the week-1 vs week-2 decay', signals: SIGNALS('Notices one of the two', 'Notices both and runs a test for the mismatch', 'Also explains likely mechanisms and how to confirm each') },
      { criterion: 'Separates what is estimable from what is not', signals: SIGNALS('Reports the headline lift with a confidence interval', 'Refuses the headline lift and gives a bounded or later-period estimate', 'Proposes a design that would identify the effect (rerun, holdout, bounds)') },
      { criterion: 'Decision memo a non-statistician can act on', signals: SIGNALS('Clear recommendation', 'Recommendation plus conditions and cost of being wrong', 'Frames the call for the stakeholder’s incentives and proposes next steps with owners') },
    ],
  },
  {
    id: 'sds_churn_model_review',
    role: 'senior_data_scientist',
    title: 'Review a churn model before it ships',
    minutes: 45,
    skills: [['machine_learning', 4], ['model_eval', 4], ['mlops', 3], ['problem_solving', 4]],
    deliverable: 'A review with a ranked list of risks, the evaluation you would run instead, and a monitoring plan.',
    brief: 'Generate a model-review scenario where the offline metric is impressive because of leakage or a mis-specified label window. Randomise the metric and feature list; include one legitimate strong feature so the reviewer must discriminate.',
    build(r) {
      const auc = (0.93 + between(r, 0, 4) / 1000).toFixed(3);
      const window = between(r, 14, 30, 7);
      return {
        scenario: `A teammate built a model that predicts which subscribers cancel within ${window} days. Offline AUC is ${auc} on a random 80/20 split. Retention wants to use it next week to decide who gets a discount.`,
        data: {
          columns: ['feature', 'note'],
          rows: [
            ['days_since_last_login', 'computed at prediction time'],
            ['support_tickets_last_30d', 'window ends on the label date'],
            ['cancellation_page_views', 'logged from the same session'],
            ['plan_tier', 'static'],
            ['discount_offered', 'set by the retention team after churn risk is flagged'],
          ],
          extra: ['Churners are 4% of subscribers. Each user appears once per month in the training table.'],
        },
        questions: [
          'Which features or choices make the AUC unreliable, and why?',
          'Design the evaluation you would trust for this decision (split, metric, baseline).',
          'The model drives discounts. What goes wrong after launch, and what do you monitor?',
        ],
      };
    },
    rubric: [
      { criterion: 'Finds leakage and the feedback loop', signals: SIGNALS('Finds cancellation_page_views', 'Also finds the label-date window and discount_offered', 'Also explains the policy feedback loop and selection bias after launch') },
      { criterion: 'Evaluation fit for the decision', signals: SIGNALS('Time-based split', 'Time split, precision at the budgeted top-k, calibration, naive baseline', 'Uplift framing: who is persuadable, not who is likely to churn') },
      { criterion: 'Operational plan', signals: SIGNALS('Mentions drift monitoring', 'Concrete metrics, thresholds, owner and rollback', 'Staged rollout with a holdout that keeps measuring the policy') },
    ],
  },
  {
    id: 'dsm_capacity_prioritisation',
    role: 'ds_manager',
    title: 'Team of twelve, eight requests, two open roles',
    minutes: 60,
    skills: [['strategy', 4], ['stakeholder', 4], ['budgeting', 3], ['hiring', 3], ['project_mgmt', 3]],
    deliverable: 'A one-page plan: what the team does and does not do next quarter, the hiring decision, and the message to the stakeholder you disappoint.',
    brief: 'Generate a capacity-planning scenario for a data science and analytics team: more requests than capacity, one request from a senior sponsor with weak value, and a hiring trade-off between a senior and two juniors. Randomise team size, headcount and effort estimates.',
    build(r) {
      const team = between(r, 9, 14);
      const open = between(r, 1, 3);
      const eff = [between(r, 18, 30), between(r, 12, 20), between(r, 20, 34), between(r, 6, 12), between(r, 14, 24), between(r, 8, 16), between(r, 10, 18), between(r, 24, 36)];
      const capacity = team * 11; // person-weeks per quarter after leave and run work
      return {
        scenario: `You manage ${team} data scientists and analysts, with ${open} open requisition${open > 1 ? 's' : ''}. Realistic capacity next quarter is about ${capacity} person-weeks after run work and leave. Eight requests have arrived.`,
        data: {
          columns: ['request', 'sponsor', 'person-weeks', 'expected impact'],
          rows: [
            ['Pricing experiment platform', 'VP Product', eff[0], 'High, measurable'],
            ['Churn model v2', 'Director Retention', eff[1], 'Medium, depends on policy'],
            ['Marketing mix model refresh', 'VP Marketing', eff[2], 'High, but only quarterly use'],
            ['Self-serve dashboard fixes', 'Ops lead', eff[3], 'Low individually, high in volume'],
            ['Executive KPI deck', 'CEO office', eff[4], 'Unclear'],
            ['Data quality monitoring', 'Data platform', eff[5], 'Enables the others'],
            ['Personalisation prototype', 'CPO', eff[6], 'Speculative'],
            ['Forecasting rebuild', 'Finance', eff[7], 'Medium, hard deadline']
          ],
          extra: [`Total requested: ${eff.reduce((a, b) => a + b, 0)} person-weeks. Hiring takes about 4 months to productive.`],
        },
        questions: [
          'What does the team commit to, what does it defer, and what does it decline? Show your reasoning.',
          'How do you use the open requisitions, and what changes if only one is approved?',
          'Write the opening lines of the message to the most senior sponsor whose request you defer.',
        ],
      };
    },
    rubric: [
      { criterion: 'Prioritisation logic is explicit and fits capacity', signals: SIGNALS('Ranks by impact', 'Ranks by impact, effort and dependency; totals fit capacity', 'Also names risks, what is bought with the slack, and what would reorder the list') },
      { criterion: 'Hiring decision tied to the portfolio', signals: SIGNALS('Chooses a profile', 'Links profile to the deferred work and the 4-month lag', 'Includes interim mitigation and a plan if approval is partial') },
      { criterion: 'Handles the senior sponsor', signals: SIGNALS('Polite no', 'No with reasons and an alternative', 'Reframes in the sponsor’s goals, offers a smaller scoped option and a date to revisit') },
    ],
  },
  {
    id: 'dsm_performance_and_retention',
    role: 'ds_manager',
    title: 'A struggling hire and a star about to leave',
    minutes: 45,
    skills: [['coaching', 4], ['perf_mgmt', 3], ['people_mgmt', 4], ['hiring', 3]],
    deliverable: 'A 90-day plan for each person, and the first conversation you hold with each (opening and key points).',
    brief: 'Generate a people-management scenario with two simultaneous situations: an underperformer with a plausible hidden cause, and a high performer with an external offer. Randomise tenure and details; avoid protected characteristics and medical detail.',
    build(r) {
      const t1 = between(r, 5, 9);
      const t2 = between(r, 3, 5);
      const offer = between(r, 12, 22);
      return {
        scenario: `Two situations landed this week. A data scientist you hired ${t1} months ago has missed two deadlines and their code reviews show repeated rework. Separately, your strongest analyst of ${t2} years told you they have an external offer about ${offer}% above their current pay.`,
        data: {
          columns: ['person', 'signals you have', 'signals you lack'],
          rows: [
            ['New hire', 'Two missed deadlines; rework in reviews; positive interview feedback; quiet in meetings', 'Their own view; clarity of the goals set; whether onboarding was complete'],
            ['Strong analyst', 'High output; mentors two juniors; pay band is capped at the current level', 'Why they are looking; what would make them stay; whether the offer is firm']
          ],
          extra: ['You have no budget flexibility until the next cycle in 5 months.'],
        },
        questions: [
          'How do you diagnose before you judge in the first case? What do you ask and check?',
          'What do you do within 48 hours in the second case, given the budget limit?',
          'What does each conversation sound like in its first minute?',
        ],
      };
    },
    rubric: [
      { criterion: 'Diagnoses before acting', signals: SIGNALS('Asks the person', 'Separates skill, clarity, support and fit; checks onboarding and goals', 'Sets a time-boxed plan with explicit success criteria and a decision point') },
      { criterion: 'Retention within constraints', signals: SIGNALS('Offers non-pay options', 'Explores non-pay levers and escalates a band exception with a case', 'Also plans for the downside: knowledge transfer and succession') },
      { criterion: 'Conversation quality', signals: SIGNALS('Respectful and clear', 'Specific, curious, no surprises', 'Calibrated to the person, with a concrete next step and follow-up date') },
    ],
  },
];

export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));

/** A task instance for a given seed: the same seed always returns the same numbers. */
export function instantiate(taskId, seed) {
  const t = TASK_BY_ID[taskId];
  if (!t) return null;
  const s = (Number(seed) >>> 0) || 1;
  const body = t.build(rng(s));
  return {
    id: t.id, role: t.role, title: t.title, minutes: t.minutes, deliverable: t.deliverable,
    skills: t.skills.map(([skill, level]) => ({ skill, level })),
    seed: s, generator: 'template', ...body, rubric: t.rubric,
  };
}

/** Tasks that can evidence a skill, optionally limited to a role. */
export function tasksForSkill(skillId, roleId = null) {
  return TASKS.filter((t) => t.skills.some(([s]) => s === skillId) && (!roleId || t.role === roleId));
}

export function listTasks(roleId = null) {
  return TASKS.filter((t) => !roleId || t.role === roleId)
    .map((t) => ({ id: t.id, role: t.role, title: t.title, minutes: t.minutes, deliverable: t.deliverable, skills: t.skills.map(([skill, level]) => ({ skill, level })) }));
}

// Seed skill vocabulary, adjacency (transferability) edges and generic role templates.
// This is a small hand-built starter set. The intended path is to map it onto ESCO / O*NET ids
// (open vocabularies) and keep the calibration (adjacency weights, level anchors) as our own data.

export const CATEGORIES = {
  data: 'Data & Programming',
  stats: 'Statistics & ML',
  biz: 'Product & Business',
  lead: 'Leadership',
  tools: 'Tools & Platforms',
  ai: 'AI & Automation',
};

// [id, label, category, kind, aliases]
// kind selects the level anchors used in the self-assessment survey: tech | method | people | biz | tool
const RAW = [
  ['python', 'Python', 'data', 'tech', ['python', 'pandas', 'numpy']],
  ['sql', 'SQL', 'data', 'tech', ['sql', 'postgres', 'postgresql', 'mysql', 't-sql', 'hive', 'presto', 'trino', 'bigquery']],
  ['r', 'R', 'data', 'tech', ['r programming', 'r language', 'tidyverse', 'ggplot2']],
  ['spark', 'Spark & big data', 'data', 'tech', ['spark', 'pyspark', 'hadoop', 'databricks']],
  ['data_engineering', 'Data pipelines & ETL', 'data', 'tech', ['etl', 'elt', 'data pipeline', 'data pipelines', 'dbt', 'data warehouse', 'airflow']],
  ['data_modeling', 'Data modeling', 'data', 'tech', ['data modeling', 'data modelling', 'schema design', 'dimensional model']],
  ['data_viz', 'Data visualization', 'data', 'method', ['data visualization', 'data visualisation', 'dashboard', 'dashboards', 'tableau', 'looker', 'power bi', 'powerbi', 'matplotlib', 'plotly']],
  ['excel', 'Excel & spreadsheets', 'data', 'tool', ['excel', 'spreadsheet', 'spreadsheets', 'google sheets', 'vba']],

  ['statistics', 'Statistics', 'stats', 'method', ['statistics', 'statistical analysis', 'statistical modeling', 'statistical modelling', 'regression', 'probability']],
  ['hypothesis_testing', 'Hypothesis testing', 'stats', 'method', ['hypothesis test', 'hypothesis testing', 'significance test', 'p-value', 'confidence interval']],
  ['ab_testing', 'A/B testing & experimentation', 'stats', 'method', ['a/b test', 'a/b testing', 'ab testing', 'experimentation', 'experiment design', 'split test', 'controlled experiment', 'online experiments']],
  ['causal_inference', 'Causal inference', 'stats', 'method', ['causal inference', 'causal', 'uplift', 'difference-in-differences', 'propensity', 'instrumental variable', 'counterfactual']],
  ['bayesian', 'Bayesian methods', 'stats', 'method', ['bayesian', 'bayes', 'pymc']],
  ['machine_learning', 'Machine learning', 'stats', 'tech', ['machine learning', 'ml models', 'scikit-learn', 'sklearn', 'xgboost', 'lightgbm', 'random forest', 'gradient boosting', 'predictive model', 'predictive modeling', 'predictive modelling']],
  ['deep_learning', 'Deep learning', 'stats', 'tech', ['deep learning', 'neural network', 'neural networks', 'pytorch', 'tensorflow', 'keras']],
  ['nlp', 'NLP', 'stats', 'tech', ['nlp', 'natural language processing', 'text mining', 'text classification', 'sentiment analysis']],
  ['time_series', 'Time series & forecasting', 'stats', 'method', ['time series', 'forecasting', 'forecast', 'arima', 'prophet']],
  ['recsys', 'Recommender & ranking systems', 'stats', 'tech', ['recommender', 'recommendation system', 'recommendation systems', 'ranking model', 'personalization', 'personalisation', 'learning to rank']],
  ['feature_eng', 'Feature engineering', 'stats', 'tech', ['feature engineering', 'feature store']],
  ['model_eval', 'Model evaluation & monitoring', 'stats', 'method', ['model evaluation', 'model monitoring', 'model validation', 'model performance', 'drift']],
  ['mlops', 'MLOps & deployment', 'stats', 'tech', ['mlops', 'model deployment', 'model serving', 'productionize', 'productionise', 'production models', 'ml pipeline', 'ml pipelines', 'mlflow', 'kubeflow']],
  ['optimization', 'Optimization & simulation', 'stats', 'method', ['optimization', 'optimisation', 'linear programming', 'operations research', 'simulation']],
  ['research', 'Research methods', 'stats', 'method', ['research', 'publication', 'publications', 'peer-reviewed', 'phd', 'thesis']],

  ['stakeholder', 'Stakeholder management', 'biz', 'people', ['stakeholder', 'stakeholders', 'cross-functional', 'business partners', 'partnering with']],
  ['communication', 'Communication & storytelling', 'biz', 'people', ['communication', 'storytelling', 'data storytelling', 'presentations', 'presenting', 'executive communication', 'influence']],
  ['business_acumen', 'Business acumen', 'biz', 'biz', ['business acumen', 'business impact', 'roi', 'p&l', 'commercial', 'kpi', 'kpis', 'business case', 'unit economics']],
  ['product_sense', 'Product sense', 'biz', 'biz', ['product sense', 'product analytics', 'product thinking', 'product metrics', 'funnel analysis', 'user behavior', 'user behaviour']],
  ['marketing_analytics', 'Marketing analytics', 'biz', 'biz', ['marketing analytics', 'marketing', 'attribution', 'crm', 'lifecycle', 'campaign', 'campaigns', 'growth marketing', 'messaging', 'customer lifetime value', 'ltv']],
  ['customer_analytics', 'Customer analytics', 'biz', 'biz', ['customer analytics', 'customer segmentation', 'segmentation', 'churn', 'retention', 'customer identity', 'customer data']],
  ['project_mgmt', 'Project management', 'biz', 'people', ['project management', 'program management', 'agile', 'scrum', 'kanban', 'delivery management']],
  ['problem_solving', 'Problem framing', 'biz', 'method', ['problem solving', 'problem framing', 'structured thinking', 'analytical thinking', 'ambiguity']],

  ['people_mgmt', 'People management', 'lead', 'people', ['people management', 'line management', 'managed a team', 'managing a team', 'managed teams', 'direct reports', 'team lead', 'team leader', 'head of']],
  ['hiring', 'Hiring & team building', 'lead', 'people', ['hiring', 'recruiting', 'recruitment', 'interviewing', 'team building', 'built a team', 'grew the team', 'onboarding']],
  ['coaching', 'Coaching & mentoring', 'lead', 'people', ['coaching', 'mentoring', 'mentor', 'mentored', 'developing talent', 'career development', 'teaching', 'trainer']],
  ['perf_mgmt', 'Performance management', 'lead', 'people', ['performance management', 'performance reviews', 'promotions', 'talent calibration']],
  ['strategy', 'Strategy & roadmapping', 'lead', 'biz', ['strategy', 'strategic', 'roadmap', 'vision', 'long-term planning', 'okr', 'okrs', 'prioritization', 'prioritisation']],
  ['budgeting', 'Budget & resourcing', 'lead', 'biz', ['budget', 'budgeting', 'resourcing', 'headcount', 'capacity planning', 'vendor management']],
  ['org_influence', 'Org leadership & influence', 'lead', 'people', ['leadership', 'senior leadership', 'executive stakeholders', 'c-level', 'change management']],

  ['git', 'Git & version control', 'tools', 'tool', ['git', 'github', 'gitlab', 'version control']],
  ['cloud', 'Cloud platforms', 'tools', 'tool', ['aws', 'amazon web services', 'gcp', 'google cloud', 'azure']],
  ['docker', 'Containers & DevOps', 'tools', 'tool', ['docker', 'kubernetes', 'k8s', 'ci/cd', 'terraform']],

  ['llm', 'LLMs & generative AI', 'ai', 'tech', ['llm', 'llms', 'large language model', 'large language models', 'generative ai', 'genai', 'gpt', 'rag', 'retrieval augmented', 'langchain']],
  ['ai_collab', 'AI collaboration', 'ai', 'method', ['prompt engineering', 'prompting', 'ai tools', 'copilot', 'cursor', 'claude', 'chatgpt', 'ai-assisted', 'ai assisted', 'agentic', 'ai agents']],
  ['automation', 'Workflow automation', 'ai', 'tech', ['automation', 'automated', 'scripting', 'rpa', 'workflow automation']],
];

export const SKILLS = RAW.map(([id, label, cat, kind, aliases]) => ({ id, label, cat, kind, aliases }));
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

// Undirected transferability edges: [a, b, weight 0..1]. Weight = how much level in one skill
// is assumed to carry over to the other (a prior, to be replaced by measured transition data).
const EDGE_LIST = [
  ['statistics', 'hypothesis_testing', 0.8], ['statistics', 'ab_testing', 0.6], ['hypothesis_testing', 'ab_testing', 0.8],
  ['ab_testing', 'causal_inference', 0.7], ['causal_inference', 'statistics', 0.6], ['bayesian', 'statistics', 0.7],
  ['machine_learning', 'statistics', 0.5], ['machine_learning', 'feature_eng', 0.8], ['machine_learning', 'model_eval', 0.8],
  ['machine_learning', 'deep_learning', 0.6], ['deep_learning', 'nlp', 0.6], ['nlp', 'llm', 0.6], ['llm', 'ai_collab', 0.6],
  ['machine_learning', 'recsys', 0.6], ['machine_learning', 'mlops', 0.4], ['mlops', 'docker', 0.5], ['mlops', 'cloud', 0.5],
  ['mlops', 'data_engineering', 0.4], ['time_series', 'statistics', 0.6], ['time_series', 'machine_learning', 0.5],
  ['python', 'r', 0.6], ['python', 'automation', 0.5], ['sql', 'data_modeling', 0.6], ['sql', 'data_engineering', 0.6],
  ['spark', 'data_engineering', 0.6], ['sql', 'excel', 0.4], ['excel', 'data_viz', 0.4], ['data_viz', 'communication', 0.4],
  ['communication', 'stakeholder', 0.6], ['stakeholder', 'project_mgmt', 0.5], ['project_mgmt', 'people_mgmt', 0.4],
  ['people_mgmt', 'coaching', 0.6], ['people_mgmt', 'hiring', 0.6], ['people_mgmt', 'perf_mgmt', 0.7], ['coaching', 'perf_mgmt', 0.5],
  ['strategy', 'business_acumen', 0.6], ['strategy', 'budgeting', 0.5], ['business_acumen', 'product_sense', 0.5],
  ['product_sense', 'marketing_analytics', 0.5], ['marketing_analytics', 'customer_analytics', 0.7],
  ['customer_analytics', 'causal_inference', 0.4], ['customer_analytics', 'recsys', 0.4], ['problem_solving', 'business_acumen', 0.4],
  ['research', 'statistics', 0.5], ['research', 'causal_inference', 0.4], ['optimization', 'machine_learning', 0.4],
  ['org_influence', 'stakeholder', 0.6], ['org_influence', 'people_mgmt', 0.5], ['org_influence', 'strategy', 0.5],
  ['cloud', 'docker', 0.5], ['automation', 'data_engineering', 0.4],
];

export const ADJACENCY = new Map(SKILLS.map((s) => [s.id, []]));
for (const [a, b, w] of EDGE_LIST) {
  if (!SKILL_BY_ID[a] || !SKILL_BY_ID[b]) throw new Error(`bad edge ${a}-${b}`);
  ADJACENCY.get(a).push({ id: b, w });
  ADJACENCY.get(b).push({ id: a, w });
}

// Generic role templates. req: skill -> [required level 1..5, importance 1..3 (3 = must have)]
export const ROLES = [
  {
    id: 'data_analyst', title: 'Data Analyst', level: 2,
    match: ['data analyst', 'business analyst', 'analytics analyst', 'bi analyst'],
    req: { sql: [3, 3], excel: [3, 2], data_viz: [3, 3], statistics: [2, 2], communication: [3, 3], stakeholder: [3, 2], business_acumen: [2, 2], python: [2, 2], hypothesis_testing: [2, 2], problem_solving: [3, 2] },
  },
  {
    id: 'data_scientist', title: 'Data Scientist', level: 3,
    match: ['data scientist', 'applied scientist', 'research scientist'],
    req: { python: [3, 3], sql: [3, 3], statistics: [3, 3], machine_learning: [3, 3], ab_testing: [3, 2], hypothesis_testing: [3, 2], feature_eng: [3, 2], model_eval: [3, 2], data_viz: [2, 1], communication: [3, 2], stakeholder: [3, 2], business_acumen: [3, 2], git: [2, 1], causal_inference: [2, 1], problem_solving: [3, 2], ai_collab: [2, 1] },
  },
  {
    id: 'senior_data_scientist', title: 'Senior Data Scientist', level: 4,
    match: ['senior data scientist', 'lead data scientist', 'principal data scientist', 'staff data scientist'],
    req: { python: [4, 3], sql: [4, 3], statistics: [4, 3], machine_learning: [4, 3], causal_inference: [3, 2], ab_testing: [4, 2], model_eval: [4, 2], mlops: [3, 2], communication: [4, 3], stakeholder: [4, 3], business_acumen: [4, 2], product_sense: [3, 2], coaching: [3, 2], problem_solving: [4, 3], ai_collab: [3, 1] },
  },
  {
    id: 'ds_manager', title: 'Manager, Data Science', level: 4,
    match: ['data science manager', 'manager data science', 'manager, data science', 'head of data science', 'manager of data science', 'analytics manager', 'director of data science'],
    req: { people_mgmt: [4, 3], hiring: [3, 3], coaching: [4, 3], perf_mgmt: [3, 2], strategy: [4, 3], stakeholder: [4, 3], business_acumen: [4, 2], communication: [4, 2], budgeting: [3, 2], org_influence: [3, 2], machine_learning: [3, 2], statistics: [3, 2], ab_testing: [3, 1], project_mgmt: [3, 2], ai_collab: [3, 1] },
  },
  {
    id: 'ml_engineer', title: 'Machine Learning Engineer', level: 4,
    match: ['machine learning engineer', 'ml engineer', 'mlops engineer', 'ai engineer'],
    req: { python: [4, 3], machine_learning: [4, 3], deep_learning: [3, 2], mlops: [4, 3], docker: [3, 2], cloud: [3, 2], data_engineering: [3, 2], git: [3, 2], model_eval: [3, 2], sql: [3, 2], feature_eng: [3, 1], llm: [3, 1] },
  },
];
export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, r]));

// Level anchors (1-5) per skill kind. Used by the self-assessment survey; {s} = skill label.
export const LEVEL_NAMES = ['', 'Aware', 'Guided', 'Independent', 'Expert', 'Leader'];
export const ANCHORS = {
  tech: [
    'I have studied or tried {s} (course, tutorial, side project).',
    'I have used {s} on real work with guidance or review from someone more experienced.',
    'I use {s} independently on production work and own the result.',
    'I design the approach with {s}, review others’ work, and handle the hard edge cases.',
    'I set the standards for {s} across teams and teach others how to do it well.',
  ],
  method: [
    'I understand the ideas behind {s} and can explain them.',
    'I have applied {s} in a real analysis or project, with someone checking my work.',
    'I choose and apply {s} on my own and defend the choices to stakeholders.',
    'I have found and fixed flaws in other people’s use of {s}, and handle unusual cases.',
    'I define how my organisation does {s} and coach others in it.',
  ],
  people: [
    'I have seen {s} done and understand what good looks like.',
    'I have practised {s} in small, supported situations.',
    'I do {s} regularly and independently, with good outcomes.',
    'I do {s} in hard situations (conflict, ambiguity, senior audiences) and improve how others do it.',
    'I am relied on to set the practice for {s} across a large group.',
  ],
  biz: [
    'I understand the basics of {s} and the vocabulary.',
    'I have contributed to work involving {s} under direction.',
    'I drive work involving {s} and can show its effect on a result.',
    'I shape decisions through {s} and have changed direction for a team or product.',
    'I set direction through {s} for a business area and am accountable for the outcome.',
  ],
  tool: [
    'I have opened and tried {s}.',
    'I use {s} for routine tasks.',
    'I use {s} fluently and automate or extend it.',
    'I set up and maintain {s} for a team.',
    'I define how my organisation uses {s}.',
  ],
};

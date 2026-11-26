export const solHigh = Object.freeze({ model: 'gpt-6.2-sol', effort: 'high', deadline: 180_000 });
export const astraHigh = Object.freeze({ model: 'gpt-6.2-astra', effort: 'high', deadline: 300_000 });
export const astraExtra = Object.freeze({ model: 'gpt-6.2-astra', effort: 'xhigh', deadline: 420_000 });

const reviewerIntent = [
  /(?:리뷰어|심사위원|심사자)\s*(?:의\s*)?(?:시점|관점|입장|처럼|같이|모드|피드백|역할|로서|가\s*되어)/,
  /(?:논문|원고).{0,18}(?:심사\s*해|혹평\s*해|냉정하게\s*평가|피드백\s*(?:해|줘|부탁))/,
  /리뷰어(?:가|라면).{0,24}(?:지적할|문제\s*삼을|어떻게\s*평가)/,
  /\b(?:peer reviewer|journal reviewer|reviewer perspective)\b|\b(?:act|think|respond)\s+(?:as|like)\s+(?:an?\s+)?reviewer\b/i,
  /\breview (?:this|my|our|the|these) (?:paper|manuscript|draft)s?\b/i,
];

const demandingIntent = [
  /심층|정밀\s*(?:분석|검토)|비판적\s*(?:검토|평가|분석)|방법론\s*(?:검토|문제|결함|평가)/,
  /연구\s*(?:전략|공백)|가설\s*(?:설계|검증|제안|세워)/,
  /(?:연구|실험)\s*(?:설계|계획).{0,16}(?:제안|작성|구상|개선|짜\s*줘|만들어)/,
  /(?:교란|편향|과적합|외부\s*검증|인과).{0,20}(?:분석|비교|검토|평가|판단|설계)/,
  /\b(?:deep dive|critical appraisal|methodological (?:critique|flaws)|research (?:strategy|gap)|stress[- ]test)\b/i,
  /\b(?:design|propose) a (?:study|trial|validation)\b/i,
  /\b(?:evaluate|compare|assess|analy[sz]e).{0,30}(?:bias|confound\w*|overfit\w*|leakage|external validity|causal)\b/i,
];

export function routeChat({ question, purpose, precision } = {}) {
  if (purpose === 'analysis') return { ...astraHigh, task: 'analysis' };
  const text = typeof question === 'string' ? question.normalize('NFKC') : '';
  if (reviewerIntent.some((pattern) => pattern.test(text))) return { ...astraHigh, task: 'reviewer' };
  if (precision === true || demandingIntent.some((pattern) => pattern.test(text))) return { ...astraHigh, task: 'precision' };
  return { ...solHigh, task: 'chat' };
}

const heavyLab = new Set(['strategy', 'reviewer']);
export function routeLab(mode) {
  if (mode === 'doi') return null;
  if (mode === 'extract') return solHigh;
  if (heavyLab.has(mode)) return astraExtra;
  return astraHigh;
}

const routineArs = new Set(['quick', 'format-convert', 'citation-check', 'outline-only', 'abstract-only', 'disclosure', 'report']);
export function routeArs(workflow, mode) {
  if (workflow === 'academic-pipeline' || (workflow === 'academic-paper-reviewer' && mode === 'full')) return astraExtra;
  if (workflow === 'academic-paper-reviewer') return astraHigh;
  return routineArs.has(mode) ? solHigh : astraHigh;
}

export function modelLabel({ model, effort } = {}) {
  const name = model === astraHigh.model ? 'GPT‑6.2 Astra' : model === solHigh.model ? 'GPT‑6.2 Sol' : model;
  return [name, effort === 'xhigh' ? 'Extra high' : effort === 'high' ? 'High' : effort].filter(Boolean).join(' · ');
}

export const SALARY_SCALES_PATH = "/national-treasury-salary-scales/";
export const SALARY_SCALES_LINK_LABEL = "National Treasury Scales";
export const SARS_TAX_YEAR = 2027;
export const SARS_TAX_RATES_URL = "https://www.sars.gov.za/tax-rates/income-tax/rates-of-tax-for-individuals/";

export const SALARY_LEVEL_MONTHLY_NOTCHES = Object.freeze([
  7254, 7814, 9342, 11071, 13237, 15895, 19623, 24369, 28969, 36157, 46929, 55618
]);

const SARS_PRIMARY_REBATE = 17820;
const SARS_TAX_BRACKETS = [
  { from: 0, limit: 245100, base: 0, rate: 0.18 },
  { from: 245100, limit: 383100, base: 44118, rate: 0.26 },
  { from: 383100, limit: 530200, base: 79998, rate: 0.31 },
  { from: 530200, limit: 695800, base: 125599, rate: 0.36 },
  { from: 695800, limit: 887000, base: 185215, rate: 0.39 },
  { from: 887000, limit: 1878600, base: 259783, rate: 0.41 },
  { from: 1878600, limit: Infinity, base: 666339, rate: 0.45 }
];

function normalizeLevel(value) {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= 12 ? `Level ${level}` : "";
}

export function extractJobLevel(job) {
  const explicitLevel = String(job?.level ?? "").trim();
  const explicitMatch = explicitLevel.match(/^(?:(?:public service|salary|job)\s+)?level\s*[:\-]?\s*0*(\d{1,2})$/i)
    ?? explicitLevel.match(/^0*(\d{1,2})$/);
  if (explicitMatch) {
    const level = normalizeLevel(explicitMatch[1]);
    if (level) return level;
  }

  const salaryText = String(job?.salaryText ?? "");
  const matches = salaryText.matchAll(/\b(?:(?:public service|salary)\s+)?level\s*[:\-]?\s*0*(\d{1,2})\b/gi);
  for (const match of matches) {
    if (/\bNQF\s*$/i.test(salaryText.slice(0, match.index))) continue;
    const level = normalizeLevel(match[1]);
    if (level) return level;
  }
  return "";
}

export function salaryLevelHref(level) {
  const match = String(level ?? "").match(/\bLevel\s+(\d{1,2})\b/i);
  const normalized = match && normalizeLevel(match[1]);
  return `${SALARY_SCALES_PATH}${normalized ? `#level-${normalized.match(/\d+/)[0]}` : ""}`;
}

export function salaryLevelMonthlyNotch(level) {
  const match = String(level ?? "").match(/\bLevel\s+(\d{1,2})\b/i);
  const normalized = match && normalizeLevel(match[1]);
  return normalized ? SALARY_LEVEL_MONTHLY_NOTCHES[Number(normalized.match(/\d+/)[0]) - 1] : null;
}

export function estimateAnnualIncomeTax(grossIncome) {
  const income = Number(grossIncome);
  if (!Number.isFinite(income) || income < 0) return null;
  const bracket = SARS_TAX_BRACKETS.find(item => income <= item.limit);
  const taxBeforeRebate = bracket.base + (income - bracket.from) * bracket.rate;
  return Math.max(0, taxBeforeRebate - SARS_PRIMARY_REBATE);
}

export function isNationalTreasuryScalesReference(value) {
  const salaryText = String(value ?? "").trim();
  return /national\s+treasury/i.test(salaryText) && !/\d/.test(salaryText);
}

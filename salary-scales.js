export const SALARY_SCALES_PATH = "/national-treasury-salary-scales/";
export const SALARY_SCALES_LINK_LABEL = "National Treasury Scales";

export function isNationalTreasuryScalesReference(value) {
  const salaryText = String(value ?? "").trim();
  return /national\s+treasury/i.test(salaryText) && !/\d/.test(salaryText);
}

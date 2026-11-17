export const EMPLOYMENT_TYPE_CATEGORIES = ["Permanent", "Contract", "Sessional", "Internship"];

export function employmentTypeCategory(job) {
  const title = String(job?.title ?? "");
  const type = String(job?.natureOfAppointment ?? "").trim() || String(job?.type ?? "");
  if (/\binternship\b/i.test(title) || /\binternship\b/i.test(type)) return "Internship";
  if (/\bpermanent\b/i.test(type)) return "Permanent";
  if (/\bsessional\b/i.test(type)) return "Sessional";
  if (/\b(?:contract|seasonal|temporary|fixed[\s-]?term|full[\s-]?time|part[\s-]?time)\b/i.test(type)) return "Contract";
  return "";
}

export function displayEmploymentType(job) {
  return employmentTypeCategory(job) ||
    String(job?.natureOfAppointment ?? "").trim() ||
    String(job?.type ?? "").trim();
}

export function isEmploymentTypeCategory(value) {
  return EMPLOYMENT_TYPE_CATEGORIES.includes(value);
}

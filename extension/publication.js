function normalizeCircularName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-ZA");
}

const PUBLISHABLE_JOB_FIELDS = new Set([
  "id", "title", "company", "location", "type", "category", "salary",
  "salaryText", "posted", "logo", "color", "logoColor", "sourceUrl",
  "circularName", "circularDate", "circularPage", "postNo", "refNo",
  "province", "natureOfAppointment", "branch", "chiefDirectorate",
  "directorate", "cluster", "level", "centre", "closingDate", "requirements",
  "duties", "jobPurpose", "skillsAndCompetencies", "enquiries", "applications",
  "note", "links"
]);

export function sanitizePublishedJob(job) {
  return Object.fromEntries(Object.entries(job).filter(([field]) => PUBLISHABLE_JOB_FIELDS.has(field)));
}

export function displayVacancyTitle(value) {
  const title = String(value ?? "").trim();
  const letters = title.match(/\p{L}/gu) ?? [];
  if (!letters.length || letters.some(letter => letter !== letter.toLocaleUpperCase("en-ZA"))) return title;
  const acronyms = new Set(["AIDS", "CEO", "CFO", "DDG", "DPSA", "GIS", "HIV", "HOD", "HR", "ICT", "ID", "IT", "MEC", "NQF", "OHS", "PMDS", "SAPS", "SCM", "SMS", "TVET"]);
  return title.toLocaleLowerCase("en-ZA").replace(/\b[\p{L}][\p{L}'’.-]*/gu, word =>
    acronyms.has(word.toLocaleUpperCase("en-ZA"))
      ? word.toLocaleUpperCase("en-ZA")
      : `${word.charAt(0).toLocaleUpperCase("en-ZA")}${word.slice(1)}`
  );
}

export function comparePostNumbers(leftValue, rightValue) {
  const leftParts = String(leftValue ?? "").match(/\d+/g)?.map(Number) ?? [];
  const rightParts = String(rightValue ?? "").match(/\d+/g)?.map(Number) ?? [];
  if (!leftParts.length || !rightParts.length) {
    if (leftParts.length !== rightParts.length) return leftParts.length ? -1 : 1;
    return String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "en-ZA", { sensitivity: "base" });
  }
  const sharedLength = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  if (leftParts.length !== rightParts.length) return leftParts.length - rightParts.length;
  return String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "en-ZA", { numeric: true, sensitivity: "base" });
}

export function vacancyMatchKey(job) {
  const postIdentity = [job.postNo, job.refNo].filter(Boolean).join("|").toLowerCase();
  if (postIdentity) return `${job.sourceUrl ?? ""}|${postIdentity}`;
  return `${job.title}|${job.company}`.toLowerCase().replace(/\s+/g, " ").trim();
}

export function mergeVacancyLinks(existingLinks, importedLinks) {
  const links = new Map();
  for (const link of [
    ...(Array.isArray(existingLinks) ? existingLinks : []),
    ...(Array.isArray(importedLinks) ? importedLinks : [])
  ]) {
    if (typeof link?.url !== "string" || typeof link.label !== "string") continue;
    links.set(link.url, { label: link.label, url: link.url });
  }
  return [...links.values()];
}

export function getCircularVacancies(vacancies, circularName) {
  const normalizedName = normalizeCircularName(circularName);
  if (!normalizedName) return [...vacancies];
  return [...vacancies].filter(vacancy => normalizeCircularName(vacancy.circularName) === normalizedName);
}

export function circularPublicationStatus(circularName, importedVacancies, publishedJobs) {
  const imported = getCircularVacancies(importedVacancies, circularName);
  const published = getCircularVacancies(publishedJobs, circularName);
  const publishedKeys = new Set(published.map(vacancyMatchKey));
  return {
    importedCount: imported.length,
    publishedCount: published.length,
    alreadyPublishedCount: imported.filter(vacancy => publishedKeys.has(vacancyMatchKey(vacancy))).length
  };
}

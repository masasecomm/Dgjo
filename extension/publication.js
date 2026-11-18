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

const MAX_PUBLISHED_SALARY = 100_000_000;

function truncate(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

export function normalizePublishedSalary(value, salaryText) {
  if (Number.isFinite(value) && value >= 0 && value <= MAX_PUBLISHED_SALARY) return value;
  const amounts = [...String(salaryText ?? "").matchAll(/R\s*([\d][\d,\s]*(?:\.\d+)?)/gi)]
    .map(match => Number(match[1].replace(/[,\s]/g, "")))
    .filter(amount => Number.isFinite(amount) && amount >= 0 && amount <= MAX_PUBLISHED_SALARY);
  return amounts.length ? Math.max(...amounts) : 0;
}

export function createPublishedVacancy(vacancy) {
  const title = truncate(vacancy.title, 160);
  const company = truncate(vacancy.company, 160) || "Hiring department not identified";
  const location = truncate(vacancy.location, 160) || "South Africa";
  const salaryText = truncate(vacancy.salaryText || "Not stated in advert", 160);
  const closingDate = truncate(vacancy.closingDate, 120);
  const maxDetailLength = 6000;
  const existingDetails = {
    circularName: truncate(vacancy.circularName, 160),
    circularDate: truncate(vacancy.circularDate, 80),
    circularPage: truncate(vacancy.circularPage, 20),
    postNo: truncate(vacancy.postNo, 80),
    refNo: truncate(vacancy.refNo, 160),
    province: truncate(vacancy.province, 80),
    natureOfAppointment: truncate(vacancy.natureOfAppointment, 160),
    branch: truncate(vacancy.branch, maxDetailLength),
    chiefDirectorate: truncate(vacancy.chiefDirectorate, maxDetailLength),
    directorate: truncate(vacancy.directorate, maxDetailLength),
    cluster: truncate(vacancy.cluster, maxDetailLength),
    level: truncate(vacancy.level, 160),
    centre: truncate(vacancy.centre, maxDetailLength),
    closingDate,
    requirements: truncate(vacancy.requirements, maxDetailLength),
    duties: truncate(vacancy.duties, maxDetailLength),
    jobPurpose: truncate(vacancy.jobPurpose, maxDetailLength),
    skillsAndCompetencies: truncate(vacancy.skillsAndCompetencies, maxDetailLength),
    enquiries: truncate(vacancy.enquiries, maxDetailLength),
    applications: truncate(vacancy.applications, maxDetailLength),
    note: truncate(vacancy.note, maxDetailLength),
    links: [...new Map((Array.isArray(vacancy.links) ? vacancy.links : [])
      .filter(link => typeof link?.url === "string" && /^(?:https?:\/\/|mailto:|tel:)/i.test(link.url))
      .map(link => [link.url, {
        label: String(link.label || link.url).trim(),
        url: link.url
      }])).values()]
  };
  const sourceUrl = truncate(vacancy.sourceUrl, 2048);
  return {
    id: truncate(vacancy.id, 160),
    ...(sourceUrl ? { sourceUrl } : {}),
    title,
    company,
    location,
    category: vacancy.category,
    type: vacancy.type,
    salary: Number.isFinite(vacancy.salary) ? vacancy.salary : 0,
    salaryText,
    posted: closingDate ? `Closing date: ${closingDate}` : "Closing date: check official advert",
    logo: company.slice(0, 1).toLowerCase(),
    color: "#eaf1e2",
    logoColor: "#64803f",
    ...existingDetails
  };
}

export function sanitizePublishedJob(job) {
  const publishableJob = Object.fromEntries(Object.entries(job).filter(([field]) => PUBLISHABLE_JOB_FIELDS.has(field)));
  publishableJob.salary = normalizePublishedSalary(publishableJob.salary, publishableJob.salaryText);
  return publishableJob;
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

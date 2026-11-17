import defaultJobs from "../jobs.json" with { type: "json" };
import {
  cleanSalaryText,
  cleanVacancyLocation,
  cleanVacancyRequirements,
  cleanVacancyTitle,
  recoverVacancyRequirements,
  splitVacancyPoints
} from "../vacancy-format.js";
import {
  canonicalCircularName,
  circularArchivePath,
  compareCircularNames,
  groupJobsByCircular,
  MAX_ACTIVE_CIRCULARS,
  retainLatestCircularJobs
} from "../circulars.js";
import { isFeedRequest, legacyCircularRedirectTarget } from "../redirects.js";
import { normalizeProvince, PROVINCE_CRESTS } from "../provinces.js";
import {
  estimateAnnualIncomeTax,
  extractJobLevel,
  isNationalTreasuryScalesReference,
  SARS_TAX_RATES_URL,
  SARS_TAX_YEAR,
  SALARY_SCALES_LINK_LABEL,
  SALARY_SCALES_PATH,
  salaryLevelHref,
  salaryLevelMonthlyNotch
} from "../salary-scales.js";

const JOBS_KEY = "published-jobs";
const CATEGORIES = new Set([
  "Administration", "Education", "Finance", "Health", "Law Enforcement", "Other",
  "Design", "Engineering", "Marketing", "Product"
]);
const TYPES = new Set([
  "Permanent", "Fixed-term", "Temporary",
  "Full-time", "Part-time", "Contract", "Internship"
]);
const MAX_JOBS = 6000;
const MAX_JOBS_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 160;
const SITE_URL = "https://dpsagovernmentjobs.co.za";
const ADS_TXT = "google.com, pub-3860151941190347, DIRECT, f08c47fec0942fa0";
const GENERIC_EMPLOYERS = new Set(["south african public service", "hiring department not identified", "department not specified"]);
const VERIFIED_CIRCULAR_FACTS = new Map([
  ["Circular 41 of 2026|41/20", {
    company: "Department of Employment and Labour",
    centre: "Labour Centre: KuGompo City",
    location: "KuGompo City",
    province: "Eastern Cape"
  }],
  ["Circular 41 of 2026|41/21", {
    company: "Department of Employment and Labour",
    centre: "Labour Centre: KuGompo City",
    location: "KuGompo City",
    province: "Eastern Cape"
  }],
  ["Circular 41 of 2026|41/100", {
    centre: "Mpumalanga Provincial Service Centre",
    location: "Mpumalanga Provincial Service Centre"
  }]
]);
const OPTIONAL_TEXT_FIELDS = new Map([
  ["circularName", 160], ["circularDate", 80], ["circularPage", 20], ["postNo", 80], ["refNo", 160],
  ["province", 80], ["natureOfAppointment", 160], ["branch", 6000],
  ["chiefDirectorate", 6000], ["directorate", 6000], ["cluster", 6000],
  ["level", 160], ["centre", 6000], ["closingDate", 120],
  ["requirements", 6000], ["duties", 6000], ["jobPurpose", 6000],
  ["skillsAndCompetencies", 6000], ["enquiries", 6000], ["applications", 6000],
  ["note", 6000]
]);
const MAX_JOB_LINKS = 100;
const JOB_FIELDS = new Set([
  "id", "title", "company", "location", "type", "category", "salary",
  "salaryText", "posted", "logo", "color", "logoColor", "sourceUrl",
  ...OPTIONAL_TEXT_FIELDS.keys(), "links"
]);

function jsonResponse(body, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Cache-Control": "no-store"
    }
  });
}

function homeRedirect(path = "/") {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${SITE_URL}${path}`,
      "Cache-Control": "no-store"
    }
  });
}

function isAdminPath(pathname) {
  return /^\/(?:admin(?:\/|\.|$)|administrator(?:\/|\.|$)|wp-admin(?:\/|\.|$)|wp-login(?:\/|\.|$)|login(?:\/|\.|$)|dashboard(?:\/|\.|$)|extension\/admin(?:\/|\.|$))/i.test(pathname);
}

function isValidText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH;
}

function validateJobs(value) {
  if (!Array.isArray(value) || value.length > MAX_JOBS) return false;
  const ids = new Set();
  return value.every(job => {
    if (!job || typeof job !== "object" || Array.isArray(job)) return false;
    if (Object.keys(job).some(field => !JOB_FIELDS.has(field))) return false;
    const textFields = ["id", "title", "company", "location", "salaryText", "posted", "logo"];
    if (!textFields.every(field => isValidText(job[field]))) return false;
    if (ids.has(job.id) || !CATEGORIES.has(job.category) || !TYPES.has(job.type)) return false;
    if (!Number.isFinite(job.salary) || job.salary < 0 || job.salary > 100000000) return false;
    if (!/^#[0-9a-f]{6}$/i.test(job.color) || !/^#[0-9a-f]{6}$/i.test(job.logoColor)) return false;
    for (const [field, maxLength] of OPTIONAL_TEXT_FIELDS) {
      if (job[field] !== undefined && (typeof job[field] !== "string" || job[field].length > maxLength)) return false;
    }
    if (job.links !== undefined) {
      if (!Array.isArray(job.links) || job.links.length > MAX_JOB_LINKS) return false;
      if (!job.links.every(link => {
        if (!link || typeof link !== "object" || Array.isArray(link)) return false;
        if (Object.keys(link).some(field => !["label", "url"].includes(field))) return false;
        if (typeof link.label !== "string" || link.label.length > 300) return false;
        if (typeof link.url !== "string" || link.url.length > 2048) return false;
        try {
          const parsedUrl = new URL(link.url);
          return ["https:", "http:", "mailto:", "tel:"].includes(parsedUrl.protocol) && !parsedUrl.username && !parsedUrl.password;
        } catch {
          return false;
        }
      })) return false;
    }
    if (job.sourceUrl !== undefined) {
      if (typeof job.sourceUrl !== "string" || job.sourceUrl.length > 2048) return false;
      try {
        const sourceUrl = new URL(job.sourceUrl);
        if (sourceUrl.protocol !== "https:" || sourceUrl.username || sourceUrl.password) return false;
      } catch {
        return false;
      }
    }
    ids.add(job.id);
    return true;
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function displayJobTitle(value) {
  const title = cleanVacancyTitle(value);
  return titleCaseJobTitle(title);
}

function titleCaseJobTitle(value) {
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

function linkifyText(value) {
  const text = String(value ?? "");
  const linkPattern = /(?:https?:\/\/|www\.)[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(linkPattern)) {
    let link = match[0];
    let punctuation = "";
    while (/[.,;:!?)}\]]$/.test(link)) {
      punctuation = link.slice(-1) + punctuation;
      link = link.slice(0, -1);
    }
    if (!link) continue;
    const before = text.slice(cursor, match.index);
    html += `${escapeHtml(before).replace(/\r?\n/g, "<br>")}`;
    const href = link.includes("@") && !/^https?:/i.test(link)
      ? `mailto:${link}`
      : /^https?:/i.test(link) ? link : `https://${link}`;
    html += `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(link)}</a>${escapeHtml(punctuation)}`;
    cursor = match.index + match[0].length;
  }
  return `${html}${escapeHtml(text.slice(cursor)).replace(/\r?\n/g, "<br>")}`;
}

function parseSouthAfricanDate(value, closingDate = false) {
  const text = String(value ?? "").trim();
  let year;
  let month;
  let day;
  const isoDate = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (isoDate) {
    [, year, month, day] = isoDate;
  } else {
    const dateMatch = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/);
    if (!dateMatch) return null;
    const monthIndex = new Map([
      ["jan", 1], ["january", 1], ["feb", 2], ["february", 2], ["mar", 3], ["march", 3],
      ["apr", 4], ["april", 4], ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
      ["aug", 8], ["august", 8], ["sep", 9], ["september", 9], ["oct", 10], ["october", 10],
      ["nov", 11], ["november", 11], ["dec", 12], ["december", 12]
    ]).get(dateMatch[2].toLowerCase());
    if (!monthIndex) return null;
    [, day, , year] = dateMatch;
    month = String(monthIndex);
  }

  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const date = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));
  if (date.getUTCFullYear() !== numericYear || date.getUTCMonth() !== numericMonth - 1 || date.getUTCDate() !== numericDay) return null;

  let hour = closingDate ? 23 : 0;
  let minute = closingDate ? 59 : 0;
  let second = closingDate ? 59 : 0;
  if (closingDate) {
    const time = text.match(/(?:@|\bat\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (time) {
      hour = Number(time[1]);
      minute = Number(time[2] ?? 0);
      if (time[3]) {
        const meridiem = time[3].toLowerCase();
        if (hour < 1 || hour > 12) return null;
        if (meridiem === "pm" && hour !== 12) hour += 12;
        if (meridiem === "am" && hour === 12) hour = 0;
      }
      if (hour > 23 || minute > 59) return null;
      second = 0;
    }
  }

  const pad = number => String(number).padStart(2, "0");
  return `${numericYear}-${pad(numericMonth)}-${pad(numericDay)}T${pad(hour)}:${pad(minute)}:${pad(second)}+02:00`;
}

function getClosingDate(job) {
  return parseSouthAfricanDate(job.closingDate || job.posted, true);
}

function isExpired(job, now = Date.now()) {
  const closingDate = getClosingDate(job);
  return closingDate !== null && Date.parse(closingDate) < now;
}

function prunePublishedJobs(jobs, now = Date.now()) {
  const expiredJobs = [];
  const activeJobs = [];
  for (const job of jobs) {
    (isExpired(job, now) ? expiredJobs : activeJobs).push(job);
  }
  const retained = retainLatestCircularJobs(activeJobs, MAX_ACTIVE_CIRCULARS);
  return {
    ...retained,
    removedJobIds: [...expiredJobs.map(job => job.id), ...retained.removedJobIds],
    removedExpiredCount: expiredJobs.length
  };
}

async function loadPublishedJobs(env) {
  const savedJobs = await env.JOBS.get(JOBS_KEY, "json");
  const sourceJobs = savedJobs ?? defaultJobs;
  const cleaned = prunePublishedJobs(sourceJobs);
  if (savedJobs && cleaned.jobs.length !== sourceJobs.length) {
    await env.JOBS.put(JOBS_KEY, JSON.stringify(cleaned.jobs));
  }
  return cleaned.jobs;
}

function hiringOrganizationName(job) {
  const company = String(job.company ?? "").trim();
  if (company && !GENERIC_EMPLOYERS.has(company.toLowerCase())) return company;

  const evidence = [
    job.applications, job.enquiries, job.requirements, job.duties, job.note,
    job.directorate, job.branch, job.refNo, job.sourceUrl
  ].map(value => String(value ?? "")).join("\n");
  const knownDepartments = [
    [/@labour\.gov\.za\b|Department of Labour and UIF Policies|Labour Centre Operations/i, "Department of Employment and Labour"],
    [/@judiciary\.org\.za\b|\bOCJ\b/i, "Office of the Chief Justice"],
    [/\bWCCETC\b|Western Cape Community Education and Training College/i, "Western Cape Community Education and Training College"],
    [/\bdcs\.gov\.za\b|\bDCS employee occupational health and safety\b|Department of Correctional Services/i, "Department of Correctional Services"]
  ];
  return knownDepartments.find(([pattern]) => pattern.test(evidence))?.[1] ?? "";
}

function slugifyJobPart(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function jobSlug(job) {
  const identity = [job.postNo, job.refNo].filter(value => String(value ?? "").trim());
  return [titleCaseJobTitle(job.title), ...identity]
    .map(slugifyJobPart)
    .filter(Boolean)
    .join("-") || slugifyJobPart(job.id);
}

function jobPagePath(job) {
  return `/${encodeURIComponent(jobSlug(job))}/`;
}

function locationDetails(job) {
  const province = String(job.province ?? "").trim();
  const locationParts = [job.centre, job.location]
    .map(cleanVacancyLocation)
    .filter(value => value && !/^(?:south africa|labour|department of labour|national head office|(?:[a-z-]+\s+)*provincial service centre(?:\s+\d+)?|central office)$/i.test(value));
  const locality = locationParts
    .map(value => value.split(/[,\n:]/).map(part => part.trim()).filter(Boolean).at(-1) ?? "")
    .find(value => value && !/^\d+$/.test(value) && value.toLowerCase() !== province.toLowerCase()) || "";
  const isDpsaAdvert = /^https:\/\/(?:www\.)?dpsa\.gov\.za\//i.test(String(job.sourceUrl ?? ""));
  if (!locality && !province && !isDpsaAdvert) return null;
  return {
    address: {
      "@type": "PostalAddress",
      ...(locality ? { addressLocality: locality } : {}),
      ...(province ? { addressRegion: province } : {}),
      addressCountry: "ZA"
    },
    locality,
    province
  };
}

function publicJob(job) {
  const correctionKey = `${job.circularName ?? ""}|${job.postNo ?? ""}`;
  const enriched = { ...job, ...(VERIFIED_CIRCULAR_FACTS.get(correctionKey) ?? {}) };
  let requirements = cleanVacancyRequirements(enriched.requirements);
  if (!requirements) {
    requirements = [enriched.centre, enriched.location]
      .map(recoverVacancyRequirements)
      .find(Boolean) ?? "";
  }
  const normalized = {
    ...enriched,
    centre: cleanVacancyLocation(enriched.centre),
    location: cleanVacancyLocation(enriched.location),
    requirements
  };
  const company = hiringOrganizationName(normalized);
  const location = locationDetails(normalized);
  const centreIsGeneric = /^(?:labour|department of labour|national head office|(?:[a-z-]+\s+)*provincial service centre(?:\s+\d+)?|central office)$/i
    .test(String(normalized.centre ?? "").trim());
  return {
    ...normalized,
    salaryText: cleanSalaryText(enriched.salaryText),
    slug: jobSlug(enriched),
    ...(company ? { company } : {}),
    ...(location?.locality && centreIsGeneric ? { centre: location.locality } : {}),
    ...(location?.locality && /^(?:south africa|labour|department of labour)$/i.test(String(enriched.location ?? "").trim())
      ? { location: location.locality }
      : {})
  };
}

function jsonLdScript(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029"
  })[character]);
}

function detailSections(job) {
  return [
    ["Job purpose", job.jobPurpose],
    ["Requirements", job.requirements],
    ["Duties", job.duties],
    ["Skills and competencies", job.skillsAndCompetencies],
    ["How to apply", job.applications],
    ["Enquiries", job.enquiries],
    ["Additional information", job.note]
  ].filter(([, value]) => typeof value === "string" && value.trim());
}

const RELATED_TITLE_STOP_WORDS = new Set([
  "and", "for", "the", "with", "from", "assistant", "director", "officer", "manager",
  "department", "government", "services", "service", "vacancy", "position"
]);

function relatedTitleTerms(job) {
  return new Set(
    cleanVacancyTitle(job.title).toLowerCase().match(/[a-z0-9]+/g)?.filter(term =>
      term.length > 2 && !RELATED_TITLE_STOP_WORDS.has(term)
    ) ?? []
  );
}

function selectRelatedJobs(job, jobs) {
  const titleTerms = relatedTitleTerms(job);
  const province = normalizeProvince(job.province);
  const company = String(job.company ?? "").trim().toLowerCase();
  const circularName = canonicalCircularName(job.circularName);

  return jobs
    .filter(candidate =>
      candidate.id !== job.id &&
      candidate.slug !== job.slug &&
      !isExpired(candidate) &&
      typeof candidate.title === "string" &&
      typeof candidate.company === "string"
    )
    .map(candidate => {
      const sharedTitleTerms = [...relatedTitleTerms(candidate)].filter(term => titleTerms.has(term)).length;
      const score =
        (province && normalizeProvince(candidate.province) === province ? 5 : 0) +
        sharedTitleTerms * 2 +
        (company && String(candidate.company).trim().toLowerCase() === company ? 2 : 0) +
        (circularName && canonicalCircularName(candidate.circularName) === circularName ? 1 : 0);
      return { candidate, score };
    })
    .sort((left, right) =>
      right.score - left.score ||
      compareCircularNames(left.candidate.circularName, right.candidate.circularName) ||
      displayJobTitle(left.candidate.title).localeCompare(displayJobTitle(right.candidate.title), "en-ZA")
    )
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

function relatedJobsMarkup(job, jobs, origin) {
  const relatedJobs = selectRelatedJobs(job, jobs);
  if (!relatedJobs.length) return "";
  const cards = relatedJobs.map(related => {
    const province = normalizeProvince(related.province) || "National";
    const href = new URL(jobPagePath(related), origin).href;
    return `<a class="related-job-card" href="${escapeHtml(href)}"><strong>${escapeHtml(displayJobTitle(related.title))}</strong><span>Province: ${escapeHtml(province)}</span></a>`;
  }).join("");
  return `<section class="related-jobs" aria-labelledby="related-jobs-heading"><h2 id="related-jobs-heading">Similar current vacancies</h2><div class="related-job-grid">${cards}</div></section>`;
}

function faqEvidencePoints(value) {
  const flatten = points => points.flatMap(point => [point.text, ...(point.children ? flatten(point.children) : [])]);
  return flatten(splitVacancyPoints(value))
    .map(point => String(point ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function truncateFaqEvidence(value, maxLength = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const boundary = text.lastIndexOf(" ", maxLength - 1);
  return `${text.slice(0, boundary > 0 ? boundary : maxLength).trim()}…`;
}

function matchingFaqEvidence(values, pattern) {
  const matches = values.filter(value => pattern.test(value)).slice(0, 3);
  return matches.map(value => truncateFaqEvidence(value, 360));
}

function formatRand(value) {
  const rounded = Math.round(value);
  return `R${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

function formatRandRange(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length > 1 && sorted[0] !== sorted[sorted.length - 1]
    ? `${formatRand(sorted[0])} to ${formatRand(sorted[sorted.length - 1])}`
    : formatRand(sorted[0]);
}

function salaryFaqFigures(job) {
  const salaryText = cleanSalaryText(job.salaryText);
  const amounts = [...salaryText.matchAll(/\bR\s*([\d][\d,\s]*(?:\.\d+)?)/gi)]
    .map(match => Number(match[1].replace(/[,\s]/g, "")))
    .filter(amount => Number.isFinite(amount) && amount > 0);
  const isAnnual = /\bper\s+(?:annum|year)\b|\bp\.?\s*a\.?(?=\s|$|\()/i.test(salaryText);
  const isMonthly = /\bper\s+month\b/i.test(salaryText);
  if (amounts.length && (isAnnual || isMonthly)) {
    return {
      annualAmounts: amounts.slice(0, 2).map(amount => isMonthly ? amount * 12 : amount),
      source: "advert"
    };
  }

  const level = extractJobLevel(job);
  const monthlyNotch = salaryLevelMonthlyNotch(level);
  if (!monthlyNotch) return null;
  return {
    annualAmounts: [monthlyNotch * 12],
    monthlyNotch,
    level,
    source: "salary-guide"
  };
}

function salaryFaqAnswers(job) {
  const figures = salaryFaqFigures(job);
  if (!figures) {
    const unavailable = "This vacancy's published details do not provide a numeric salary or a usable salary level, so a reliable pay estimate cannot be calculated. Check the salary details in this post and the official advert.";
    return { gross: unavailable, net: unavailable };
  }

  const annualAmounts = figures.annualAmounts;
  const netAnnualAmounts = annualAmounts.map(amount => amount - estimateAnnualIncomeTax(amount));
  const gross = `${formatRandRange(annualAmounts)} per year (${formatRandRange(annualAmounts.map(amount => amount / 12))} per month)`;
  const net = `${formatRandRange(netAnnualAmounts)} per year (${formatRandRange(netAnnualAmounts.map(amount => amount / 12))} per month)`;
  const grossAnswer = figures.source === "salary-guide"
    ? `The advert does not give a numeric salary but identifies ${figures.level}. The supplied salary guide lists a proposed monthly notch of ${formatRand(figures.monthlyNotch)}, or ${gross} when annualised. This is a guide reference, not a confirmed salary for this specific vacancy.`
    : `The salary shown in this vacancy is ${gross}.`;
  const netAnswer = `Estimated pay after income tax is ${net}. This estimate uses SARS ${SARS_TAX_YEAR} rates for an individual under 65 with the primary rebate. It excludes UIF, pension/GEPF contributions, medical aid credits, allowances and other deductions, so actual take-home pay will differ.`;
  if (figures.source === "salary-guide") {
    return { gross: grossAnswer, net: `${netAnswer} The calculation uses the supplied guide's proposed notch as a gross reference, not confirmed pay for this post.` };
  }
  return { gross: grossAnswer, net: netAnswer };
}

function vacancyFaq(job) {
  const title = displayJobTitle(job.title);
  const employer = hiringOrganizationName(job);
  const role = `${title}${employer ? ` at ${employer}` : ""}`;
  const salaryAnswers = salaryFaqAnswers(job);
  const requirements = faqEvidencePoints(job.requirements);
  const skillRequirements = faqEvidencePoints(job.skillsAndCompetencies);
  const requirementEvidence = [...requirements, ...skillRequirements];
  const experience = matchingFaqEvidence(
    requirementEvidence,
    /\bexperience\b|\byears?\b|\bmonths?\b|\bexposure\b|\bpractical\b/i
  );
  const qualifications = matchingFaqEvidence(
    requirementEvidence,
    /\bqualif(?:ication|ied|y)\b|\bdegree\b|\bdiploma\b|\bcertificate\b|\bNQF\b|\bmatric\b|\bgrade\s+\d+\b|\blicen[cs]e\b|\bregistered\b|\bregistration\b|\badmitted\b|\bmembership\b/i
  );
  const duties = faqEvidencePoints(job.duties);
  const purpose = faqEvidencePoints(job.jobPurpose);
  const dutySummary = [...duties.slice(0, 3), ...(!duties.length ? purpose.slice(0, 2) : [])]
    .map(point => truncateFaqEvidence(point, 360));

  const experienceAnswer = experience.length
    ? `The requirements and skills text recorded for this vacancy states: ${experience.join(" ")} Check the relevant section in this post and the linked official advert for the full criteria.`
    : requirementEvidence.length
      ? "The available requirements and skills text for this vacancy does not state a clear minimum experience period. Check the relevant section in this post and the official advert for any further criteria."
      : "Experience requirements were not included in this vacancy's published details. Check the official advert linked from this post before applying.";
  const qualificationAnswer = qualifications.length
    ? `The qualification-related requirements recorded for this vacancy are: ${qualifications.join(" ")} Check the relevant section in this post and the linked official advert for the complete criteria.`
    : requirementEvidence.length
      ? "The available requirements and skills text for this vacancy does not clearly identify a named qualification. Check the relevant section in this post and the official advert before applying."
      : "Qualification requirements were not included in this vacancy's published details. Check the official advert linked from this post before applying.";
  const dutiesAnswer = dutySummary.length
    ? `The advert describes ${role} as follows: ${dutySummary.join(" ")} See the Duties section in this post and confirm the full responsibilities in the official advert.`
    : "Duties were not included in this vacancy's published details. Check the official advert linked from this post for the role's responsibilities.";
  const dutySectionId = duties.length ? "duties" : purpose.length ? "job-purpose" : "vacancy-faq";
  const requirementSectionId = String(job.requirements ?? "").trim()
    ? "requirements"
    : String(job.skillsAndCompetencies ?? "").trim()
      ? "skills-and-competencies"
      : "vacancy-faq";
  const requirementSectionLabel = requirementSectionId === "skills-and-competencies"
    ? "Skills and competencies section in this post"
    : "Requirements section in this post";

  return [
    {
      question: `How much does the South African public service pay for the ${title} post${employer ? ` at ${employer}` : ""}?`,
      answer: salaryAnswers.gross,
      links: [
        { href: "#salary-details", label: "Salary details in this post" }
      ]
    },
    {
      question: `How much is the estimated monthly pay after South African tax for this ${title} post?`,
      answer: salaryAnswers.net,
      links: [
        { href: "#salary-details", label: "Salary details in this post" },
        { href: SARS_TAX_RATES_URL, label: `SARS ${SARS_TAX_YEAR} individual tax rates`, external: true }
      ]
    },
    {
      question: `What experience is required for this ${title} post?`,
      answer: experienceAnswer,
      links: [{ href: `#${requirementSectionId}`, label: requirementSectionLabel }]
    },
    {
      question: `What does the ${title} do while at work${job.province ? ` in ${normalizeProvince(job.province) || job.province}` : ""}?`,
      answer: dutiesAnswer,
      links: [{ href: `#${dutySectionId}`, label: "Duties or job-purpose section in this post" }]
    },
    {
      question: `What qualifications are required for this ${title} post?`,
      answer: qualificationAnswer,
      links: [{ href: `#${requirementSectionId}`, label: requirementSectionLabel }]
    }
  ];
}

function vacancyFaqMarkup(faqs) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(faq => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer
      }
    }))
  };
  const questions = faqs.map(faq => {
    const links = faq.links.map(link =>
      `<a href="${escapeHtml(link.href)}"${link.external ? ' rel="noopener noreferrer"' : ""}>${escapeHtml(link.label)}</a>`
    ).join(" · ");
    return `<details class="faq-item" open><summary>${escapeHtml(faq.question)}</summary><p>${escapeHtml(faq.answer)}</p><p class="faq-references">${links}</p></details>`;
  }).join("");
  return {
    schemaMarkup: `<script type="application/ld+json">${jsonLdScript(schema)}</script>`,
    markup: `<section class="vacancy-faq" id="vacancy-faq" aria-labelledby="vacancy-faq-heading"><h2 id="vacancy-faq-heading">Questions about this vacancy</h2><p class="faq-intro">Answers below are based on this post's details. Always confirm salary, eligibility and application requirements in the official advert.</p><div class="faq-list">${questions}</div></section>`
  };
}

function vacancyLinksSection(job) {
  if (!Array.isArray(job.links) || !job.links.length) return "";
  const links = job.links.map(link => {
    const url = typeof link?.url === "string" ? link.url.trim() : "";
    const rawLabel = typeof link?.label === "string" && link.label.trim() ? link.label.trim() : url || "Link";
    const label = url && rawLabel.toLowerCase().includes(url.toLowerCase()) ? url : rawLabel;
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return `<li>${escapeHtml(label)}${url ? `: ${escapeHtml(url)}` : ""}</li>`;
    }
    if (!["http:", "https:", "mailto:", "tel:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      return `<li>${escapeHtml(label)}${url ? `: ${escapeHtml(url)}` : ""}</li>`;
    }
    return `<li><a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`;
  });
  return `<section><h2>Links in the official circular</h2><ul>${links.join("")}</ul></section>`;
}

function vacancySectionMarkup(label, value) {
  if (["Requirements", "Duties", "Additional information"].includes(label)) {
    const renderPoints = points => `<ul>${points.map(point =>
      `<li>${escapeHtml(point.text)}${point.children?.length ? renderPoints(point.children) : ""}</li>`
    ).join("")}</ul>`;
    return renderPoints(splitVacancyPoints(value));
  }
  if (label === "How to apply") return `<p>${linkifyText(value)}</p>`;
  return `<p>${escapeHtml(value).replace(/\r?\n/g, "<br>")}</p>`;
}

function schemaForJob(job, pageUrl) {
  const datePosted = parseSouthAfricanDate(job.circularDate || "", false);
  const validThrough = getClosingDate(job);
  const hiringOrganization = hiringOrganizationName(job);
  const location = locationDetails(job);
  const descriptionText = detailSections(job).map(([, value]) => value).join("\n\n").trim();
  const description = detailSections(job).map(([label, value]) =>
    `<p><strong>${escapeHtml(label)}:</strong></p>${vacancySectionMarkup(label, value)}`
  ).join("");
  if (!hiringOrganization || !datePosted || !location || descriptionText.length < 100 || !job.sourceUrl) return null;

  const employmentTypes = {
    permanent: "OTHER",
    "full-time": "FULL_TIME",
    "part-time": "PART_TIME",
    contract: "CONTRACTOR",
    "fixed-term": "CONTRACTOR",
    temporary: "TEMPORARY",
    internship: "INTERN"
  };
  const employmentType = employmentTypes[String(job.type ?? "").toLowerCase()];
  const directApply = /@[\w.-]+\.[A-Z]{2,}\b|mailto:/i.test(String(job.applications ?? ""));
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: displayJobTitle(job.title),
    description,
    datePosted,
    ...(validThrough ? { validThrough } : {}),
    hiringOrganization: { "@type": "Organization", name: hiringOrganization },
    jobLocation: {
      "@type": "Place",
      address: location.address
    },
    identifier: {
      "@type": "PropertyValue",
      name: hiringOrganization,
      value: String(job.refNo || job.postNo || job.id)
    },
    url: pageUrl,
    ...(directApply ? { directApply: true } : {}),
    ...(employmentType ? { employmentType } : {})
  };
}

function htmlResponse(content, status = 200, robots = "index, follow") {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": robots
    }
  });
}

function vacancyPage(job, requestUrl, jobs) {
  const title = displayJobTitle(job.title);
  const pageUrl = new URL(jobPagePath(job), requestUrl.origin).href;
  const employer = hiringOrganizationName(job);
  const address = locationDetails(job);
  const location = [address?.locality, address?.province]
    .map(value => String(value ?? "").trim())
    .find(value => value && !/^(?:south africa|labour|department of labour)$/i.test(value));
  const deadline = String(job.closingDate ?? "").trim() || "Not stated; check the official advert";
  const description = detailSections(job).map(([, value]) => value).join(" ").replace(/\s+/g, " ").trim();
  const pageTitle = `${title}${employer ? ` at ${employer}` : ""} | DPSA Government Jobs`;
  const metaDescription = `${title}${employer ? ` at ${employer}` : ""}${location ? ` in ${location}` : ""}. ${description || "Check the official advert for requirements and application details."}`.slice(0, 155);
  const adUnitMarkup = `<aside class="content-ad" aria-label="Advertisement"><ins class="adsbygoogle" style="display:inline-block;width:300px;height:600px" data-ad-client="ca-pub-3860151941190347" data-ad-slot="3081508385"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></aside>`;
  const sections = detailSections(job).map(([label, value]) =>
    `${label === "Requirements" ? adUnitMarkup : ""}<section${label === "How to apply" ? ' id="how-to-apply"' : label === "Requirements" ? ' id="requirements"' : label === "Skills and competencies" ? ' id="skills-and-competencies"' : label === "Duties" ? ' id="duties"' : label === "Job purpose" ? ' id="job-purpose"' : ""}><h2>${escapeHtml(label)}</h2>${vacancySectionMarkup(label, value)}</section>`
  ).join("");
  const schema = schemaForJob(job, pageUrl);
  const schemaMarkup = schema ? `<script type="application/ld+json">${jsonLdScript(schema)}</script>` : "";
  const faq = vacancyFaqMarkup(vacancyFaq(job));
  const circularPage = String(job.circularPage ?? "").replace(/^page\s*/i, "").trim();
  const circularName = canonicalCircularName(job.circularName);
  const circularPath = circularArchivePath(circularName);
  const circularNavigation = groupJobsByCircular(jobs.filter(candidate => !isExpired(candidate)))
    .map(group => `<a href="${SITE_URL}${group.path}">${escapeHtml(group.name)}<span>${group.jobs.length} ${group.jobs.length === 1 ? "job" : "jobs"}</span></a>`)
    .join("");
  const publicationDetails = [
    circularName && ["Published", circularName],
    job.circularDate && ["Date", job.circularDate],
    circularPage && ["Page on Circular", `Page ${circularPage}`]
  ].filter(Boolean);
  const officialCircularLink = typeof job.sourceUrl === "string" && /^https:\/\//i.test(job.sourceUrl)
    ? `<p class="official-circular">Read/Download the official vacancy advert on ${job.circularName
      ? `<a href="${escapeHtml(job.sourceUrl)}" rel="noopener noreferrer">${escapeHtml(job.circularName)}</a>`
      : `<a href="${escapeHtml(job.sourceUrl)}" rel="noopener noreferrer">the official advert</a>`}</p>`
    : "";
  const referenceDetails = [
    job.refNo && ["Reference", job.refNo],
    job.postNo && ["Post number", job.postNo]
  ].filter(Boolean);
  const salaryText = String(job.salaryText || "Not stated in advert");
  const salaryMarkup = isNationalTreasuryScalesReference(salaryText)
    ? `<a class="salary-scales-link" href="${new URL(SALARY_SCALES_PATH, SITE_URL).href}">${SALARY_SCALES_LINK_LABEL}</a>`
    : escapeHtml(salaryText);
  const jobLevel = extractJobLevel(job);
  const jobLevelMarkup = jobLevel
    ? `<a class="salary-scales-link" href="${new URL(salaryLevelHref(jobLevel), SITE_URL).href}">${escapeHtml(jobLevel)}</a>`
    : "";
  const isCircularJob = Boolean(job.circularName) || /^https:\/\/(?:www\.)?dpsa\.gov\.za\//i.test(String(job.sourceUrl ?? ""));
  const province = normalizeProvince(job.province);
  const coatOfArmsPath = PROVINCE_CRESTS[province] || "/south-african-coat-of-arms.png";
  const shareImageUrl = new URL(isCircularJob ? coatOfArmsPath : "/south-african-flag.png", SITE_URL).href;
  const shareLinks = {
    facebook: `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: pageUrl })}`,
    twitter: `https://twitter.com/intent/tweet?${new URLSearchParams({ url: pageUrl, text: title })}`,
    pinterest: `https://pinterest.com/pin/create/button/?${new URLSearchParams({
      url: pageUrl,
      media: shareImageUrl,
      description: title
    })}`
  };
  const jobMark = isCircularJob
    ? `<img src="${SITE_URL}${coatOfArmsPath}" alt="${escapeHtml(province ? `${province} provincial coat of arms` : "South African national coat of arms")}" width="58" height="58" fetchpriority="high">`
    : `<span class="job-mark-generic" aria-hidden="true">▦</span>`;

  return htmlResponse(`<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://pagead2.googlesyndication.com" crossorigin>
<link rel="preconnect" href="https://googleads.g.doubleclick.net" crossorigin>
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3860151941190347" crossorigin="anonymous"></script>
<title>${escapeHtml(pageTitle)}</title><meta name="description" content="${escapeHtml(metaDescription)}">
<meta name="robots" content="index, follow"><link rel="canonical" href="${escapeHtml(pageUrl)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="DPSA Government Jobs">
<meta property="og:title" content="${escapeHtml(pageTitle)}"><meta property="og:description" content="${escapeHtml(metaDescription)}">
<meta property="og:url" content="${escapeHtml(pageUrl)}"><meta property="og:image" content="${escapeHtml(shareImageUrl)}">
<meta property="og:image:alt" content="DPSA Government Jobs vacancy">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(pageTitle)}">
<meta name="twitter:description" content="${escapeHtml(metaDescription)}"><meta name="twitter:image" content="${escapeHtml(shareImageUrl)}">
${schemaMarkup}
${faq.schemaMarkup}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light;font-family:"Jost",Arial,Helvetica,sans-serif;color:#32373c;background:#f8fbff}
*{box-sizing:border-box}body{margin:0;font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:#087ad2;text-underline-offset:3px}.shell{width:min(1120px,calc(100% - 40px));margin-inline:auto}
.site-header{background:#17499e;color:#fff;box-shadow:0 4px 16px rgba(13,42,95,.12)}
.nav{min-height:78px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.brand{display:inline-flex;align-items:center;gap:11px;color:#fff;text-decoration:none}
.brand img{width:40px;height:40px;border:1px solid rgba(255,255,255,.32);border-radius:50%;object-fit:cover}
.brand-copy{display:grid;line-height:1.15}.brand-title{font-size:15px;font-weight:800;letter-spacing:.05em}.brand-subtitle{color:#d7e5ff;font-size:10px}
.nav-links{display:flex;gap:24px;font-size:13px;font-weight:700}.nav-links a{color:#f4f7ff;text-decoration:none}
.nav-dropdown{position:relative;border:0}.nav-dropdown summary{display:inline-flex;align-items:center;gap:8px;padding:0;color:#f4f7ff;cursor:pointer;font-size:inherit;list-style:none;white-space:nowrap}.nav-dropdown summary::-webkit-details-marker{display:none}.nav-dropdown summary:after{width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;content:"";transform:rotate(45deg) translateY(-2px)}
.nav-dropdown-menu{position:absolute;top:calc(100% + 13px);left:0;z-index:30;display:none;width:max-content;min-width:250px;max-width:min(300px,calc(100vw - 32px));max-height:min(65vh,420px);overflow-y:auto;padding:8px;border:1px solid #e6eaf0;border-radius:9px;background:#fff;box-shadow:0 12px 30px rgba(20,40,70,.18)}
.nav-dropdown[open]>.nav-dropdown-menu,.nav-dropdown:hover>.nav-dropdown-menu,.nav-dropdown:focus-within>.nav-dropdown-menu{display:grid}
.nav-links .nav-dropdown-menu>a{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 10px;border-radius:6px;color:#32373c;font-size:13px;font-weight:600;white-space:nowrap}
.nav-links .nav-dropdown-menu>a:hover,.nav-links .nav-dropdown-menu>a:focus-visible{background:#f1f5fa;color:#17499e}.nav-links .nav-dropdown-menu>a:first-child{margin-bottom:4px;padding-bottom:11px;border-bottom:1px solid #e6eaf0;border-radius:0}.nav-dropdown-menu span{color:#6b747c;font-size:11px;font-weight:500}
main{padding-block:34px 58px}.breadcrumb{margin:0 0 18px;color:#748093;font-size:12px}
.vacancy-card{display:grid;grid-template-columns:58px minmax(0,1fr);gap:18px;padding:26px;border:1px solid #e6eaf0;border-radius:12px;background:#fff;box-shadow:0 8px 26px rgba(26,52,94,.045)}
.job-mark{display:grid;width:58px;height:58px;place-items:center;overflow:hidden;border:1px solid #e6eaf0;border-radius:11px;background:#fff}
.job-mark img{width:100%;height:100%;object-fit:contain}.job-mark-generic{display:grid;width:100%;height:100%;place-items:center;border-color:transparent;color:#fff;background:#2193e9;font-size:28px}
.job-content{min-width:0}.job-title{margin:0 0 14px;color:#17499e;font-size:20px;line-height:1.2;letter-spacing:-.035em;overflow-wrap:anywhere}
.intro{margin:0 0 18px;padding:13px 15px;border-left:3px solid #f2b632;border-radius:0 7px 7px 0;color:#536171;background:#f7f9fc}
.meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;margin:0 0 20px}
.meta{margin:0;color:#737d85;font-size:16px;overflow-wrap:anywhere}.meta strong{color:#32373c}
.circular-pill{display:inline-flex;align-items:center;padding:3px 10px;border:1px solid #d5e0f2;border-radius:999px;color:#17499e;background:#edf3fc;font-size:13px;font-weight:700;text-decoration:none}.circular-pill:hover{background:#e0ebfb}
.salary-scales-link{color:#17499e;font-weight:700;text-decoration:underline;text-underline-offset:2px}
.related-jobs{margin:28px 0 0;padding:24px;border:1px solid #e6eaf0;border-radius:12px;background:#fff}
.related-jobs h2{margin:0 0 16px;color:#17499e;font-size:20px;line-height:1.3}
.related-job-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.related-job-card{display:flex;min-width:0;flex-direction:column;gap:8px;padding:15px;border:1px solid #e6eaf0;border-radius:9px;color:#32373c;background:#f8fbff;text-decoration:none}
.related-job-card:hover{border-color:#b9c9e2;background:#f1f6fc}
.related-job-card strong{line-height:1.35;overflow-wrap:anywhere}
.related-job-card span{color:#66717c;font-size:13px}
.vacancy-faq{margin:28px 0 0;padding:24px;border:1px solid #e6eaf0;border-radius:12px;background:#fff}
.vacancy-faq h2{margin:0 0 8px;color:#17499e;font-size:22px;line-height:1.3}
.faq-intro{margin:0 0 16px;color:#66717c;font-size:14px}
.faq-list{display:grid;gap:10px}
.faq-item{padding:14px 16px;border:1px solid #e6eaf0;border-radius:9px;background:#f8fbff}
.faq-item summary{color:#263d5a;cursor:pointer;font-size:16px;font-weight:700}
.faq-item p{margin:10px 0 0;color:#536171;overflow-wrap:anywhere}
.faq-item .faq-references{font-size:13px}
.faq-references a{font-weight:600}
.circular-info{margin:0 0 16px;color:#737d85;font-size:13px}.apply{display:inline-flex;min-height:43px;align-items:center;justify-content:center;padding:10px 17px;border-radius:7px;color:#fff;background:#17499e;font-size:14px;font-weight:700;text-decoration:none}
.apply:hover{background:#13377f;color:#fff}.sections{grid-column:1/-1;border-top:1px solid #e6eaf0;margin-top:8px;padding-top:8px}
.sections section{margin:20px 0}.sections h2{margin:0 0 7px;color:#17499e;font-size:20px;line-height:1.3}.sections p,.sections li{color:#536171;font-size:16px;white-space:pre-line;overflow-wrap:anywhere}
.important{margin:24px 0 0;padding-top:15px;border-top:1px solid #e6eaf0;color:#737d85;font-size:12px}
.official-circular{margin:24px 0;color:#536171;font-size:16px}.site-footer{padding:22px 0;border-top:1px solid #e6eaf0;color:#6b747c;background:#f4f8fd;font-size:12px}.site-footer p{margin:0}
.content-ad{display:flex;justify-content:center;margin:24px 0}.content-ad .adsbygoogle{max-width:100%}
.sections .share-post{margin:24px 0;padding-top:16px;border-top:1px solid #e6eaf0}
.share-post h2{margin:0 0 12px;font-size:18px}
.post-share-links{display:flex;flex-wrap:wrap;gap:10px}
.post-share-link{display:inline-flex;min-height:40px;align-items:center;gap:8px;padding:7px 13px;border:1px solid #dce3ed;border-radius:7px;color:#17499e;background:#fff;font-size:14px;font-weight:600;text-decoration:none}
.post-share-link:hover{background:#e0ebfb}
.post-share-icon{display:grid;width:20px;height:20px;place-items:center;font-size:15px;font-weight:800}
.social-links{display:flex;align-items:center;gap:12px;margin-top:12px}.social-links a{display:grid;width:32px;height:32px;place-items:center;border:1px solid #dce3ed;border-radius:50%;color:#17499e;font-size:14px;font-weight:700;text-decoration:none}.social-links a:hover{background:#e0ebfb}
@media(max-width:700px){.related-job-grid{grid-template-columns:1fr}}
@media(max-width:600px){.shell{width:min(100% - 28px,1120px)}.nav{min-height:70px;gap:12px}.brand img{width:36px;height:36px}.nav-links{gap:12px;font-size:11px}main{padding-block:22px 38px}.vacancy-card{grid-template-columns:48px minmax(0,1fr);gap:13px;padding:17px}.job-mark{width:48px;height:48px;border-radius:9px}.meta-grid{grid-template-columns:1fr;gap:7px}.sections{margin-top:0}.related-jobs,.vacancy-faq{padding:17px}}
</style></head>
<body><header class="site-header"><nav class="nav shell" aria-label="Main navigation">
<a class="brand" href="${SITE_URL}/" aria-label="DPSA Government Jobs home"><img src="${SITE_URL}/south-african-flag.png" width="40" height="40" alt="" decoding="async"><span class="brand-copy"><span class="brand-title">DPSA</span><span class="brand-subtitle">Government Jobs</span></span></a>
<div class="nav-links"><a href="${SITE_URL}/">Home</a><details class="nav-dropdown"><summary>Circulars</summary><div class="nav-dropdown-menu"><a href="${SITE_URL}/dpsa-vacancy-circulars/">All circulars</a>${circularNavigation}</div></details><a href="${SITE_URL}/#listings">Vacancies</a></div>
</nav></header><main class="shell">
<nav class="breadcrumb" aria-label="Breadcrumb"><a href="${SITE_URL}/">Home</a> › ${escapeHtml(title)}</nav>
<article class="vacancy-card"><div class="job-mark">${jobMark}</div><div class="job-content">
<h1 class="job-title">${escapeHtml(title)}</h1><p class="intro">${employer ? `The ${escapeHtml(employer)} invites applications for ${escapeHtml(title)}.` : `Applications are invited for ${escapeHtml(title)}. Check the official advert for the hiring department.`}</p>
<div class="meta-grid"><p class="meta"><strong>Hiring department:</strong> ${escapeHtml(employer || "Check the official advert")}</p>
${location ? `<p class="meta"><strong>Location/centre in advert:</strong> ${escapeHtml(location)}</p>` : ""}
<p class="meta"><strong>Employment type:</strong> ${escapeHtml(job.type)}</p><p class="meta" id="salary-details"><strong>Salary:</strong> ${salaryMarkup}</p>
${jobLevel ? `<p class="meta"><strong>Job level:</strong> ${jobLevelMarkup}</p>` : ""}
<p class="meta"><strong>Closing date:</strong> ${escapeHtml(deadline)}</p>${referenceDetails.map(([label, value]) => `<p class="meta"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}
${publicationDetails.map(([label, value]) => `<p class="meta"><strong>${escapeHtml(label)}:</strong> ${label === "Published" && circularPath
  ? `<a class="circular-pill" href="${SITE_URL}${circularPath}">${escapeHtml(value)}</a>`
  : escapeHtml(value)}</p>`).join("")}</div>
</div><div class="sections">${sections}${vacancyLinksSection(job)}${officialCircularLink}
<section class="share-post" aria-labelledby="share-post-title"><h2 id="share-post-title">Share this post</h2>
<nav class="post-share-links" aria-label="Share this post">
<a class="post-share-link" href="${escapeHtml(shareLinks.facebook)}" target="_blank" rel="noopener noreferrer"><span class="post-share-icon" aria-hidden="true">f</span>Facebook</a>
<a class="post-share-link" href="${escapeHtml(shareLinks.twitter)}" target="_blank" rel="noopener noreferrer"><span class="post-share-icon" aria-hidden="true">𝕏</span>Twitter</a>
<a class="post-share-link" href="${escapeHtml(shareLinks.pinterest)}" target="_blank" rel="noopener noreferrer"><span class="post-share-icon" aria-hidden="true">P</span>Pinterest</a>
</nav></section>
<p class="important"><strong>Important:</strong> Confirm the department, eligibility, closing date and submission instructions in the official advert.</p></div>
</article>${faq.markup}${relatedJobsMarkup(job, jobs, requestUrl.origin)}</main><footer class="site-footer"><div class="shell"><p><a href="${SITE_URL}/">DPSA Government Jobs</a> is an independent guide. Always verify vacancy details with the hiring department.</p>
<nav class="social-links" aria-label="Social media">
<a href="https://www.facebook.com/DPSAGovernmentJobs" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on Facebook"><span aria-hidden="true">f</span></a>
<a href="https://x.com/dpsajobs" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on X"><span aria-hidden="true">𝕏</span></a>
<a href="https://za.pinterest.com/dpsavacancies/" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on Pinterest"><span aria-hidden="true">P</span></a>
</nav></div></footer></body></html>`);
}

function sitemapResponse(jobs, requestUrl) {
  const pages = jobs.filter(job => !isExpired(job)).map(job =>
    `  <url><loc>${escapeHtml(new URL(jobPagePath(job), requestUrl.origin).href)}</loc></url>`
  ).join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages}\n</urlset>`, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
}

export default {
  async scheduled(_controller, env) {
    await loadPublishedJobs(env);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "PUT" && request.method !== "OPTIONS") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    if (request.method === "GET" && !url.pathname.startsWith("/api/") &&
        (isFeedRequest(url) || isAdminPath(url.pathname))) {
      return homeRedirect();
    }
    if (url.pathname === "/robots.txt" && request.method === "GET") {
      return new Response(`User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" }
      });
    }
    if (url.pathname === "/ads.txt" && request.method === "GET") {
      return new Response(`${ADS_TXT}\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }
      });
    }

    if (url.pathname === "/api/jobs" && request.method === "OPTIONS") return jsonResponse({}, 204);

    if (request.method === "GET") {
      if (url.pathname === "/jobs" || url.pathname === "/jobs/") {
        return new Response(null, {
          status: 301,
          headers: {
            Location: `${SITE_URL}/#listings`,
            "Cache-Control": "public, max-age=3600"
          }
        });
      }

      const jobs = await loadPublishedJobs(env);
      const publicJobs = jobs.map(publicJob);
      if (url.pathname === "/sitemap.xml") return sitemapResponse(publicJobs, url);
      const legacyJobPath = url.pathname.match(/^\/jobs\/([^/]+)\/?$/);
      if (legacyJobPath) {
        let jobId;
        try {
          jobId = decodeURIComponent(legacyJobPath[1]);
        } catch {
          return homeRedirect();
        }
        const job = publicJobs.find(candidate => candidate.id === jobId || candidate.slug === jobId);
        if (!job) return homeRedirect(legacyCircularRedirectTarget(url) ?? "/");
        if (isExpired(job)) return htmlResponse("<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>This vacancy has closed. Check the official advert for current opportunities.</body></html>", 410, "noindex");
        return new Response(null, {
          status: 301,
          headers: {
            Location: new URL(jobPagePath(job), url.origin).href,
            "Cache-Control": "public, max-age=3600"
          }
        });
      }
      const jobPath = url.pathname.match(/^\/([^/]+)\/?$/);
      if (jobPath && !["api", "jobs"].includes(jobPath[1])) {
        let jobId;
        try {
          jobId = decodeURIComponent(jobPath[1]);
        } catch {
          return homeRedirect();
        }
        const job = publicJobs.find(candidate => candidate.slug === jobId || candidate.id === jobId);
        if (!job) return homeRedirect(legacyCircularRedirectTarget(url) ?? "/");
        if (isExpired(job)) return htmlResponse("<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>This vacancy has closed. Check the official advert for current opportunities.</body></html>", 410, "noindex");
        if (jobId !== job.slug) {
          return new Response(null, {
            status: 301,
            headers: {
              Location: new URL(jobPagePath(job), url.origin).href,
              "Cache-Control": "public, max-age=3600"
            }
          });
        }
        return vacancyPage(job, url, publicJobs);
      }
      if (url.pathname !== "/api/jobs") {
        if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
          return jsonResponse({ error: "Not found." }, 404);
        }
        return homeRedirect(legacyCircularRedirectTarget(url) ?? "/");
      }
      const authorization = request.headers.get("Authorization");
      if (authorization) {
        if (!env.ADMIN_TOKEN || authorization !== `Bearer ${env.ADMIN_TOKEN}`) {
          return jsonResponse({ error: "Invalid admin token." }, 401);
        }
        return jsonResponse(jobs);
      }
      return jsonResponse(publicJobs.filter(job => !isExpired(job)));
    }

    if (url.pathname !== "/api/jobs") return jsonResponse({ error: "Not found." }, 404);

    if (request.method !== "PUT") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    if (!env.ADMIN_TOKEN) {
      return jsonResponse({ error: "The Worker admin token is not configured." }, 503);
    }
    if (request.headers.get("Authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
      return jsonResponse({ error: "Invalid admin token." }, 401);
    }

    let jobs;
    try {
      jobs = await request.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }
    if (!validateJobs(jobs)) {
      return jsonResponse({ error: `Job list is invalid or exceeds the ${MAX_JOBS}-job limit.` }, 400);
    }

    const cleanedJobs = prunePublishedJobs(jobs);
    const serializedJobs = JSON.stringify(cleanedJobs.jobs);
    if (new TextEncoder().encode(serializedJobs).byteLength > MAX_JOBS_BYTES) {
      return jsonResponse({ error: "Job list is too large to store. Shorten vacancy descriptions and try again." }, 413);
    }

    await env.JOBS.put(JOBS_KEY, serializedJobs);
    return jsonResponse({
      success: true,
      count: cleanedJobs.jobs.length,
      removedExpiredCount: cleanedJobs.removedExpiredCount,
      removedCircularNames: cleanedJobs.removedCircularNames,
      removedJobIds: cleanedJobs.removedJobIds
    });
  }
};

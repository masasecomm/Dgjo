import defaultJobs from "../jobs.json" with { type: "json" };
import { cleanSalaryText, splitVacancyPoints } from "../vacancy-format.js";

const JOBS_KEY = "published-jobs";
const CATEGORIES = new Set([
  "Administration", "Education", "Finance", "Health", "Law Enforcement", "Other",
  "Design", "Engineering", "Marketing", "Product"
]);
const TYPES = new Set([
  "Permanent", "Fixed-term", "Temporary",
  "Full-time", "Part-time", "Contract", "Internship"
]);
const MAX_JOBS = 2000;
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
  return [displayJobTitle(job.title), ...identity]
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
    .map(value => String(value ?? "").trim())
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
  const company = hiringOrganizationName(enriched);
  const location = locationDetails(enriched);
  const centreIsGeneric = /^(?:labour|department of labour|national head office|(?:[a-z-]+\s+)*provincial service centre(?:\s+\d+)?|central office)$/i
    .test(String(enriched.centre ?? "").trim());
  return {
    ...enriched,
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

function vacancySectionMarkup(label, value) {
  if (["Requirements", "Duties", "Additional information"].includes(label)) {
    const renderPoints = points => `<ul>${points.map(point =>
      `<li>${escapeHtml(point.text)}${point.children?.length ? renderPoints(point.children) : ""}</li>`
    ).join("")}</ul>`;
    return renderPoints(splitVacancyPoints(value));
  }
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

function vacancyPage(job, requestUrl) {
  const title = displayJobTitle(job.title);
  const pageUrl = new URL(jobPagePath(job), requestUrl.origin).href;
  const employer = hiringOrganizationName(job);
  const location = [locationDetails(job)?.locality, job.province, job.centre, job.location]
    .map(value => String(value ?? "").trim())
    .find(value => value && !/^(?:south africa|labour|department of labour)$/i.test(value));
  const deadline = String(job.closingDate ?? "").trim() || "Not stated; check the official advert";
  const description = detailSections(job).map(([, value]) => value).join(" ").replace(/\s+/g, " ").trim();
  const pageTitle = `${title}${employer ? ` at ${employer}` : ""} | DPSA Government Jobs`;
  const metaDescription = `${title}${employer ? ` at ${employer}` : ""}${location ? ` in ${location}` : ""}. ${description || "Check the official advert for requirements and application details."}`.slice(0, 155);
  const adUnitMarkup = `<aside class="content-ad" aria-label="Advertisement"><ins class="adsbygoogle" style="display:inline-block;width:300px;height:600px" data-ad-client="ca-pub-3860151941190347" data-ad-slot="3081508385"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></aside>`;
  const sections = detailSections(job).map(([label, value]) =>
    `${label === "Requirements" ? adUnitMarkup : ""}<section${label === "How to apply" ? ' id="how-to-apply"' : ""}><h2>${escapeHtml(label)}</h2>${vacancySectionMarkup(label, value)}</section>`
  ).join("");
  const schema = schemaForJob(job, pageUrl);
  const schemaMarkup = schema ? `<script type="application/ld+json">${jsonLdScript(schema)}</script>` : "";
  const circularPage = String(job.circularPage ?? "").replace(/^page\s*/i, "").trim();
  const publicationDetails = [
    job.circularName && ["Published", job.circularName],
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
  const isCircularJob = Boolean(job.circularName) || /^https:\/\/(?:www\.)?dpsa\.gov\.za\//i.test(String(job.sourceUrl ?? ""));
  const shareImageUrl = new URL(
    isCircularJob ? "/south-african-coat-of-arms.png" : "/south-african-flag.png",
    SITE_URL
  ).href;
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
    ? `<img src="${SITE_URL}/south-african-coat-of-arms.png" alt="South African coat of arms" width="58" height="58" fetchpriority="high">`
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
main{padding-block:34px 58px}.breadcrumb{margin:0 0 18px;color:#748093;font-size:12px}
.vacancy-card{display:grid;grid-template-columns:58px minmax(0,1fr);gap:18px;padding:26px;border:1px solid #e6eaf0;border-radius:12px;background:#fff;box-shadow:0 8px 26px rgba(26,52,94,.045)}
.job-mark{display:grid;width:58px;height:58px;place-items:center;overflow:hidden;border:1px solid #e6eaf0;border-radius:11px;background:#fff}
.job-mark img{width:100%;height:100%;object-fit:contain}.job-mark-generic{display:grid;width:100%;height:100%;place-items:center;border-color:transparent;color:#fff;background:#2193e9;font-size:28px}
.job-content{min-width:0}.job-title{margin:0 0 14px;color:#17499e;font-size:20px;line-height:1.2;letter-spacing:-.035em;overflow-wrap:anywhere}
.intro{margin:0 0 18px;padding:13px 15px;border-left:3px solid #f2b632;border-radius:0 7px 7px 0;color:#536171;background:#f7f9fc}
.meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;margin:0 0 20px}
.meta{margin:0;color:#737d85;font-size:16px;overflow-wrap:anywhere}.meta strong{color:#32373c}
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
@media(max-width:600px){.shell{width:min(100% - 28px,1120px)}.nav{min-height:70px;gap:12px}.brand img{width:36px;height:36px}.nav-links{gap:12px;font-size:11px}main{padding-block:22px 38px}.vacancy-card{grid-template-columns:48px minmax(0,1fr);gap:13px;padding:17px}.job-mark{width:48px;height:48px;border-radius:9px}.meta-grid{grid-template-columns:1fr;gap:7px}.sections{margin-top:0}}
</style></head>
<body><header class="site-header"><nav class="nav shell" aria-label="Main navigation">
<a class="brand" href="${SITE_URL}/" aria-label="DPSA Government Jobs home"><img src="${SITE_URL}/south-african-flag.png" width="40" height="40" alt="" decoding="async"><span class="brand-copy"><span class="brand-title">DPSA</span><span class="brand-subtitle">Government Jobs</span></span></a>
<div class="nav-links"><a href="${SITE_URL}/">Home</a><a href="${SITE_URL}/dpsa-vacancy-circulars/">Circulars</a><a href="${SITE_URL}/#listings">Vacancies</a></div>
</nav></header><main class="shell">
<nav class="breadcrumb" aria-label="Breadcrumb"><a href="${SITE_URL}/">Home</a> › ${escapeHtml(title)}</nav>
<article class="vacancy-card"><div class="job-mark">${jobMark}</div><div class="job-content">
<h1 class="job-title">${escapeHtml(title)}</h1><p class="intro">${employer ? `The ${escapeHtml(employer)} invites applications for ${escapeHtml(title)}.` : `Applications are invited for ${escapeHtml(title)}. Check the official advert for the hiring department.`}</p>
<div class="meta-grid"><p class="meta"><strong>Hiring department:</strong> ${escapeHtml(employer || "Check the official advert")}</p>
${location ? `<p class="meta"><strong>Location/centre in advert:</strong> ${escapeHtml(location)}</p>` : ""}
<p class="meta"><strong>Employment type:</strong> ${escapeHtml(job.type)}</p><p class="meta"><strong>Salary:</strong> ${escapeHtml(job.salaryText || "Not stated in advert")}</p>
<p class="meta"><strong>Closing date:</strong> ${escapeHtml(deadline)}</p>${referenceDetails.map(([label, value]) => `<p class="meta"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}
${publicationDetails.map(([label, value]) => `<p class="meta"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}</div>
</div><div class="sections">${sections}${officialCircularLink}
<section class="share-post" aria-labelledby="share-post-title"><h2 id="share-post-title">Share this post</h2>
<nav class="post-share-links" aria-label="Share this post">
<a class="post-share-link" href="${escapeHtml(shareLinks.facebook)}" target="_blank" rel="noopener noreferrer"><span class="post-share-icon" aria-hidden="true">f</span>Facebook</a>
<a class="post-share-link" href="${escapeHtml(shareLinks.twitter)}" target="_blank" rel="noopener noreferrer"><span class="post-share-icon" aria-hidden="true">𝕏</span>Twitter</a>
<a class="post-share-link" href="${escapeHtml(shareLinks.pinterest)}" target="_blank" rel="noopener noreferrer"><span class="post-share-icon" aria-hidden="true">P</span>Pinterest</a>
</nav></section>
<p class="important"><strong>Important:</strong> Confirm the department, eligibility, closing date and submission instructions in the official advert.</p></div>
</article></main><footer class="site-footer"><div class="shell"><p><a href="${SITE_URL}/">DPSA Government Jobs</a> is an independent guide. Always verify vacancy details with the hiring department.</p>
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
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "PUT" && request.method !== "OPTIONS") {
      return jsonResponse({ error: "Method not allowed." }, 405);
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

      const savedJobs = await env.JOBS.get(JOBS_KEY, "json");
      const jobs = savedJobs ?? defaultJobs;
      const publicJobs = jobs.map(publicJob);
      if (url.pathname === "/sitemap.xml") return sitemapResponse(publicJobs, url);
      const legacyJobPath = url.pathname.match(/^\/jobs\/([^/]+)\/?$/);
      if (legacyJobPath) {
        let jobId;
        try {
          jobId = decodeURIComponent(legacyJobPath[1]);
        } catch {
          return htmlResponse("<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>Vacancy not found.</body></html>", 404, "noindex");
        }
        const job = publicJobs.find(candidate => candidate.id === jobId || candidate.slug === jobId);
        if (!job) return htmlResponse("<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>Vacancy not found.</body></html>", 404, "noindex");
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
          return htmlResponse("<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>Vacancy not found.</body></html>", 404, "noindex");
        }
        const job = publicJobs.find(candidate => candidate.slug === jobId || candidate.id === jobId);
        if (!job) return htmlResponse("<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>Vacancy not found.</body></html>", 404, "noindex");
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
        return vacancyPage(job, url);
      }
      if (url.pathname !== "/api/jobs") return jsonResponse({ error: "Not found." }, 404);
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

    const serializedJobs = JSON.stringify(jobs);
    if (new TextEncoder().encode(serializedJobs).byteLength > MAX_JOBS_BYTES) {
      return jsonResponse({ error: "Job list is too large to store. Shorten vacancy descriptions and try again." }, 413);
    }

    await env.JOBS.put(JOBS_KEY, serializedJobs);
    return jsonResponse({ success: true, count: jobs.length });
  }
};

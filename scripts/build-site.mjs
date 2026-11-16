import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_URL = process.env.JOBS_API_URL || "https://goodwork-jobs-api.dpsajobs.workers.dev/api/jobs";
const JOBS_PAGE_ORIGIN = "https://jobs.dpsagovernmentjobs.co.za";
const JOBS_START = "<!-- JOB_LISTINGS_START -->";
const JOBS_END = "<!-- JOB_LISTINGS_END -->";
const COUNT_START = "<!-- JOB_COUNT_START -->";
const COUNT_END = "<!-- JOB_COUNT_END -->";
const DATA_MARKER = "<!-- JOB_DATA -->";
const SNAPSHOT_FIELDS = [
  "id", "slug", "title", "company", "circularName", "sourceUrl", "centre", "province",
  "location", "salaryText", "natureOfAppointment", "type", "closingDate", "refNo", "category"
];

const acronymNames = new Set([
  "AIDS", "CEO", "CFO", "DDG", "DPSA", "GIS", "HIV", "HOD", "HR", "ICT", "ID", "IT",
  "MEC", "NQF", "OHS", "PMDS", "SAPS", "SCM", "SMS", "TVET"
]);
const monthNumbers = new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2], ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4], ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["september", 9], ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11], ["dec", 12], ["december", 12]
]);

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
  return title.toLocaleLowerCase("en-ZA").replace(/\b[\p{L}][\p{L}'’.-]*/gu, word =>
    acronymNames.has(word.toLocaleUpperCase("en-ZA"))
      ? word.toLocaleUpperCase("en-ZA")
      : `${word.charAt(0).toLocaleUpperCase("en-ZA")}${word.slice(1)}`
  );
}

function expiryLabel(value) {
  const text = String(value ?? "");
  const isoDate = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  const textDate = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/);
  const year = Number(isoDate?.[1] ?? textDate?.[3]);
  const month = Number(isoDate?.[2] ?? monthNumbers.get(textDate?.[2]?.toLowerCase()));
  const day = Number(isoDate?.[3] ?? textDate?.[1]);
  if (!year || !month || !day) return "";

  const closingDay = Date.UTC(year, month - 1, day);
  const closingDate = new Date(closingDay);
  if (closingDate.getUTCFullYear() !== year || closingDate.getUTCMonth() !== month - 1 || closingDate.getUTCDate() !== day) return "";

  const todayParts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(new Date()).map(part => [part.type, Number(part.value)]));
  const today = Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day);
  const daysRemaining = Math.round((closingDay - today) / 86400000);
  if (daysRemaining < 0) return "";
  if (daysRemaining === 0) return "Expires today";
  return `Expires in ${daysRemaining} ${daysRemaining === 1 ? "day" : "days"}`;
}

function metadataIcon(type) {
  const shapes = {
    department: "M3 8h18v12H3z M8 8V5h8v3 M3 12h18 M10 12v2h4v-2",
    location: "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0 M12 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
    salary: "M3 6h18v12H3z M3 9h18 M3 15h18 M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4"
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${shapes[type]}"></path></svg>`;
}

function isDisplayableJob(job) {
  return job &&
    typeof job.title === "string" &&
    typeof job.company === "string" &&
    (typeof job.slug === "string" || typeof job.id === "string");
}

export function renderJobListings(jobs) {
  const displayableJobs = jobs.filter(isDisplayableJob);
  if (!displayableJobs.length) {
    return '<p class="listing-empty">There are no current job listings. Please check back soon.</p>';
  }

  return displayableJobs.map(job => {
    const slug = encodeURIComponent(String(job.slug || job.id));
    const jobUrl = `${JOBS_PAGE_ORIGIN}/${slug}/`;
    const isCircularJob = Boolean(job.circularName) || /^https:\/\/(?:www\.)?dpsa\.gov\.za\//i.test(String(job.sourceUrl ?? ""));
    const mark = isCircularJob
      ? '<img src="south-african-coat-of-arms.png" alt="South African coat of arms">'
      : '<span class="listing-card-mark-generic" aria-hidden="true">▦</span>';
    const hasDepartment = !/^(?:south african public service|hiring department not identified|department not specified)$/i.test(job.company.trim());
    const department = hasDepartment
      ? `<a class="listing-department-link" href="/?department=${encodeURIComponent(job.company)}#listings">${escapeHtml(job.company)}</a>`
      : "Department: see official advert";
    const location = [job.centre, job.province, job.location]
      .map(value => String(value ?? "").trim())
      .find(value => value && !/^(?:south africa|labour|department of labour)$/i.test(value));
    const metadata = [
      `<span class="listing-meta-item">${metadataIcon("department")}${department}</span>`,
      location ? `<span class="listing-meta-item">${metadataIcon("location")}${escapeHtml(location)}</span>` : "",
      job.salaryText ? `<span class="listing-meta-item">${metadataIcon("salary")}${escapeHtml(job.salaryText)}</span>` : ""
    ].filter(Boolean).join("");
    const employmentType = String(job.natureOfAppointment ?? "").trim() || String(job.type ?? "").trim();
    const expiry = expiryLabel(job.closingDate);
    const badges = [
      employmentType && `<span class="listing-card-type">${escapeHtml(employmentType)}</span>`,
      expiry && `<span class="listing-card-type listing-card-expiry">${escapeHtml(expiry)}</span>`
    ].filter(Boolean).join("");

    return `<article class="listing-card"><div class="listing-card-mark">${mark}</div><div class="listing-card-content"><div class="listing-card-title"><h3><a href="${jobUrl}">${escapeHtml(displayJobTitle(job.title))}</a></h3></div><div class="listing-card-meta">${metadata}</div><div class="listing-card-bottom">${badges}<a class="listing-card-apply" href="${jobUrl}#how-to-apply">Apply</a></div></div></article>`;
  }).join("");
}

function replaceMarkedContent(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end < start || source.indexOf(startMarker, start + startMarker.length) >= 0 ||
      source.indexOf(endMarker, end + endMarker.length) >= 0) {
    throw new Error(`Expected one ordered pair of ${startMarker} and ${endMarker}.`);
  }
  return `${source.slice(0, start + startMarker.length)}${replacement}${source.slice(end)}`;
}

function replaceUniqueMarker(source, marker, replacement) {
  const index = source.indexOf(marker);
  if (index < 0 || source.indexOf(marker, index + marker.length) >= 0) {
    throw new Error(`Expected one ${marker} marker.`);
  }
  return `${source.slice(0, index)}${replacement}${source.slice(index + marker.length)}`;
}

export async function buildSite() {
  const response = await fetch(API_URL, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Job service returned HTTP ${response.status}.`);
  const jobs = await response.json();
  if (!Array.isArray(jobs)) throw new Error("Job service returned an invalid list.");

  const validJobs = jobs.filter(isDisplayableJob);
  let index = await readFile(path.join(ROOT, "index.html"), "utf8");
  index = replaceMarkedContent(index, JOBS_START, JOBS_END, renderJobListings(validJobs));
  index = replaceMarkedContent(index, COUNT_START, COUNT_END, `${validJobs.length} current ${validJobs.length === 1 ? "vacancy" : "vacancies"}`);
  const snapshot = validJobs.map(job => Object.fromEntries(
    SNAPSHOT_FIELDS.filter(field => job[field] !== undefined).map(field => [field, job[field]])
  ));
  const safeSnapshot = JSON.stringify(snapshot)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  index = replaceUniqueMarker(index, DATA_MARKER, `<script type="application/json" id="initial-job-data">${safeSnapshot}</script>`);

  const output = path.resolve(process.env.SITE_OUTPUT_DIR || path.join(ROOT, "dist"));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "index.html"), index);
  const files = [
    "404.html", "CNAME", "ads.txt", "jobs.json", "robots.txt", "sitemap.xml",
    "south-african-coat-of-arms.png", "south-african-flag.png", "styles.css", "vacancy-format.js"
  ];
  for (const file of files) {
    await cp(path.join(ROOT, file), path.join(output, file), { force: true });
  }
  for (const directory of ["dpsa-vacancy-circulars", "how-to-apply"]) {
    await cp(path.join(ROOT, directory), path.join(output, directory), { recursive: true, force: true });
  }
  console.log(`Built homepage with ${validJobs.length} server-rendered vacancy listings.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await buildSite();
}

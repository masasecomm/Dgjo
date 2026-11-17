import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalCircularName,
  circularArchiveAnchor,
  circularArchivePath,
  compareCircularNames,
  groupJobsByCircular,
  MAX_ACTIVE_CIRCULARS,
  sortJobsByCircular,
  SEARCH_CONSOLE_ARCHIVED_CIRCULARS
} from "../circulars.js";
import {
  normalizeJobRegion,
  normalizeProvince,
  NATIONAL_REGION,
  PROVINCE_CRESTS,
  SOUTH_AFRICAN_PROVINCES
} from "../provinces.js";
import {
  extractJobLevel,
  isNationalTreasuryScalesReference,
  SALARY_SCALES_LINK_LABEL,
  SALARY_SCALES_PATH,
  salaryLevelHref
} from "../salary-scales.js";
import { cleanVacancyLocation, cleanVacancyTitle } from "../vacancy-format.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRequire = createRequire(new URL("../extension/package.json", import.meta.url));
const { build: buildBrowserBundle } = extensionRequire("esbuild");
const API_URL = process.env.JOBS_API_URL || "https://goodwork-jobs-api.dpsajobs.workers.dev/api/jobs";
const SITE_URL = "https://dpsagovernmentjobs.co.za";
const JOBS_PAGE_ORIGIN = "https://jobs.dpsagovernmentjobs.co.za";
const INITIAL_LISTING_COUNT = 4;
const INITIAL_VISIBLE_LISTING_COUNT = 10;
const JOBS_START = "<!-- JOB_LISTINGS_START -->";
const JOBS_END = "<!-- JOB_LISTINGS_END -->";
const JOBS_CONTINUATION_START = "<!-- JOB_LISTINGS_CONTINUATION_START -->";
const JOBS_CONTINUATION_END = "<!-- JOB_LISTINGS_CONTINUATION_END -->";
const COUNT_START = "<!-- JOB_COUNT_START -->";
const COUNT_END = "<!-- JOB_COUNT_END -->";
const DATA_MARKER = "<!-- JOB_DATA -->";
const CIRCULAR_ARCHIVES_START = "<!-- CIRCULAR_ARCHIVES_START -->";
const CIRCULAR_ARCHIVES_END = "<!-- CIRCULAR_ARCHIVES_END -->";
const PAST_CIRCULARS_START = "<!-- PAST_CIRCULARS_START -->";
const PAST_CIRCULARS_END = "<!-- PAST_CIRCULARS_END -->";
const PROVINCE_GUIDES_START = "<!-- PROVINCE_GUIDES_START -->";
const PROVINCE_GUIDES_END = "<!-- PROVINCE_GUIDES_END -->";
const CIRCULAR_NAV_ITEMS = "<!-- CIRCULAR_NAV_ITEMS -->";
const SNAPSHOT_FIELDS = [
  "id", "slug", "title", "company", "circularName", "sourceUrl", "centre", "province",
  "location", "salaryText", "level", "natureOfAppointment", "type", "closingDate", "refNo", "category"
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
  const title = cleanVacancyTitle(value);
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

function closingDateLabel(value) {
  const text = String(value ?? "");
  const isoDate = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  const textDate = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/);
  const year = Number(isoDate?.[1] ?? textDate?.[3]);
  const month = Number(isoDate?.[2] ?? monthNumbers.get(textDate?.[2]?.toLowerCase()));
  const day = Number(isoDate?.[3] ?? textDate?.[1]);
  if (!year || !month || !day) return "";

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return new Intl.DateTimeFormat("en-ZA", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function metadataIcon(type) {
  const shapes = {
    department: "M3 8h18v12H3z M8 8V5h8v3 M3 12h18 M10 12v2h4v-2",
    location: "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0 M12 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
    salary: "M3 6h18v12H3z M3 9h18 M3 15h18 M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
    clock: "M12 8v4l2 2 M5.5 4.5 3 7 M18.5 4.5 21 7 M6 20l-2 2 M18 20l2 2 M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18"
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${shapes[type]}"></path></svg>`;
}

function isDisplayableJob(job) {
  return job &&
    typeof job.title === "string" &&
    typeof job.company === "string" &&
    (typeof job.slug === "string" || typeof job.id === "string");
}

export function renderJobListings(jobs, { includeCircularBadge = true } = {}) {
  const displayableJobs = jobs.filter(isDisplayableJob);
  if (!displayableJobs.length) {
    return '<p class="listing-empty">There are no current job listings. Please check back soon.</p>';
  }

  return displayableJobs.map(job => {
    const slug = encodeURIComponent(String(job.slug || job.id));
    const jobUrl = `${JOBS_PAGE_ORIGIN}/${slug}/`;
    const isCircularJob = Boolean(job.circularName) || /^https:\/\/(?:www\.)?dpsa\.gov\.za\//i.test(String(job.sourceUrl ?? ""));
    const province = normalizeJobRegion(job.province);
    const crestPath = PROVINCE_CRESTS[province] ?? "/south-african-coat-of-arms.png";
    const isProvincial = Boolean(PROVINCE_CRESTS[province]);
    const scope = isCircularJob ? (isProvincial ? "Provincial" : "National") : "";
    const mark = isCircularJob
      ? `<img src="${escapeHtml(crestPath)}" alt="${escapeHtml(isProvincial ? `${province} provincial coat of arms` : "South African national coat of arms")}" width="64" height="64" loading="lazy" decoding="async">`
      : '<span class="listing-card-mark-generic" aria-hidden="true">▦</span>';
    const hasDepartment = !/^(?:south african public service|hiring department not identified|department not specified)$/i.test(job.company.trim());
    const department = hasDepartment
      ? `<a class="listing-department-link" href="/?department=${encodeURIComponent(job.company)}#listings">${escapeHtml(job.company)}</a>`
      : "Department: see official advert";
    const location = [job.centre, province, job.location]
      .map(cleanVacancyLocation)
      .find(value => value && !/^(?:south africa|labour|department of labour)$/i.test(value));
    const closingDate = closingDateLabel(job.closingDate);
    const salary = isNationalTreasuryScalesReference(job.salaryText)
      ? `<a class="listing-salary-link" href="${SALARY_SCALES_PATH}">${SALARY_SCALES_LINK_LABEL}</a>`
      : escapeHtml(job.salaryText);
    const jobLevel = extractJobLevel(job);
    const metadata = [
      `<span class="listing-meta-item">${metadataIcon("department")}${department}</span>`,
      location ? `<span class="listing-meta-item">${metadataIcon("location")}${escapeHtml(location)}</span>` : "",
      job.salaryText ? `<span class="listing-meta-item">${metadataIcon("salary")}${salary}</span>` : "",
      jobLevel ? `<span class="listing-meta-item">${metadataIcon("salary")}Job level: <a class="listing-salary-link" href="${salaryLevelHref(jobLevel)}">${jobLevel}</a></span>` : "",
      closingDate
        ? `<span class="listing-meta-item" aria-label="Closing: ${escapeHtml(closingDate)}">${metadataIcon("clock")}Closing: ${escapeHtml(closingDate)}</span>`
        : ""
    ].filter(Boolean).join("");
    const employmentType = String(job.natureOfAppointment ?? "").trim() || String(job.type ?? "").trim();
    const expiry = expiryLabel(job.closingDate);
    const circularName = canonicalCircularName(job.circularName);
    const circularPath = includeCircularBadge ? circularArchivePath(circularName) : "";
    const badges = [
      employmentType && `<span class="listing-card-type">${escapeHtml(employmentType)}</span>`,
      scope && `<span class="listing-card-type listing-card-scope-${scope.toLowerCase()}">${scope}</span>`,
      circularName && circularPath
        ? `<a class="listing-card-type listing-card-circular" href="${circularPath}">${escapeHtml(circularName)}</a>`
        : "",
      expiry && `<span class="listing-card-type listing-card-expiry">${escapeHtml(expiry)}</span>`
    ].filter(Boolean).join("");

    return `<article class="listing-card"><div class="listing-card-mark">${mark}</div><div class="listing-card-content"><div class="listing-card-title"><h3><a href="${jobUrl}">${escapeHtml(displayJobTitle(job.title))}</a></h3></div><div class="listing-card-meta">${metadata}</div><div class="listing-card-bottom">${badges}<a class="listing-card-apply" href="${jobUrl}#how-to-apply">Apply</a></div></div></article>`;
  }).join("");
}

export function renderHomeJobListings(jobs) {
  return renderJobListings(sortJobsByCircular(jobs).slice(0, INITIAL_LISTING_COUNT));
}

export function renderHomeJobContinuation(jobs) {
  const continuation = sortJobsByCircular(jobs).slice(INITIAL_LISTING_COUNT, INITIAL_VISIBLE_LISTING_COUNT);
  return continuation.length ? renderJobListings(continuation) : "";
}

export function renderCircularArchiveLinks(circularGroups) {
  if (!circularGroups.length) return "<p>No current circular job collections are available.</p>";
  return `<ul class="circular-archive-list">${circularGroups.map(group =>
    `<li id="${escapeHtml(circularArchiveAnchor(group.name))}"><a href="${group.path}">${escapeHtml(group.name)}</a><span>${group.jobs.length} ${group.jobs.length === 1 ? "current job" : "current jobs"}</span></li>`
  ).join("")}</ul>`;
}

export function renderCircularNavigationItems(circularGroups) {
  return [...circularGroups]
    .filter(group => Array.isArray(group.jobs) && group.jobs.length > 0)
    .sort((left, right) => compareCircularNames(left.name, right.name))
    .slice(-MAX_ACTIVE_CIRCULARS)
    .reverse()
    .map(group =>
      `<a href="${escapeHtml(group.path)}">${escapeHtml(group.name)}<span class="nav-dropdown-count">${group.jobs.length} ${group.jobs.length === 1 ? "job" : "jobs"}</span></a>`
    )
    .join("");
}

export function renderPastCircularArchiveLinks(circularNames = SEARCH_CONSOLE_ARCHIVED_CIRCULARS) {
  if (!circularNames.length) return "<p>No previous circular issues are listed.</p>";
  return `<ul class="circular-archive-list">${circularNames.map(name =>
    `<li id="${escapeHtml(circularArchiveAnchor(name))}"><strong>${escapeHtml(name)}</strong><span>Past issue; <a href="https://www.dpsa.gov.za/newsroom/psvc/" rel="noopener noreferrer">check the official DPSA page</a> for the original publication.</span></li>`
  ).join("")}</ul>`;
}

function provincePath(province) {
  const slug = province.toLocaleLowerCase("en-ZA").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `/government-vacancies/${slug}/`;
}

export function groupJobsByProvince(jobs) {
  const groups = new Map(SOUTH_AFRICAN_PROVINCES.map(name => [name, {
    name,
    path: provincePath(name),
    jobs: []
  }]));
  for (const job of jobs) {
    const province = normalizeJobRegion(job?.province);
    if (groups.has(province)) groups.get(province).jobs.push(job);
  }
  return [...groups.values()].filter(group => group.jobs.length > 0);
}

export function renderProvinceGuideLinks(provinceGroups) {
  if (!provinceGroups.length) return "<p>Province vacancy guides will appear when current listings are available.</p>";
  return `<ul class="circular-archive-list">${provinceGroups.map(group =>
    `<li><a href="${group.path}">${escapeHtml(group.name)} government vacancies</a><span>${group.jobs.length} current ${group.jobs.length === 1 ? "vacancy" : "vacancies"}</span></li>`
  ).join("")}</ul>`;
}

function renderSiteFooter() {
  return `<footer class="site-footer"><div class="shell footer-inner">
  <div class="footer-main">
    <div class="footer-contact">
      <a class="brand home-brand" href="/" aria-label="DPSA Government Jobs home"><img src="/south-african-flag.png" width="40" height="40" alt="" decoding="async"><span class="home-brand-copy"><span class="home-brand-title">DPSA</span><span class="home-brand-subtitle">Government Jobs</span></span></a>
      <address class="footer-address"><img src="/footer-location.svg" alt=""><span>Office 531, 5th Floor, Barend van Erkom Building, 217 Pretorius Street, Pretoria Central, Pretoria, 0002</span></address>
    </div>
    <nav class="footer-column" aria-label="Vacancies"><h2>Vacancies</h2><a href="/">All vacancies</a><a href="/government-vacancies/">Vacancies by province</a><a href="/dpsa-vacancy-circulars/">DPSA circulars</a></nav>
    <nav class="footer-column" aria-label="Job seeker resources"><h2>Job seeker resources</h2><a href="/how-to-apply/">How to apply</a><a href="/national-treasury-salary-scales/">National Treasury salary scales</a><a href="/job-alert-terms.html">Job alert terms</a></nav>
    <nav class="footer-column footer-social-column" aria-label="Official information and social media">
      <h2>Official information</h2><a href="https://www.dpsa.gov.za/newsroom/psvc/" target="_blank" rel="noopener noreferrer">Official DPSA circulars ↗</a><a href="/#questions-heading">Contact</a><span class="footer-follow-label">Follow us</span>
      <div class="social-links">
        <a href="https://www.facebook.com/DPSAGovernmentJobs" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on Facebook"><img src="/footer-facebook.svg" alt=""></a>
        <a href="https://x.com/dpsajobs" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on X"><img src="/footer-x.svg" alt=""></a>
        <a href="https://za.pinterest.com/dpsavacancies/" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on Pinterest"><img src="/footer-pinterest.svg" alt=""></a>
      </div>
    </nav>
  </div>
  <div class="footer-bottom"><span>© DPSA Government Jobs</span><span>This is an independent guide and is not affiliated with DPSA.</span></div>
</div></footer>`;
}

export function renderProvinceLandingPage(provinceValue, jobs) {
  const province = normalizeProvince(provinceValue);
  if (!province) throw new Error("A recognized South African province is required.");
  const archivePath = provincePath(province);
  const canonicalUrl = `${SITE_URL}${archivePath}`;
  const isGauteng = province === "Gauteng";
  const isNational = province === NATIONAL_REGION;
  const title = isGauteng
    ? "Government Vacancies in Gauteng | Current DPSA Jobs"
    : isNational
      ? "National Government Vacancies | Current DPSA Jobs"
    : `DPSA Vacancies in ${province} | Government Jobs`;
  const description = isGauteng
    ? "Browse current DPSA circular jobs in Gauteng. Looking for GPG vacancies? Check each advert; this is not a complete list of all GPG or municipal recruitment."
    : isNational
      ? "Browse current national DPSA public service vacancies that are not assigned to a specific province. Check each official advert for location, requirements and application details."
    : `Browse current DPSA public service vacancies located in ${province}. Check each official advert for requirements, application instructions and closing dates.`;
  const intro = isGauteng
    ? "Looking for GPG vacancies? These are current DPSA circular jobs whose advertised work location is Gauteng. This page is not a complete list of all Gauteng Provincial Government or municipal recruitment; verify every role in the department's official advert."
    : isNational
      ? "These current public service vacancies are national posts or are not assigned to a specific province. Check each official advert for the exact work location and application requirements."
    : `Browse current South African public service vacancies located in ${province}. Each listing links to job details; confirm its requirements, application method and closing date in the official department advert.`;
  const itemList = {
    "@type": "ItemList",
    numberOfItems: jobs.length,
    itemListElement: jobs.map((job, index) => {
      const slug = encodeURIComponent(String(job.slug || job.id));
      return {
        "@type": "ListItem",
        position: index + 1,
        name: displayJobTitle(job.title),
        url: `${JOBS_PAGE_ORIGIN}/${slug}/`
      };
    })
  };
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonicalUrl,
    inLanguage: "en-ZA",
    mainEntity: itemList,
    isPartOf: {
      "@type": "WebSite",
      name: "DPSA Government Jobs",
      url: `${SITE_URL}/`
    }
  };

  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet">
  <link rel="preconnect" href="https://pagead2.googlesyndication.com" crossorigin>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3860151941190347" crossorigin="anonymous"></script>
  <link rel="stylesheet" href="/styles.css">
  <title>${escapeHtml(title)}</title>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="DPSA Government Jobs">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <script type="module" src="/redirects.js"></script>
  <script type="application/ld+json">${jsonLd(structuredData)}</script>
</head>
<body class="post-theme">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><nav class="nav shell" aria-label="Main navigation">
    <a class="brand home-brand" href="/" aria-label="DPSA Government Jobs home"><img src="/south-african-flag.png" width="40" height="40" alt="" decoding="async"><span class="home-brand-copy"><span class="home-brand-title">DPSA</span><span class="home-brand-subtitle">Government Jobs</span></span></a>
    <div class="nav-links"><a href="/">Vacancies</a><details class="nav-dropdown"><summary>Circulars</summary><div class="nav-dropdown-menu"><a class="nav-dropdown-all" href="/dpsa-vacancy-circulars/">All circulars</a>${CIRCULAR_NAV_ITEMS}</div></details><a href="/#questions-heading">Contact</a></div>
  </nav></header>
  <main id="main">
    <div class="site-post">
    <section class="page-hero"><div class="shell">
      <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span> South African public service vacancies</p>
      <h1>${isGauteng ? "Gauteng Government Vacancies" : isNational ? "National Government Vacancies" : `Government vacancies in ${escapeHtml(province)}`}</h1>
      <p class="lead">${escapeHtml(intro)}</p>
      <a class="button" href="https://www.dpsa.gov.za/newsroom/psvc/" rel="noopener noreferrer">Check the official DPSA circulars</a>
    </div></section>
    <section class="content-section"><div class="shell">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › Government vacancies › ${escapeHtml(province)}</nav>
      <h2>${isNational ? "Current national government vacancies" : `Current government jobs in ${escapeHtml(province)}`}</h2>
      <p>${jobs.length} current ${jobs.length === 1 ? "vacancy is" : "vacancies are"} listed for ${isNational ? "the national category" : `this province`}. Confirm that the advertised location and deadline meet your needs before applying.</p>
      <div class="listing-grid">${renderJobListings(jobs)}</div>
      <h2>Before you apply</h2>
      <ol>
        <li>Read the full official department advert, including qualifications and reference number.</li>
        <li>Follow the stated application method and submit all requested documents before the closing date.</li>
        <li>Direct questions to the hiring department named in the advert; this site is an independent guide.</li>
      </ol>
      <p>For more opportunities, browse <a href="/dpsa-vacancy-circulars/">current DPSA circulars</a> or return to <a href="/">all South African government vacancies</a>.</p>
    </div></section>
    </div>
  </main>
  ${renderSiteFooter()}
</body>
</html>`;
}

function jsonLd(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029"
  })[character]);
}

export function renderCircularArchivePage(circularName, jobs) {
  const name = canonicalCircularName(circularName);
  const archivePath = circularArchivePath(name);
  if (!name || !archivePath) throw new Error("A circular name is required to build its archive page.");
  const canonicalUrl = `${SITE_URL}${archivePath}`;
  const title = `${name} DPSA Vacancies and Jobs | DPSA Government Jobs`;
  const description = `Browse ${jobs.length} current job ${jobs.length === 1 ? "vacancy" : "vacancies"} from ${name}. Check each department's official advert for requirements and application details.`;
  const itemList = {
    "@type": "ItemList",
    numberOfItems: jobs.length,
    itemListElement: jobs.map((job, index) => {
      const slug = encodeURIComponent(String(job.slug || job.id));
      const url = `${JOBS_PAGE_ORIGIN}/${slug}/`;
      return {
        "@type": "ListItem",
        position: index + 1,
        name: displayJobTitle(job.title),
        url
      };
    })
  };
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description,
    url: canonicalUrl,
    inLanguage: "en-ZA",
    mainEntity: itemList,
    isPartOf: {
      "@type": "WebSite",
      name: "DPSA Government Jobs",
      url: `${SITE_URL}/`
    }
  };
  const sourceUrl = jobs.find(job =>
    typeof job.sourceUrl === "string" && /^https:\/\/(?:www\.)?dpsa\.gov\.za\//i.test(job.sourceUrl)
  )?.sourceUrl;
  const jobsMarkup = renderJobListings(jobs, { includeCircularBadge: false });

  return `<!doctype html>
<html lang="en-ZA">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${canonicalUrl}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet">
  <link rel="preconnect" href="https://pagead2.googlesyndication.com" crossorigin>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3860151941190347" crossorigin="anonymous"></script>
  <link rel="stylesheet" href="/styles.css">
  <title>${escapeHtml(title)}</title>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="DPSA Government Jobs">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${canonicalUrl}">
  <script type="module" src="/redirects.js"></script>
  <script type="application/ld+json">${jsonLd(structuredData)}</script>
</head>
<body class="post-theme">
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header"><nav class="nav shell" aria-label="Main navigation">
    <a class="brand home-brand" href="/" aria-label="DPSA Government Jobs home"><img src="/south-african-flag.png" width="40" height="40" alt="" decoding="async"><span class="home-brand-copy"><span class="home-brand-title">DPSA</span><span class="home-brand-subtitle">Government Jobs</span></span></a>
    <div class="nav-links"><a href="/">Vacancies</a><details class="nav-dropdown"><summary>Circulars</summary><div class="nav-dropdown-menu"><a class="nav-dropdown-all" href="/dpsa-vacancy-circulars/">All circulars</a>${CIRCULAR_NAV_ITEMS}</div></details><a href="/#questions-heading">Contact</a></div>
  </nav></header>
  <main id="main">
    <div class="site-post">
    <section class="page-hero"><div class="shell">
      <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span> DPSA public service vacancy circular</p>
      <h1>${escapeHtml(name)} Jobs and Vacancies</h1>
      <p class="lead">Browse ${jobs.length} current ${jobs.length === 1 ? "vacancy" : "vacancies"} from ${escapeHtml(name)}. Each listing links to its job details; confirm requirements and closing dates in the hiring department's official advert.</p>
      ${sourceUrl ? `<a class="button" href="${escapeHtml(sourceUrl)}" rel="noopener noreferrer">Read the official circular</a>` : ""}
    </div></section>
    <section class="content-section"><div class="shell">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/dpsa-vacancy-circulars/">DPSA circulars</a> › ${escapeHtml(name)}</nav>
      <h2>Current jobs in ${escapeHtml(name)}</h2>
      <div class="listing-grid">${jobsMarkup}</div>
      <p class="independent-note">This is an independent vacancy guide. Verify every job with the official circular and the hiring department.</p>
    </div></section>
    </div>
  </main>
  ${renderSiteFooter()}
</body>
</html>`;
}

export function renderSitemapWithCircularArchives(
  source,
  circularGroups,
  lastmod = new Date().toISOString().slice(0, 10),
  provinceGroups = []
) {
  const generatedArchivePath = /^https:\/\/dpsagovernmentjobs\.co\.za\/(?:dpsa-vacancy-circulars\/circular-[a-z0-9-]+|government-vacancies\/[a-z0-9-]+)\/?$/;
  const currentSource = source.replace(/^[ \t]*<url>[\s\S]*?^[ \t]*<\/url>[ \t]*(?:\r?\n|$)/gm, entry => {
    const location = entry.match(/<loc>([^<]+)<\/loc>/)?.[1];
    return location && generatedArchivePath.test(location) ? "" : entry;
  });
  const closingTag = "</urlset>";
  const closingIndex = currentSource.lastIndexOf(closingTag);
  if (closingIndex < 0) throw new Error("Sitemap is missing its urlset closing tag.");
  const paths = [...circularGroups, ...provinceGroups].map(group => group.path);
  const entries = [...new Set(paths)].map(path =>
    `  <url>\n    <loc>${SITE_URL}${escapeHtml(path)}</loc>\n    <lastmod>${escapeHtml(lastmod)}</lastmod>\n  </url>`
  ).join("\n");
  if (!entries) return currentSource;
  return `${currentSource.slice(0, closingIndex).trimEnd()}\n${entries}\n${currentSource.slice(closingIndex)}`;
}

async function removeStaleGeneratedPages(directory, retainedSlugs, matchesGeneratedSlug) {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && matchesGeneratedSlug(entry.name) && !retainedSlugs.has(entry.name)) {
      await rm(path.join(directory, entry.name), { recursive: true, force: true });
    }
  }
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

  const validJobs = sortJobsByCircular(jobs.filter(isDisplayableJob));
  const circularGroups = groupJobsByCircular(validJobs);
  const provinceGroups = groupJobsByProvince(validJobs);
  let index = await readFile(path.join(ROOT, "index.html"), "utf8");
  const currentYear = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric"
  }).format(new Date());
  index = index.replace(/\{\{CURRENT_YEAR\}\}/g, currentYear);
  index = replaceMarkedContent(index, JOBS_START, JOBS_END, renderHomeJobListings(validJobs));
  index = replaceMarkedContent(
    index,
    JOBS_CONTINUATION_START,
    JOBS_CONTINUATION_END,
    renderHomeJobContinuation(validJobs)
  );
  index = replaceMarkedContent(
    index,
    JOBS_CONTINUATION_START,
    JOBS_CONTINUATION_END,
    renderHomeJobContinuation(validJobs)
  );
  index = replaceMarkedContent(index, COUNT_START, COUNT_END, `${validJobs.length} current ${validJobs.length === 1 ? "vacancy" : "vacancies"}`);
  index = replaceUniqueMarker(index, CIRCULAR_NAV_ITEMS, renderCircularNavigationItems(circularGroups));
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
  await buildBrowserBundle({
    entryPoints: {
      "cv-pdf-reader": path.join(ROOT, "scripts", "cv-pdf-reader.js"),
      "cv-docx-reader": path.join(ROOT, "scripts", "cv-docx-reader.js")
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    nodePaths: [path.join(ROOT, "extension", "node_modules")],
    outdir: output
  });
  await cp(
    path.join(ROOT, "extension", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"),
    path.join(output, "pdf.worker.min.mjs"),
    { force: true }
  );
  await mkdir(path.join(output, "scripts"), { recursive: true });
  await cp(path.join(ROOT, "scripts", "cv-matcher.js"), path.join(output, "scripts", "cv-matcher.js"), { force: true });
  await writeFile(path.join(output, "index.html"), index);
  const files = [
    "404.html", "CNAME", "ads.txt", "job-alert-terms.html", "jobs.json", "robots.txt", "sitemap.xml",
    "province-eastern-cape.png", "province-free-state.png", "province-gauteng.png",
    "province-kwazulu-natal.png", "province-limpopo.png", "province-mpumalanga.png",
    "province-north-west.png", "province-northern-cape.png", "province-western-cape.png",
    "circulars.js", "provinces.js", "redirects.js", "salary-scales.js", "south-african-coat-of-arms.png",
    "footer-facebook.svg", "footer-location.svg", "footer-pinterest.svg", "footer-x.svg",
    "south-african-flag.png", "styles.css", "vacancy-format.js"
  ];
  for (const file of files) {
    await cp(path.join(ROOT, file), path.join(output, file), { force: true });
  }
  const notFoundPath = path.join(output, "404.html");
  const notFoundPage = await readFile(notFoundPath, "utf8");
  await writeFile(notFoundPath, replaceUniqueMarker(notFoundPage, CIRCULAR_NAV_ITEMS, renderCircularNavigationItems(circularGroups)));
  for (const directory of ["dpsa-vacancy-circulars", "government-vacancies", "how-to-apply", "national-treasury-salary-scales"]) {
    await cp(path.join(ROOT, directory), path.join(output, directory), { recursive: true, force: true });
  }

  const circularHubPath = path.join(output, "dpsa-vacancy-circulars", "index.html");
  let circularHub = await readFile(circularHubPath, "utf8");
  circularHub = replaceMarkedContent(
    circularHub,
    CIRCULAR_ARCHIVES_START,
    CIRCULAR_ARCHIVES_END,
    renderCircularArchiveLinks(circularGroups)
  );
  circularHub = replaceMarkedContent(
    circularHub,
    PAST_CIRCULARS_START,
    PAST_CIRCULARS_END,
    renderPastCircularArchiveLinks()
  );
  circularHub = replaceUniqueMarker(circularHub, CIRCULAR_NAV_ITEMS, renderCircularNavigationItems(circularGroups));
  await writeFile(circularHubPath, circularHub);

  const provinceHubPath = path.join(output, "government-vacancies", "index.html");
  let provinceHub = await readFile(provinceHubPath, "utf8");
  provinceHub = replaceMarkedContent(
    provinceHub,
    PROVINCE_GUIDES_START,
    PROVINCE_GUIDES_END,
    renderProvinceGuideLinks(provinceGroups)
  );
  provinceHub = replaceUniqueMarker(provinceHub, CIRCULAR_NAV_ITEMS, renderCircularNavigationItems(circularGroups));
  await writeFile(provinceHubPath, provinceHub);

  for (const directory of ["how-to-apply", "national-treasury-salary-scales"]) {
    const pagePath = path.join(output, directory, "index.html");
    const page = await readFile(pagePath, "utf8");
    await writeFile(pagePath, replaceUniqueMarker(page, CIRCULAR_NAV_ITEMS, renderCircularNavigationItems(circularGroups)));
  }

  const circularArchiveRoot = path.join(output, "dpsa-vacancy-circulars");
  const currentCircularSlugs = new Set(circularGroups.map(group => group.path.split("/").filter(Boolean).at(-1)));
  await removeStaleGeneratedPages(circularArchiveRoot, currentCircularSlugs, slug => /^circular-[a-z0-9-]+$/i.test(slug));

  for (const group of circularGroups) {
    const slug = group.path.split("/").filter(Boolean).at(-1);
    const archiveDirectory = path.join(output, "dpsa-vacancy-circulars", slug);
    await mkdir(archiveDirectory, { recursive: true });
    const page = renderCircularArchivePage(group.name, group.jobs);
    await writeFile(path.join(archiveDirectory, "index.html"), replaceUniqueMarker(page, CIRCULAR_NAV_ITEMS, renderCircularNavigationItems(circularGroups)));
  }

  const provinceArchiveRoot = path.join(output, "government-vacancies");
  const currentProvinceSlugs = new Set(provinceGroups.map(group => group.path.split("/").filter(Boolean).at(-1)));
  const provinceSlugs = new Set(SOUTH_AFRICAN_PROVINCES.map(name => provincePath(name).split("/").filter(Boolean).at(-1)));
  await removeStaleGeneratedPages(provinceArchiveRoot, currentProvinceSlugs, slug => provinceSlugs.has(slug));

  for (const group of provinceGroups) {
    const slug = group.path.split("/").filter(Boolean).at(-1);
    const provinceDirectory = path.join(output, "government-vacancies", slug);
    await mkdir(provinceDirectory, { recursive: true });
    const page = renderProvinceLandingPage(group.name, group.jobs);
    await writeFile(path.join(provinceDirectory, "index.html"), replaceUniqueMarker(page, CIRCULAR_NAV_ITEMS, renderCircularNavigationItems(circularGroups)));
  }

  const sitemapPath = path.join(output, "sitemap.xml");
  const sitemap = await readFile(sitemapPath, "utf8");
  await writeFile(sitemapPath, renderSitemapWithCircularArchives(sitemap, circularGroups, new Date().toISOString().slice(0, 10), provinceGroups));
  console.log(`Built homepage with ${validJobs.length} listings, ${circularGroups.length} circular archives and ${provinceGroups.length} province guides.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await buildSite();
}

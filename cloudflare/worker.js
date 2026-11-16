import defaultJobs from "../jobs.json" with { type: "json" };

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
const GENERIC_EMPLOYERS = new Set(["south african public service", "hiring department not identified", "department not specified"]);
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

function isKnownEmployer(job) {
  const company = String(job.company ?? "").trim();
  return Boolean(company) && !GENERIC_EMPLOYERS.has(company.toLowerCase());
}

function jobPagePath(job) {
  return `/jobs/${encodeURIComponent(String(job.id))}/`;
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

function schemaLocality(job) {
  const centre = String(job.centre || job.location || "").trim();
  const locality = centre.split(/[,\n:]/).map(part => part.trim()).filter(Boolean).at(-1) ?? "";
  if (!locality || /^\d+$/.test(locality) || locality.toLowerCase() === String(job.province ?? "").trim().toLowerCase()) return "";
  if (/^(?:south africa|national head office|provincial (?:office|service centre)|central office|labour|department of labour)$/i.test(locality)) return "";
  return locality;
}

function schemaForJob(job, pageUrl) {
  const datePosted = parseSouthAfricanDate(job.circularDate || "", false);
  const validThrough = getClosingDate(job);
  const province = String(job.province ?? "").trim();
  const locality = schemaLocality(job);
  const description = detailSections(job).map(([label, value]) => `${label}: ${value}`).join("\n\n");
  if (!isKnownEmployer(job) || !datePosted || !validThrough || !province || !locality || description.length < 100 || !job.sourceUrl) return null;

  const employmentTypes = {
    "full-time": "FULL_TIME",
    "part-time": "PART_TIME",
    contract: "CONTRACTOR",
    "fixed-term": "CONTRACTOR",
    temporary: "TEMPORARY",
    internship: "INTERN"
  };
  const employmentType = employmentTypes[String(job.type ?? "").toLowerCase()];
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: displayJobTitle(job.title),
    description: description.replace(/\r?\n/g, "<br>"),
    datePosted,
    validThrough,
    hiringOrganization: { "@type": "Organization", name: String(job.company).trim() },
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: locality,
        addressRegion: province,
        addressCountry: "ZA"
      }
    },
    identifier: {
      "@type": "PropertyValue",
      name: String(job.company).trim(),
      value: String(job.refNo || job.postNo || job.id)
    },
    url: pageUrl,
    directApply: false,
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
  const employer = isKnownEmployer(job) ? String(job.company).trim() : "Check the official advert";
  const location = [job.centre, job.province, job.location]
    .map(value => String(value ?? "").trim())
    .find(value => value && !/^(?:south africa|labour|department of labour)$/i.test(value));
  const deadline = String(job.closingDate ?? "").trim() || "Not stated; check the official advert";
  const description = detailSections(job).map(([, value]) => value).join(" ").replace(/\s+/g, " ").trim();
  const metaDescription = (description || `${title} vacancy in ${location || "South Africa"}. Check the official advert for requirements and application details.`)
    .slice(0, 155);
  const sections = detailSections(job).map(([label, value]) =>
    `<section><h2>${escapeHtml(label)}</h2><p>${escapeHtml(value).replace(/\r?\n/g, "<br>")}</p></section>`
  ).join("");
  const schema = schemaForJob(job, pageUrl);
  const schemaMarkup = schema ? `<script type="application/ld+json">${jsonLdScript(schema)}</script>` : "";
  const circularInfo = [job.circularName, job.circularPage ? `page ${job.circularPage}` : ""].filter(Boolean).join(", ");
  const sourceLink = typeof job.sourceUrl === "string" && /^https:\/\//i.test(job.sourceUrl)
    ? `<p><a href="${escapeHtml(job.sourceUrl)}" rel="noopener noreferrer">Read the official vacancy advert or circular</a></p>`
    : "";
  const reference = [job.refNo && `Reference: ${job.refNo}`, job.postNo && `Post number: ${job.postNo}`].filter(Boolean).join(" · ");

  return htmlResponse(`<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | DPSA Government Jobs</title><meta name="description" content="${escapeHtml(metaDescription)}">
<meta name="robots" content="index, follow"><link rel="canonical" href="${escapeHtml(pageUrl)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="DPSA Government Jobs">
<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(metaDescription)}">
<meta property="og:url" content="${escapeHtml(pageUrl)}">${schemaMarkup}
<style>body{font:16px/1.65 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:24px;color:#17233b}a{color:#17499e}header,footer{padding:16px 0;border-bottom:1px solid #dce3ed}main{padding:24px 0}h1{line-height:1.2}h2{font-size:1.15rem;margin-bottom:.3rem}.meta{color:#475569}.apply{display:inline-block;background:#17499e;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none}section{margin:28px 0}footer{border-top:1px solid #dce3ed;border-bottom:0}</style></head>
<body><header><a href="${SITE_URL}/">DPSA Government Jobs</a></header><main>
<nav aria-label="Breadcrumb"><a href="${SITE_URL}/">Home</a> › <a href="${escapeHtml(new URL("/jobs/", requestUrl.origin).href)}">Vacancies</a> › ${escapeHtml(title)}</nav>
<article><h1>${escapeHtml(title)}</h1><p class="meta"><strong>Hiring department:</strong> ${escapeHtml(employer)}</p>
${location ? `<p class="meta"><strong>Location/centre in advert:</strong> ${escapeHtml(location)}</p>` : ""}
<p class="meta"><strong>Employment type:</strong> ${escapeHtml(job.type)}</p>
<p class="meta"><strong>Salary:</strong> ${escapeHtml(job.salaryText || "Not stated in advert")}</p>
<p class="meta"><strong>Closing date:</strong> ${escapeHtml(deadline)}</p>
${reference ? `<p class="meta">${escapeHtml(reference)}</p>` : ""}
${circularInfo ? `<p class="meta">Published in ${escapeHtml(circularInfo)}${job.circularDate ? ` · ${escapeHtml(job.circularDate)}` : ""}</p>` : ""}
${sourceLink}${sections}<p><strong>Important:</strong> Confirm the department, eligibility, closing date and submission instructions in the official advert.</p>
${sourceLink ? `<p><a class="apply" href="${escapeHtml(job.sourceUrl)}" rel="noopener noreferrer">View official advert</a></p>` : ""}
</article></main><footer><a href="${SITE_URL}/">DPSA Government Jobs</a> is an independent guide. Always verify vacancy details with the hiring department.</footer></body></html>`);
}

function jobsIndexPage(jobs, requestUrl) {
  const activeJobs = jobs.filter(job => !isExpired(job));
  const links = activeJobs.map(job => {
    const title = displayJobTitle(job.title);
    const employer = isKnownEmployer(job) ? String(job.company).trim() : "Hiring department: see official advert";
    return `<li><a href="${escapeHtml(new URL(jobPagePath(job), requestUrl.origin).href)}">${escapeHtml(title)}</a> — ${escapeHtml(employer)}${job.closingDate ? ` · Closes ${escapeHtml(job.closingDate)}` : ""}</li>`;
  }).join("");
  const canonical = new URL("/jobs/", requestUrl.origin).href;
  return htmlResponse(`<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Current Government Vacancies in South Africa | DPSA Government Jobs</title>
<meta name="description" content="Browse current South African public service vacancies, official advert links, requirements and closing dates.">
<link rel="canonical" href="${escapeHtml(canonical)}"><meta name="robots" content="index, follow"></head><body>
<header><a href="${SITE_URL}/">DPSA Government Jobs</a></header><main><h1>Current South African Government Vacancies</h1>
<p>Vacancy details are summarised for convenience. Confirm all information with the official advert.</p>
<ul>${links || "<li>No current vacancies are available. Please check back later.</li>"}</ul>
<p><a href="${SITE_URL}/">Visit DPSA Government Jobs</a></p></main></body></html>`);
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
      return new Response(`User-agent: *\nAllow: /jobs/\nSitemap: ${url.origin}/sitemap.xml\n`, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" }
      });
    }

    if (url.pathname === "/api/jobs" && request.method === "OPTIONS") return jsonResponse({}, 204);

    if (request.method === "GET") {
      const savedJobs = await env.JOBS.get(JOBS_KEY, "json");
      const jobs = savedJobs ?? defaultJobs;
      if (url.pathname === "/sitemap.xml") return sitemapResponse(jobs, url);
      if (url.pathname === "/jobs" || url.pathname === "/jobs/") return jobsIndexPage(jobs, url);
      const jobPath = url.pathname.match(/^\/jobs\/([^/]+)\/?$/);
      if (jobPath) {
        let jobId;
        try {
          jobId = decodeURIComponent(jobPath[1]);
        } catch {
          return htmlResponse("<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>Vacancy not found.</body></html>", 404, "noindex");
        }
        const job = jobs.find(candidate => candidate.id === jobId);
        if (!job) return htmlResponse("<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>Vacancy not found.</body></html>", 404, "noindex");
        if (isExpired(job)) return htmlResponse("<!doctype html><html><head><meta name=\"robots\" content=\"noindex\"></head><body>This vacancy has closed. Check the official advert for current opportunities.</body></html>", 410, "noindex");
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
      return jsonResponse(jobs.filter(job => !isExpired(job)));
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

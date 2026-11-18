import { canonicalCircularName, compareCircularNames, retainLatestCircularJobs, sortJobsByCircular } from "../circulars.js";
import { EMPLOYMENT_TYPE_CATEGORIES, employmentTypeCategory } from "../employment-type.js";
import { downloadDpsaPdf, extractPdfText, parseDpsaCircular } from "../extension/importer.js";
import { createPublishedVacancy, sanitizePublishedJob } from "../extension/publication.js";
import { appendFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DPSA_ROOT = "https://www.dpsa.gov.za";
const DPSA_CIRCULARS_URL = `${DPSA_ROOT}/newsroom/psvc/`;
const DEFAULT_API_URL = "https://goodwork-jobs-api.dpsajobs.workers.dev/api/jobs";
const MAX_PUBLISHED_JOBS = 6000;
const STANDARD_FONT_DATA_URL = `${resolve(dirname(fileURLToPath(import.meta.url)), "../extension/node_modules/pdfjs-dist/standard_fonts")}${sep}`;

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f\d]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const hrefMatch = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const href = decodeHtml(hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3]);
    const label = decodeHtml(match[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    try {
      anchors.push({ url: new URL(href, baseUrl), label });
    } catch {
      continue;
    }
  }
  return anchors;
}

export function extractCircularPages(html, baseUrl = DPSA_CIRCULARS_URL) {
  const circularPages = new Map();
  for (const { url } of extractAnchors(html, baseUrl)) {
    if (!["www.dpsa.gov.za", "dpsa.gov.za"].includes(url.hostname)) continue;
    const match = url.pathname.match(/^\/newsroom\/psvc\/circular-(\d+)-of-(20\d{2})\/?$/i);
    if (!match) continue;
    const number = Number(match[1]);
    const year = Number(match[2]);
    circularPages.set(`${year}-${number}`, {
      circularName: canonicalCircularName(`Circular ${number} of ${year}`),
      number,
      year,
      url: url.href
    });
  }
  return [...circularPages.values()]
    .sort((left, right) => compareCircularNames(right.circularName, left.circularName))
    .slice(0, 5);
}

export function selectNewerCirculars(candidates, publishedJobs) {
  const publishedNames = [...new Set(publishedJobs
    .map(job => canonicalCircularName(job.circularName))
    .filter(name => /^Circular \d+ of 20\d{2}$/.test(name)))];
  const latestPublished = publishedNames.sort(compareCircularNames).at(-1);
  if (!latestPublished) return candidates.slice(0, 1);

  return candidates.filter(circular =>
    !publishedNames.includes(circular.circularName) &&
    compareCircularNames(circular.circularName, latestPublished) > 0
  );
}

export function countPublishedEmploymentTypes(jobs) {
  const counts = Object.fromEntries(EMPLOYMENT_TYPE_CATEGORIES.map(category => [category, 0]));
  for (const job of jobs) {
    const category = employmentTypeCategory(job);
    if (category) counts[category] += 1;
  }
  return counts;
}

function extractPageText(html) {
  return decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function isDpsaPdf(url) {
  return url.protocol === "https:" &&
    ["www.dpsa.gov.za", "dpsa.gov.za"].includes(url.hostname) &&
    url.pathname.toLowerCase().endsWith(".pdf");
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, {
    cache: "no-store",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-ZA,en;q=0.9"
    },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`DPSA request failed with HTTP ${response.status}: ${url}`);
  const responseUrl = new URL(response.url || url);
  if (!["www.dpsa.gov.za", "dpsa.gov.za"].includes(responseUrl.hostname)) {
    throw new Error("The DPSA website redirected to an untrusted host.");
  }
  return { html: await response.text(), url: responseUrl.href };
}

export async function discoverCircularPdfs(fetchImpl = fetch) {
  const { html, url: pageUrl } = await fetchText(DPSA_CIRCULARS_URL, fetchImpl);
  const pages = extractCircularPages(html, pageUrl);
  if (!pages.length) throw new Error("No circular archive pages were found on the DPSA website.");

  const circulars = [];
  for (const page of pages) {
    const { html: pageHtml, url: resolvedPageUrl } = await fetchText(page.url, fetchImpl);
    const pageText = extractPageText(pageHtml);
    const publishedDate = pageText.match(/\bPosting\s+Date\s*:\s*(\d{1,2}\s+[A-Z]+\s+20\d{2})\b/i)?.[1] ?? "";
    const pdfs = extractAnchors(pageHtml, resolvedPageUrl)
      .filter(({ url }) => isDpsaPdf(url))
      .map(({ url, label }) => ({ url: url.href, path: decodeURIComponent(url.pathname), label }));
    const pdf = pdfs.find(candidate => /(?:^|\/)PSV\s+CIRCULAR\s+\d+\s+of\s+20\d{2}\.pdf$/i.test(candidate.path))
      ?? pdfs.find(candidate => /full document/i.test(candidate.label) && /circular/i.test(candidate.label));
    if (!pdf) {
      throw new Error(`${page.circularName}: the full circular PDF was not linked.`);
    }
    circulars.push({
      circularName: page.circularName,
      publishedDate,
      pageUrl: resolvedPageUrl,
      pdfUrl: pdf.url
    });
  }
  return circulars;
}

async function readPublishedJobs(apiUrl, token, fetchImpl) {
  const response = await fetchImpl(apiUrl, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Could not load published jobs (HTTP ${response.status}).`);
  const jobs = await response.json();
  if (!Array.isArray(jobs)) throw new Error("The Worker returned an invalid job list.");
  return jobs;
}

async function requestAutomationApi(apiUrl, token, path, fetchImpl, options = {}) {
  const endpoint = new URL(apiUrl);
  endpoint.pathname = `/api/automation/${path}`;
  endpoint.search = "";
  endpoint.hash = "";
  const response = await fetchImpl(endpoint, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    },
    cache: "no-store"
  });
  if (!response.ok) {
    let message = `Automation service returned HTTP ${response.status}.`;
    try {
      const result = await response.json();
      if (typeof result.error === "string") message = result.error;
    } catch {
      // Keep the HTTP status when the service does not return JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

export async function readAutomationEnabled(apiUrl, token, fetchImpl = fetch) {
  const result = await requestAutomationApi(apiUrl, token, "settings", fetchImpl);
  if (typeof result?.enabled !== "boolean") {
    throw new Error("The Worker returned invalid auto-publish settings.");
  }
  return result.enabled;
}

export async function recordAutoPublishedCirculars(apiUrl, token, publications, fetchImpl = fetch) {
  const result = await requestAutomationApi(apiUrl, token, "publications", fetchImpl, {
    method: "POST",
    body: JSON.stringify({ publications })
  });
  if (result?.success !== true || !Array.isArray(result.publications)) {
    throw new Error("The Worker returned an invalid auto-publish history result.");
  }
  return result.publications;
}

function validateCircular(circular, result, text) {
  if (canonicalCircularName(result.circular.name) !== circular.circularName) {
    throw new Error(`${circular.circularName}: the PDF title does not match the DPSA archive page.`);
  }
  if (!result.vacancies.length) {
    throw new Error(`${circular.circularName}: no vacancies could be extracted; nothing was published.`);
  }
  const postCount = [...text.matchAll(/\bPOST\s+[A-Z0-9][A-Z0-9/\-]{0,40}\s*:/gi)].length;
  if (postCount && result.vacancies.length < Math.ceil(postCount * 0.75)) {
    throw new Error(`${circular.circularName}: only ${result.vacancies.length} of ${postCount} post sections parsed; publishing was stopped.`);
  }
  const seenIds = new Set();
  for (const vacancy of result.vacancies) {
    if (!vacancy.id || !vacancy.title || !vacancy.postNo || seenIds.has(vacancy.id)) {
      throw new Error(`${circular.circularName}: extracted vacancy data is incomplete or duplicated; publishing was stopped.`);
    }
    seenIds.add(vacancy.id);
  }
}

async function publishJobs(apiUrl, token, jobs, fetchImpl) {
  const response = await fetchImpl(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(jobs.map(sanitizePublishedJob))
  });
  if (!response.ok) {
    let message = `Could not publish jobs (HTTP ${response.status}).`;
    try {
      const result = await response.json();
      if (typeof result.error === "string") message = result.error;
    } catch {
      // Keep the HTTP status when the Worker does not return JSON.
    }
    throw new Error(message);
  }
  const result = await response.json();
  if (result?.success !== true || !Array.isArray(result.removedJobIds)) {
    throw new Error("The Worker returned an invalid publish result.");
  }
  return result;
}

export async function runAutomation({
  apiUrl = process.env.WORKER_API_URL || DEFAULT_API_URL,
  token = process.env.WORKER_ADMIN_TOKEN,
  fetchImpl = fetch
} = {}) {
  if (!token) throw new Error("The WORKER_ADMIN_TOKEN secret is not configured.");
  if (!await readAutomationEnabled(apiUrl, token, fetchImpl)) {
    console.log("Auto-publishing is disabled in the Chrome extension.");
    return { enabled: false, publishedCirculars: [], vacancyCount: 0 };
  }
  const candidates = await discoverCircularPdfs(fetchImpl);
  const currentJobs = await readPublishedJobs(apiUrl, token, fetchImpl);
  const newCirculars = selectNewerCirculars(candidates, currentJobs);
  if (!newCirculars.length) {
    console.log("No new DPSA circulars to publish.");
    return { publishedCirculars: [], vacancyCount: 0 };
  }

  const importedJobs = [];
  for (const circular of newCirculars) {
    const { file, url } = await downloadDpsaPdf(circular.pdfUrl);
    const { text, links } = await extractPdfText(file, { standardFontDataUrl: STANDARD_FONT_DATA_URL });
    const result = parseDpsaCircular(text, {
      fileName: file.name,
      sourceUrl: url,
      links
    });
    validateCircular(circular, result, text);
    importedJobs.push(...result.vacancies.map(vacancy => ({
      ...createPublishedVacancy(vacancy),
      circularName: circular.circularName,
      circularDate: circular.publishedDate || result.circular.date,
      sourceUrl: url
    })));
    console.log(`${circular.circularName}: parsed ${result.vacancies.length} vacancies.`);
  }

  const currentIds = new Set(currentJobs.map(job => job.id));
  const combinedJobs = [
    ...currentJobs,
    ...importedJobs.filter(job => !currentIds.has(job.id))
  ];
  const retained = retainLatestCircularJobs(sortJobsByCircular(combinedJobs));
  if (retained.jobs.length > MAX_PUBLISHED_JOBS) {
    throw new Error(`Publishing would exceed the ${MAX_PUBLISHED_JOBS}-job limit.`);
  }

  if (!await readAutomationEnabled(apiUrl, token, fetchImpl)) {
    console.log("Auto-publishing was disabled before publication; no changes were sent.");
    return { enabled: false, publishedCirculars: [], vacancyCount: 0 };
  }
  await publishJobs(apiUrl, token, retained.jobs, fetchImpl);
  const publishedAt = new Date().toISOString();
  const jobCounts = new Map();
  for (const job of importedJobs) {
    jobCounts.set(job.circularName, (jobCounts.get(job.circularName) ?? 0) + 1);
  }
  const employmentTypeCounts = countPublishedEmploymentTypes(importedJobs);
  await recordAutoPublishedCirculars(apiUrl, token, newCirculars.map(circular => ({
    circularName: circular.circularName,
    publishedAt,
    jobCount: jobCounts.get(circular.circularName) ?? 0
  })), fetchImpl);
  return {
    enabled: true,
    publishedCirculars: newCirculars.map(circular => circular.circularName),
    publishedAt,
    vacancyCount: importedJobs.length,
    employmentTypeCounts,
    removedCirculars: retained.removedCircularNames
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAutomation()
    .then(async result => {
      if (!result.enabled) return;
      console.log(`Automation finished: ${result.vacancyCount} vacancies published.`);
      if (result.publishedCirculars.length && process.env.GITHUB_OUTPUT) {
        await appendFile(process.env.GITHUB_OUTPUT, [
          "published=true",
          `circulars=${result.publishedCirculars.join(", ")}`,
          `vacancy_count=${result.vacancyCount}`,
          `published_at=${result.publishedAt}`,
          `permanent_count=${result.employmentTypeCounts.Permanent}`,
          `contract_count=${result.employmentTypeCounts.Contract}`,
          `sessional_count=${result.employmentTypeCounts.Sessional}`,
          `internship_count=${result.employmentTypeCounts.Internship}`
        ].join("\n") + "\n");
      }
    })
    .catch(error => {
      console.error(`DPSA auto-publishing failed: ${error.message}`);
      process.exitCode = 1;
    });
}

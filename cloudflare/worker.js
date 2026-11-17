import defaultJobs from "../jobs.json" with { type: "json" };
import {
  cleanSalaryText,
  cleanVacancyLocation,
  cleanVacancyRequirements,
  cleanVacancyTitle,
  trimCircularAnnexureContent,
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
import { displayEmploymentType, employmentTypeCategory } from "../employment-type.js";
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
const ALERTS_SUBSCRIBER_PREFIX = "job-alerts:subscriber:";
const ALERTS_VERIFY_PREFIX = "job-alerts:verify:";
const ALERTS_UNSUBSCRIBE_PREFIX = "job-alerts:unsubscribe:";
const ALERTS_RATE_PREFIX = "job-alerts:signup-rate:";
const CV_MATCH_RATE_PREFIX = "cv-matches:rate:";
const CATEGORIES = new Set([
  "Administration", "Education", "Finance", "Health", "Law Enforcement", "Other",
  "Design", "Engineering", "Marketing", "Product"
]);
const TYPES = new Set([
  "Permanent", "Fixed-term", "Temporary",
  "Full-time", "Part-time", "Contract", "Sessional", "Internship", "Seasonal"
]);
const MAX_JOBS = 6000;
const MAX_JOBS_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 160;
const SITE_URL = "https://dpsagovernmentjobs.co.za";
const WORKER_SITE_URL = "https://jobs.dpsagovernmentjobs.co.za";
const ALERTS_ALLOWED_ORIGINS = new Set([SITE_URL, "https://www.dpsagovernmentjobs.co.za"]);
const ALERTS_CONFIRMATION_TTL = 24 * 60 * 60;
const ALERTS_RESEND_COOLDOWN = 15 * 60 * 1000;
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

function alertsJsonResponse(body, status = 200, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (ALERTS_ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function alertPage(title, message) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><body style="font:16px/1.6 Arial,sans-serif;max-width:640px;margin:12vh auto;padding:24px;color:#26364b"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="${SITE_URL}/">Return to DPSA Government Jobs</a></p></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function randomAlertToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function hashAlertValue(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.toLowerCase()));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function alertSignupRateLimited(request, env, prefix = ALERTS_RATE_PREFIX) {
  const address = request.headers.get("CF-Connecting-IP");
  if (!address) return false;
  const hour = Math.floor(Date.now() / 3600000);
  const key = `${prefix}${hour}:${await hashAlertValue(address)}`;
  const attempts = Number(await env.JOBS.get(key));
  if (attempts >= 5) return true;
  await env.JOBS.put(key, String(attempts + 1), { expirationTtl: 3600 });
  return false;
}

async function recordCvMatch(request, env) {
  const origin = request.headers.get("Origin") ?? "";
  if (!ALERTS_ALLOWED_ORIGINS.has(origin)) {
    return alertsJsonResponse({ error: "This CV matching request is not allowed." }, 403, origin);
  }
  if (!env.SHEETS_WEBHOOK_URL || !env.SHEETS_WEBHOOK_SECRET) {
    return alertsJsonResponse({ error: "CV matching is temporarily unavailable." }, 503, origin);
  }
  if (await alertSignupRateLimited(request, env, CV_MATCH_RATE_PREFIX)) {
    return alertsJsonResponse({ error: "Too many CV matching requests. Please try again later." }, 429, origin);
  }

  let input;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 500000) {
      return alertsJsonResponse({ error: "The CV text is too large to record." }, 413, origin);
    }
    input = JSON.parse(body);
  } catch {
    return alertsJsonResponse({ error: "Request body must be valid JSON." }, 400, origin);
  }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(field => !["name", "email", "province", "department", "cvText", "sheetConsent"].includes(field))) {
    return alertsJsonResponse({ error: "CV matching details are invalid." }, 400, origin);
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const requestedProvince = typeof input.province === "string" ? input.province.trim() : "all";
  const province = requestedProvince === "all" ? "all" : normalizeProvince(requestedProvince);
  const department = typeof input.department === "string" ? input.department.trim() : "";
  const cvText = typeof input.cvText === "string" ? input.cvText.trim() : "";
  if (!name || name.length > 120 || !validAlertEmail(email) || !province ||
      department.length > 160 || cvText.length < 60 || cvText.length > 120000 ||
      typeof input.sheetConsent !== "boolean" || !input.sheetConsent) {
    return alertsJsonResponse({ error: "Enter valid contact and preference details, provide readable CV text, and confirm spreadsheet consent." }, 400, origin);
  }

  const consentedAt = new Date().toISOString();
  try {
    await writeSheetRecord(env, {
      action: "append",
      recordType: "cv_match",
      recordId: `cv:${randomAlertToken()}`,
      name,
      email,
      province,
      department: department || "all",
      status: "recorded",
      cvText,
      consentedAt,
      updatedAt: consentedAt
    });
  } catch (error) {
    console.error("Could not record a CV match in Google Sheets.", error);
    return alertsJsonResponse({ error: "We could not record your CV details. Please try again later." }, 502, origin);
  }
  return alertsJsonResponse({ success: true }, 200, origin);
}

function validAlertToken(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validAlertEmail(value) {
  return typeof value === "string" && value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sendResendEmail(env, message) {
  if (!env.RESEND_API_KEY || !env.ALERTS_FROM_EMAIL) {
    throw new Error("Email alerts require RESEND_API_KEY and ALERTS_FROM_EMAIL.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: env.ALERTS_FROM_EMAIL, ...message })
  });
  if (!response.ok) {
    console.error(`Resend email request failed with HTTP ${response.status}.`);
    throw new Error(`Resend email request failed with HTTP ${response.status}.`);
  }
}

async function writeSheetRecord(env, record) {
  if (!env.SHEETS_WEBHOOK_URL || !env.SHEETS_WEBHOOK_SECRET) {
    throw new Error("Google Sheets recording is not configured.");
  }
  const response = await fetch(env.SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...record, secret: env.SHEETS_WEBHOOK_SECRET })
  });
  if (!response.ok) throw new Error(`Google Sheets webhook failed with HTTP ${response.status}.`);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Google Sheets webhook returned an invalid response.");
  }
  if (result?.success !== true) throw new Error("Google Sheets webhook did not confirm the record.");
}

function alertPreferenceMatches(subscriber, job) {
  const province = normalizeProvince(job.province) || "National";
  if (subscriber.province !== "all" && subscriber.province !== province) return false;
  if (subscriber.department === "all") return true;
  return String(job.company ?? "").trim().toLowerCase() === subscriber.department.toLowerCase();
}

async function sendNewJobAlerts(env, jobs) {
  if (!jobs.length) return;
  const subscriberKeys = [];
  let cursor;
  do {
    const page = await env.JOBS.list({ prefix: ALERTS_SUBSCRIBER_PREFIX, cursor, limit: 500 });
    subscriberKeys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  if (!subscriberKeys.length) return;
  if (!env.RESEND_API_KEY || !env.ALERTS_FROM_EMAIL) {
    console.error("New job alerts were not sent because Resend is not configured.");
    return;
  }

  for (let index = 0; index < subscriberKeys.length; index += 5) {
    const keys = subscriberKeys.slice(index, index + 5);
    await Promise.all(keys.map(async ({ name }) => {
      const subscriber = await env.JOBS.get(name, "json");
      if (!subscriber || subscriber.status !== "confirmed") return;
      const matchingJobs = jobs.filter(job => alertPreferenceMatches(subscriber, job));
      if (!matchingJobs.length) return;

      const unsubscribeToken = await env.JOBS.get(`${ALERTS_UNSUBSCRIBE_PREFIX}${subscriber.unsubscribeToken}`);
      if (!unsubscribeToken) return;
      const unsubscribeUrl = new URL(`/api/alerts/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribeToken)}`, WORKER_SITE_URL).href;
      const displayedJobs = matchingJobs.slice(0, 20);
      const jobLines = displayedJobs.map(job => {
        const title = displayJobTitle(job.title);
        const link = new URL(jobPagePath(job), WORKER_SITE_URL).href;
        const details = [
          String(job.company ?? "").trim(),
          normalizeProvince(job.province) || "National",
          String(job.closingDate ?? "").trim() && `Closing date: ${String(job.closingDate).trim()}`
        ].filter(Boolean);
        return { title, link, details };
      });
      const subject = `${matchingJobs.length} new ${matchingJobs.length === 1 ? "vacancy matches" : "vacancies match"} your alert`;
      const text = [
        `Hello ${subscriber.name},`,
        "",
        "New government vacancies match your job alert preferences:",
        ...jobLines.flatMap(job => [`${job.title} — ${job.link}`, ...job.details.map(detail => `  ${detail}`), ""]),
        matchingJobs.length > displayedJobs.length ? `And ${matchingJobs.length - displayedJobs.length} more matching vacancies.` : "",
        "",
        `Unsubscribe: ${unsubscribeUrl}`
      ].filter(Boolean).join("\n");
      const html = `<p>Hello ${escapeHtml(subscriber.name)},</p><p>New government vacancies match your job alert preferences:</p><ul>${jobLines.map(job => `<li><a href="${escapeHtml(job.link)}">${escapeHtml(job.title)}</a><br>${job.details.map(detail => escapeHtml(detail)).join(" · ")}</li>`).join("")}</ul>${matchingJobs.length > displayedJobs.length ? `<p>And ${matchingJobs.length - displayedJobs.length} more matching vacancies.</p>` : ""}<p><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from job alerts</a></p>`;
      try {
        await sendResendEmail(env, {
          to: [subscriber.email],
          subject,
          text,
          html,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
          }
        });
      } catch (error) {
        console.error("Could not send a new-job alert.", error);
      }
    }));
  }
}

async function subscribeToJobAlerts(request, env) {
  const origin = request.headers.get("Origin") ?? "";
  if (!ALERTS_ALLOWED_ORIGINS.has(origin)) {
    return alertsJsonResponse({ error: "This signup request is not allowed." }, 403, origin);
  }
  if (await alertSignupRateLimited(request, env)) {
    return alertsJsonResponse({ error: "Too many signup attempts. Please try again later." }, 429, origin);
  }
  if (!env.RESEND_API_KEY || !env.ALERTS_FROM_EMAIL) {
    return alertsJsonResponse({ error: "Email alerts are temporarily unavailable." }, 503, origin);
  }
  if (!env.SHEETS_WEBHOOK_URL || !env.SHEETS_WEBHOOK_SECRET) {
    return alertsJsonResponse({ error: "Email alert registration is temporarily unavailable." }, 503, origin);
  }

  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return alertsJsonResponse({ error: "Signup details are too large." }, 413, origin);
  }

  let input;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 4096) {
      return alertsJsonResponse({ error: "Signup details are too large." }, 413, origin);
    }
    input = JSON.parse(body);
  } catch {
    return alertsJsonResponse({ error: "Request body must be valid JSON." }, 400, origin);
  }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some(field => !["name", "email", "province", "department", "consent", "sheetConsent"].includes(field))) {
    return alertsJsonResponse({ error: "Signup details are invalid." }, 400, origin);
  }

  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const requestedProvince = typeof input.province === "string" ? input.province.trim() : "all";
  const province = requestedProvince === "all" ? "all" : normalizeProvince(requestedProvince);
  const requestedDepartment = typeof input.department === "string" ? input.department.trim() : "all";
  if (!name || name.length > 120 || !validAlertEmail(email) || !province ||
      typeof input.consent !== "boolean" || !input.consent ||
      typeof input.sheetConsent !== "boolean" || !input.sheetConsent) {
    return alertsJsonResponse({ error: "Enter your name and valid email address, and confirm both email-alert and spreadsheet consent." }, 400, origin);
  }

  const jobs = await loadPublishedJobs(env);
  let department = "all";
  if (requestedDepartment !== "all") {
    department = jobs.find(job => String(job.company ?? "").trim().toLowerCase() === requestedDepartment.toLowerCase())?.company?.trim() ?? "";
    if (!department || GENERIC_EMPLOYERS.has(department.toLowerCase())) {
      return alertsJsonResponse({ error: "Choose a department from the current vacancy list or select all departments." }, 400, origin);
    }
  }

  const emailHash = await hashAlertValue(email);
  const subscriberKey = `${ALERTS_SUBSCRIBER_PREFIX}${emailHash}`;
  const existing = await env.JOBS.get(subscriberKey, "json");
  const existingSignupMessage = "Signup received. If confirmation is needed, check your inbox; confirmed alerts are already active. Unsubscribe first to change confirmed preferences.";
  if (existing?.status === "confirmed" ||
      (existing?.status === "pending" && Date.now() - existing.lastConfirmationSentAt < ALERTS_RESEND_COOLDOWN)) {
    try {
      await writeSheetRecord(env, {
        action: "upsert",
        recordType: "email_alert",
        recordId: `alert:${emailHash}`,
        name: existing.name,
        email: existing.email,
        province: existing.province,
        department: existing.department,
        status: existing.status,
        consentedAt: existing.consentedAt,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Could not sync an existing email-alert signup to Google Sheets.", error);
      return alertsJsonResponse({ error: "We could not update your signup record. Please try again later." }, 502, origin);
    }
    return alertsJsonResponse({ success: true, message: existingSignupMessage }, 202, origin);
  }

  const verificationToken = randomAlertToken();
  const unsubscribeToken = existing?.unsubscribeToken ?? randomAlertToken();
  const verificationKey = `${ALERTS_VERIFY_PREFIX}${verificationToken}`;
  const unsubscribeKey = `${ALERTS_UNSUBSCRIBE_PREFIX}${unsubscribeToken}`;
  if (existing?.verificationToken) {
    await env.JOBS.delete(`${ALERTS_VERIFY_PREFIX}${existing.verificationToken}`);
  }
  const subscriber = {
    name,
    email,
    province,
    department,
    status: "pending",
    unsubscribeToken,
    verificationToken,
    consentedAt: new Date().toISOString(),
    lastConfirmationSentAt: Date.now()
  };
  await env.JOBS.put(subscriberKey, JSON.stringify(subscriber), { expirationTtl: ALERTS_CONFIRMATION_TTL });
  await env.JOBS.put(verificationKey, emailHash, { expirationTtl: ALERTS_CONFIRMATION_TTL });
  await env.JOBS.put(unsubscribeKey, emailHash, { expirationTtl: ALERTS_CONFIRMATION_TTL });
  try {
    await writeSheetRecord(env, {
      action: "upsert",
      recordType: "email_alert",
      recordId: `alert:${emailHash}`,
      name,
      email,
      province,
      department,
      status: "pending",
      consentedAt: subscriber.consentedAt,
      updatedAt: subscriber.consentedAt
    });
  } catch (error) {
    console.error("Could not record an email-alert signup in Google Sheets.", error);
    await Promise.all([
      env.JOBS.delete(subscriberKey),
      env.JOBS.delete(verificationKey),
      env.JOBS.delete(unsubscribeKey)
    ]);
    return alertsJsonResponse({ error: "We could not record your signup. Please try again later." }, 502, origin);
  }

  const confirmationUrl = new URL(`/api/alerts/confirm?token=${verificationToken}`, WORKER_SITE_URL).href;
  try {
    await sendResendEmail(env, {
      to: [email],
      subject: "Confirm your DPSA Government Jobs alerts",
      text: `Hello ${name},\n\nConfirm your email address to receive new government vacancy alerts:\n${confirmationUrl}\n\nIf you did not request these alerts, you can ignore this email.`,
      html: `<p>Hello ${escapeHtml(name)},</p><p>Confirm your email address to receive new government vacancy alerts:</p><p><a href="${escapeHtml(confirmationUrl)}">Confirm my email address</a></p><p>If you did not request these alerts, you can ignore this email.</p>`
    });
  } catch {
    try {
      await writeSheetRecord(env, {
        action: "upsert",
        recordType: "email_alert",
        recordId: `alert:${emailHash}`,
        name,
        email,
        province,
        department,
        status: "confirmation_failed",
        consentedAt: subscriber.consentedAt,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Could not record the email-alert confirmation failure in Google Sheets.", error);
    }
    await Promise.all([
      env.JOBS.delete(subscriberKey),
      env.JOBS.delete(verificationKey),
      env.JOBS.delete(unsubscribeKey)
    ]);
    return alertsJsonResponse({ error: "We could not send a confirmation email. Please try again later." }, 502, origin);
  }

  return alertsJsonResponse({ success: true, message: "Check your inbox for a confirmation link. Alerts start after you confirm your email." }, 202, origin);
}

async function confirmJobAlerts(token, env) {
  if (!validAlertToken(token)) return alertPage("Invalid confirmation link", "This email confirmation link is invalid or has expired.");
  const verificationKey = `${ALERTS_VERIFY_PREFIX}${token}`;
  const emailHash = await env.JOBS.get(verificationKey);
  if (!emailHash) return alertPage("Confirmation link expired", "This email confirmation link is invalid or has expired.");
  const subscriberKey = `${ALERTS_SUBSCRIBER_PREFIX}${emailHash}`;
  const subscriber = await env.JOBS.get(subscriberKey, "json");
  if (!subscriber || subscriber.status !== "pending") {
    await env.JOBS.delete(verificationKey);
    return alertPage("Confirmation link expired", "This email confirmation link is invalid or has expired.");
  }
  subscriber.status = "confirmed";
  subscriber.confirmedAt = new Date().toISOString();
  delete subscriber.lastConfirmationSentAt;
  delete subscriber.verificationToken;
  await env.JOBS.put(subscriberKey, JSON.stringify(subscriber));
  await env.JOBS.put(`${ALERTS_UNSUBSCRIBE_PREFIX}${subscriber.unsubscribeToken}`, emailHash);
  await env.JOBS.delete(verificationKey);
  try {
    await writeSheetRecord(env, {
      action: "upsert",
      recordType: "email_alert",
      recordId: `alert:${emailHash}`,
      name: subscriber.name,
      email: subscriber.email,
      province: subscriber.province,
      department: subscriber.department,
      status: "confirmed",
      consentedAt: subscriber.consentedAt,
      updatedAt: subscriber.confirmedAt
    });
  } catch (error) {
    console.error("Could not update the email-alert confirmation in Google Sheets.", error);
    return alertPage("Email alerts confirmed", "Your email is confirmed and alerts are active, but the spreadsheet status could not be updated.");
  }
  return alertPage("Email alerts confirmed", "Your email is confirmed. We will notify you when matching new government vacancies are published.");
}

async function showAlertConfirmation(token, env, action) {
  if (!validAlertToken(token)) return alertPage("Invalid link", "This email alert link is invalid or has expired.");
  const key = action === "confirm"
    ? `${ALERTS_VERIFY_PREFIX}${token}`
    : `${ALERTS_UNSUBSCRIBE_PREFIX}${token}`;
  if (!await env.JOBS.get(key)) return alertPage("Link expired", "This email alert link is invalid or has expired.");
  const heading = action === "confirm" ? "Confirm your email alerts" : "Unsubscribe from email alerts";
  const button = action === "confirm" ? "Confirm email address" : "Unsubscribe";
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${heading}</title><body style="font:16px/1.6 Arial,sans-serif;max-width:640px;margin:12vh auto;padding:24px;color:#26364b"><h1>${heading}</h1><p>${action === "confirm" ? "Select confirm to start receiving new vacancy alerts." : "Select unsubscribe to stop receiving new vacancy alerts."}</p><form method="post" action="/api/alerts/${action}"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">${button}</button></form></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function unsubscribeFromJobAlerts(token, env) {
  if (!validAlertToken(token)) return alertPage("Invalid unsubscribe link", "This unsubscribe link is invalid or has expired.");
  const unsubscribeKey = `${ALERTS_UNSUBSCRIBE_PREFIX}${token}`;
  const emailHash = await env.JOBS.get(unsubscribeKey);
  if (!emailHash) return alertPage("Unsubscribe link expired", "This unsubscribe link is invalid or has expired.");
  const subscriber = await env.JOBS.get(`${ALERTS_SUBSCRIBER_PREFIX}${emailHash}`, "json");
  await env.JOBS.delete(`${ALERTS_SUBSCRIBER_PREFIX}${emailHash}`);
  await env.JOBS.delete(unsubscribeKey);
  if (subscriber) {
    try {
      await writeSheetRecord(env, {
        action: "upsert",
        recordType: "email_alert",
        recordId: `alert:${emailHash}`,
        name: subscriber.name,
        email: subscriber.email,
        province: subscriber.province,
        department: subscriber.department,
        status: "unsubscribed",
        consentedAt: subscriber.consentedAt,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Could not update the email-alert unsubscribe status in Google Sheets.", error);
      return alertPage("You are unsubscribed", "You will no longer receive new-job alerts. The spreadsheet status could not be updated; its record has not been deleted.");
    }
  }
  return alertPage("You are unsubscribed", "You will no longer receive new-job alerts at this email address.");
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
  let detailTextChanged = false;
  for (const sourceJob of jobs) {
    let job = sourceJob;
    for (const field of ["requirements", "duties", "jobPurpose", "skillsAndCompetencies", "enquiries", "applications", "note"]) {
      if (typeof job[field] !== "string") continue;
      const cleanValue = trimCircularAnnexureContent(job[field]);
      if (cleanValue === job[field]) continue;
      if (job === sourceJob) job = { ...sourceJob };
      job[field] = cleanValue;
      detailTextChanged = true;
    }
    (isExpired(job, now) ? expiredJobs : activeJobs).push(job);
  }
  const retained = retainLatestCircularJobs(activeJobs, MAX_ACTIVE_CIRCULARS);
  return {
    ...retained,
    removedJobIds: [...expiredJobs.map(job => job.id), ...retained.removedJobIds],
    removedExpiredCount: expiredJobs.length,
    changed: detailTextChanged || expiredJobs.length > 0 || retained.jobs.length !== activeJobs.length
  };
}

async function loadPublishedJobs(env) {
  const savedJobs = await env.JOBS.get(JOBS_KEY, "json");
  const sourceJobs = savedJobs ?? defaultJobs;
  const cleaned = prunePublishedJobs(sourceJobs);
  if (savedJobs && cleaned.changed) {
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

function addWebsiteSchema(html) {
  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "DPSA Government Jobs",
    url: `${SITE_URL}/`,
    description: "An independent guide to South African public service vacancy circulars and applications.",
    inLanguage: "en-ZA"
  };
  const markup = `<script id="website-structured-data" type="application/ld+json">${jsonLdScript(websiteSchema)}</script>`;
  return html.replace("</head>", `${markup}</head>`);
}

function openExternalLinksInNewTabs(html) {
  const internalHosts = new Set(["dpsagovernmentjobs.co.za", "www.dpsagovernmentjobs.co.za", "jobs.dpsagovernmentjobs.co.za"]);
  return html.replace(/<a\b[^>]*>/gi, anchor => {
    const href = anchor.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!href) return anchor;
    let url;
    try {
      url = new URL(href.replace(/&amp;/g, "&"), SITE_URL);
    } catch {
      return anchor;
    }
    if (!/^https?:$/.test(url.protocol) || internalHosts.has(url.hostname.toLowerCase())) return anchor;

    let updated = /\btarget\s*=/i.test(anchor)
      ? anchor.replace(/\btarget\s*=\s*(["']).*?\1/i, 'target="_blank"')
      : anchor.replace(/>$/, ' target="_blank">');
    const relMatch = updated.match(/\brel\s*=\s*(["'])(.*?)\1/i);
    if (!relMatch) return updated.replace(/>$/, ' rel="noopener noreferrer">');
    const relTokens = new Set(relMatch[2].split(/\s+/).filter(Boolean));
    relTokens.add("noopener");
    relTokens.add("noreferrer");
    return updated.replace(relMatch[0], `rel="${[...relTokens].join(" ")}"`);
  });
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
    const title = displayJobTitle(related.title);
    return `<article class="related-job-card">${bookmarkButtonMarkup(href, title)}<a class="related-job-link" href="${escapeHtml(href)}"><strong>${escapeHtml(title)}</strong><span>Province: ${escapeHtml(province)}</span></a></article>`;
  }).join("");
  return `<section class="related-jobs" aria-labelledby="related-jobs-heading"><h2 id="related-jobs-heading">Similar current vacancies</h2><div class="related-job-grid">${cards}</div></section>`;
}

function bookmarkButtonMarkup(url, title) {
  const safeTitle = escapeHtml(title);
  return `<button class="bookmark-button" type="button" data-bookmark-url="${escapeHtml(url)}" data-bookmark-title="${safeTitle}" aria-label="Save ${safeTitle} to saved vacancies" aria-pressed="false" title="Save vacancy"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-4-6 4V4.75Z"/></svg></button>`;
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
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return `<li>${escapeHtml(rawLabel)}${url && rawLabel !== url ? `: ${escapeHtml(url)}` : ""}</li>`;
    }
    if (!["http:", "https:", "mailto:", "tel:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
      return `<li>${escapeHtml(rawLabel)}${url && rawLabel !== url ? `: ${escapeHtml(url)}` : ""}</li>`;
    }
    const linkedUrl = `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
    if (!rawLabel || rawLabel === "Link" || rawLabel === url) return `<li>${linkedUrl}</li>`;
    const labelUrlIndex = rawLabel.toLowerCase().indexOf(url.toLowerCase());
    const label = labelUrlIndex < 0
      ? `${escapeHtml(rawLabel)}: ${linkedUrl}`
      : `${escapeHtml(rawLabel.slice(0, labelUrlIndex))}${linkedUrl}${escapeHtml(rawLabel.slice(labelUrlIndex + url.length))}`;
    return `<li>${label}</li>`;
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
  if (label === "How to apply") {
    return `<ul>${splitVacancyPoints(value).map(point => `<li>${linkifyText(point.text)}</li>`).join("")}</ul>`;
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
    sessional: "CONTRACTOR",
    "fixed-term": "CONTRACTOR",
    temporary: "TEMPORARY",
    internship: "INTERN",
    seasonal: "TEMPORARY"
  };
  const canonicalEmploymentType = employmentTypeCategory(job);
  const employmentType = employmentTypes[canonicalEmploymentType.toLowerCase()] ??
    employmentTypes[String(job.type ?? "").toLowerCase()];
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
  let pageContent = content;
  const iconLinks = [
    [`rel=["'][^"']*\\bicon\\b`, "favicon\\.ico", `<link rel="icon" type="image/x-icon" sizes="16x16 32x32 48x48" href="${SITE_URL}/favicon.ico">`],
    [`rel=["']shortcut icon["']`, "favicon\\.ico", `<link rel="shortcut icon" href="${SITE_URL}/favicon.ico">`],
    [`rel=["']apple-touch-icon["']`, "apple-touch-icon\\.png", `<link rel="apple-touch-icon" sizes="180x180" href="${SITE_URL}/apple-touch-icon.png">`]
  ];
  for (const [relPattern, hrefPattern, link] of iconLinks) {
    const pattern = new RegExp(`<link\\b(?=[^>]*\\b${relPattern})(?=[^>]*\\bhref=["'][^"']*${hrefPattern}["'])[^>]*>`, "i");
    if (!pattern.test(pageContent)) pageContent = pageContent.replace("</head>", `${link}</head>`);
  }
  const page = openExternalLinksInNewTabs(addWebsiteSchema(pageContent));
  return new Response(page, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Robots-Tag": robots
    }
  });
}

function savedVacanciesPage(requestUrl) {
  const savedPageUrl = new URL("/saved-vacancies/", requestUrl.origin).href;
  return htmlResponse(`<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Saved Vacancies | DPSA Government Jobs</title>
<link rel="stylesheet" href="${SITE_URL}/styles.css"><script src="${SITE_URL}/bookmark.js" defer></script></head>
<body class="post-theme"><a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><nav class="nav shell" aria-label="Main navigation">
<a class="brand" href="${SITE_URL}/" aria-label="DPSA Government Jobs home"><img src="${SITE_URL}/south-african-flag.png" width="40" height="40" alt=""><span class="brand-copy"><span class="brand-title">DPSA</span><span class="brand-subtitle">Government Jobs</span></span></a>
<div class="nav-links"><a href="${SITE_URL}/">Home</a><a href="${savedPageUrl}" aria-current="page">Saved vacancies</a><a href="${SITE_URL}/#listings">Vacancies</a></div>
</nav></header>
<main id="main"><div class="site-post"><section class="page-hero"><div class="shell">
<p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span> Your job search</p><h1>Saved vacancies</h1>
<p class="lead">Vacancies you bookmark on this jobs website appear here. Your saved list is kept in this browser and is not linked to an account.</p>
</div></section><section class="content-section"><div class="shell">
<p data-saved-vacancies-status role="status" aria-live="polite">Loading saved vacancies…</p>
<div class="listing-grid saved-vacancies-list" data-saved-vacancies-list aria-live="polite"></div>
<p class="saved-vacancy-storage-note">This list is separate from bookmarks saved on the main DPSA Government Jobs website. Clearing this browser’s site data may remove saved vacancies.</p>
<p><a class="button" href="${SITE_URL}/">Browse current vacancies</a></p>
</div></section></div></main>
<footer class="site-footer"><div class="shell"><div class="footer-main">
<div class="footer-contact"><a class="brand" href="${SITE_URL}/" aria-label="DPSA Government Jobs home"><img src="${SITE_URL}/south-african-flag.png" width="40" height="40" alt=""><span class="brand-copy"><span class="brand-title">DPSA</span><span class="brand-subtitle">Government Jobs</span></span></a>
<address class="footer-address"><img src="${SITE_URL}/footer-location.svg" alt=""><span>Office 531, 5th Floor, Barend van Erkom Building, 217 Pretorius Street, Pretoria Central, Pretoria, 0002</span></address></div>
<nav class="footer-column" aria-label="Vacancies"><h2>Vacancies</h2><a href="${SITE_URL}/">All vacancies</a><a href="${savedPageUrl}">Saved vacancies</a><a href="${SITE_URL}/dpsa-vacancy-circulars/">DPSA circulars</a></nav>
<nav class="footer-column" aria-label="Job seeker resources"><h2>Job seeker resources</h2><a href="${SITE_URL}/how-to-apply/">How to apply</a><a href="${SITE_URL}/job-alert-terms.html">Job alert terms</a></nav>
</div><div class="footer-bottom"><span>© DPSA Government Jobs</span><span>This is an independent guide and is not affiliated with DPSA.</span></div></div></footer></body></html>`, 200, "noindex, nofollow");
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
  const adUnitMarkup = `<aside class="content-ad" aria-label="Advertisement"><ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-3860151941190347" data-ad-slot="3081508385" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});</script></aside>`;
  const jobDetails = detailSections(job);
  const requirementsIndex = jobDetails.findIndex(([label]) => label === "Requirements");
  const adIndex = requirementsIndex >= 0 ? requirementsIndex : Math.min(1, jobDetails.length);
  const sections = jobDetails.map(([label, value], index) =>
    `${index === adIndex ? adUnitMarkup : ""}<section${label === "How to apply" ? ' id="how-to-apply"' : label === "Requirements" ? ' id="requirements"' : label === "Skills and competencies" ? ' id="skills-and-competencies"' : label === "Duties" ? ' id="duties"' : label === "Job purpose" ? ' id="job-purpose"' : ""}><h2>${escapeHtml(label)}</h2>${vacancySectionMarkup(label, value)}</section>`
  ).join("") || adUnitMarkup;
  const schema = schemaForJob(job, pageUrl);
  const schemaMarkup = schema ? `<script type="application/ld+json">${jsonLdScript(schema)}</script>` : "";
  const circularName = canonicalCircularName(job.circularName);
  const circularPath = circularArchivePath(circularName);
  const department = hiringOrganizationName(job);
  const provinceName = normalizeProvince(job.province) || "National";
  const provinceSlug = provinceName.toLocaleLowerCase("en-ZA").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const breadcrumbItems = [
    { name: "Home", item: `${SITE_URL}/` },
    { name: provinceName, item: `${SITE_URL}/government-vacancies/${provinceSlug}/` },
    ...(department ? [{
      name: department,
      item: `${SITE_URL}/?department=${encodeURIComponent(department)}#listings`
    }] : []),
    ...(circularName && circularPath ? [{
      name: circularName,
      item: `${SITE_URL}${circularPath}`
    }] : []),
    ...(employmentTypeCategory(job) ? [{
      name: employmentTypeCategory(job),
      item: `${SITE_URL}/?employmentType=${encodeURIComponent(employmentTypeCategory(job))}#listings`
    }] : []),
    { name: title, item: pageUrl }
  ];
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems.map(({ name, item }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item
    }))
  };
  const breadcrumbMarkup = breadcrumbItems.map(({ name, item }, index) =>
    `${index ? " › " : ""}${index === breadcrumbItems.length - 1
      ? escapeHtml(name)
      : `<a href="${escapeHtml(item)}">${escapeHtml(name)}</a>`}`
  ).join("");
  const breadcrumbJsonLd = `<script type="application/ld+json">${jsonLdScript(breadcrumbSchema)}</script>`;
  const faq = vacancyFaqMarkup(vacancyFaq(job));
  const circularPage = String(job.circularPage ?? "").replace(/^page\s*/i, "").trim();
  const circularNavigation = groupJobsByCircular(jobs.filter(candidate => !isExpired(candidate)))
    .slice(-MAX_ACTIVE_CIRCULARS)
    .reverse()
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
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description: metaDescription,
    image: shareImageUrl,
    mainEntityOfPage: pageUrl,
    publisher: {
      "@type": "Organization",
      name: "DPSA Government Jobs",
      url: `${SITE_URL}/`
    },
    ...(parseSouthAfricanDate(job.circularDate || "", false)
      ? { datePublished: parseSouthAfricanDate(job.circularDate || "", false) }
      : {})
  };
  const articleSchemaMarkup = `<script type="application/ld+json">${jsonLdScript(articleSchema)}</script>`;
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
<script src="${SITE_URL}/bookmark.js" defer></script>
<title>${escapeHtml(pageTitle)}</title><meta name="description" content="${escapeHtml(metaDescription)}">
<meta name="robots" content="index, follow"><link rel="canonical" href="${escapeHtml(pageUrl)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="DPSA Government Jobs">
<meta property="og:title" content="${escapeHtml(pageTitle)}"><meta property="og:description" content="${escapeHtml(metaDescription)}">
<meta property="og:url" content="${escapeHtml(pageUrl)}"><meta property="og:image" content="${escapeHtml(shareImageUrl)}">
<meta property="og:image:alt" content="DPSA Government Jobs vacancy">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(pageTitle)}">
<meta name="twitter:description" content="${escapeHtml(metaDescription)}"><meta name="twitter:image" content="${escapeHtml(shareImageUrl)}">
${schemaMarkup}
${articleSchemaMarkup}
${breadcrumbJsonLd}
${faq.schemaMarkup}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light;font-family:"Jost",Arial,Helvetica,sans-serif;color:#32373c;background:#f8fbff}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}button,input,select,textarea{font:inherit}
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
.vacancy-card{position:relative;display:grid;grid-template-columns:58px minmax(0,1fr);gap:18px;padding:26px 72px 26px 26px;border:1px solid #e6eaf0;border-radius:12px;background:#fff;box-shadow:0 8px 26px rgba(26,52,94,.045)}
.bookmark-button{display:grid;width:36px;height:36px;place-items:center;padding:0;border:1px solid #dce3ed;border-radius:50%;color:#647184;background:#fff;cursor:pointer;transition:color .16s ease,border-color .16s ease,background .16s ease}
.vacancy-card>.bookmark-button{position:absolute;top:16px;right:16px}
.bookmark-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:1.8}
.bookmark-button:hover,.bookmark-button:focus-visible{border-color:#17499e;color:#17499e;background:#f1f6fc}
.bookmark-button:focus-visible{outline:3px solid rgba(23,73,158,.25);outline-offset:2px}
.bookmark-button.is-saved{border-color:#17499e;color:#17499e;background:#e0ebfb}
.bookmark-button.is-saved svg{fill:currentColor}
.bookmark-button:disabled{cursor:not-allowed;opacity:.55}
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
.related-job-card{position:relative;min-width:0;padding:15px 56px 15px 15px;border:1px solid #e6eaf0;border-radius:9px;background:#f8fbff}
.related-job-card>.bookmark-button{position:absolute;top:10px;right:10px}
.related-job-link{display:flex;min-height:100%;flex-direction:column;gap:8px;color:#32373c;text-decoration:none}
.related-job-link:hover strong{color:#17499e}
.related-job-link strong{line-height:1.35;overflow-wrap:anywhere}
.related-job-link span{color:#66717c;font-size:13px}
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
.official-circular{margin:24px 0;color:#536171;font-size:16px}.site-footer{border-top:0;color:#fff;background:linear-gradient(110deg,#245db9 0%,#173b83 100%);font-size:13px}.site-footer .shell{padding-block:34px 18px}.site-footer p{margin:0;color:rgba(255,255,255,.78)}.footer-main{display:grid;grid-template-columns:minmax(230px,1.5fr) repeat(3,minmax(130px,1fr));gap:30px;align-items:start}.footer-contact{max-width:310px}.footer-contact .brand{color:#fff}.footer-contact .brand-subtitle{color:rgba(255,255,255,.78)}.footer-address{display:flex;align-items:flex-start;gap:9px;margin:20px 0 12px;color:rgba(255,255,255,.92);font-size:13px;font-style:normal;line-height:1.65}.footer-address img{width:18px;height:18px;flex:0 0 18px;margin-top:2px}.footer-contact>p{font-size:12px;line-height:1.65}.footer-column{display:grid;align-content:start;justify-items:start;gap:11px}.footer-column h2{margin:2px 0 5px;color:#fff;font-size:14px}.footer-column>a{color:rgba(255,255,255,.88);font-size:13px;line-height:1.4;text-decoration:none}.footer-column>a:hover{color:#ffbf3f;text-decoration:underline;text-underline-offset:3px}.footer-follow-label{margin-top:7px;color:rgba(255,255,255,.8);font-size:12px;font-weight:600}.footer-bottom{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 20px;margin-top:30px;padding-top:15px;border-top:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.75);font-size:11px}
.content-ad{display:flex;justify-content:center;margin:24px 0;max-width:100%;overflow:hidden}.content-ad .adsbygoogle{width:100%;max-width:970px;min-height:100px}
.sections .share-post{margin:24px 0;padding-top:16px;border-top:1px solid #e6eaf0}
.share-post h2{margin:0 0 12px;font-size:18px}
.post-share-links{display:flex;flex-wrap:wrap;gap:10px}
.post-share-link{display:inline-flex;min-height:40px;align-items:center;gap:8px;padding:7px 13px;border:1px solid #17499e;border-radius:7px;color:#fff;background:#17499e;font-size:14px;font-weight:600;text-decoration:none}
.post-share-link:hover{background:#13377f}
.post-share-icon{display:block;width:20px;height:20px;object-fit:contain}
.social-links{display:flex;align-items:center;gap:9px}.social-links a{display:grid;width:34px;height:34px;place-items:center;border:1px solid rgba(255,255,255,.48);border-radius:50%;color:#fff;text-decoration:none}.social-links a:hover{border-color:#fff;background:rgba(255,255,255,.14)}.social-links img{width:16px;height:16px}
@media(max-width:980px){.footer-main{grid-template-columns:repeat(2,minmax(0,1fr));gap:28px 20px}.footer-contact{grid-column:1/-1;max-width:460px}.footer-bottom{flex-direction:column;margin-top:24px}}
@media(max-width:700px){.related-job-grid{grid-template-columns:1fr}}
@media(max-width:600px){.shell{width:min(100% - 28px,1120px)}.nav{min-height:70px;gap:12px}.brand img{width:36px;height:36px}.nav-links{gap:12px;font-size:11px}main{padding-block:22px 38px}.vacancy-card{grid-template-columns:48px minmax(0,1fr);gap:13px;padding:17px 58px 17px 17px}.job-mark{width:48px;height:48px;border-radius:9px}.meta-grid{grid-template-columns:1fr;gap:7px}.sections{margin-top:0}.related-jobs,.vacancy-faq{padding:17px}}
</style></head>
<body><header class="site-header"><nav class="nav shell" aria-label="Main navigation">
<a class="brand" href="${SITE_URL}/" aria-label="DPSA Government Jobs home"><img src="${SITE_URL}/south-african-flag.png" width="40" height="40" alt="" decoding="async"><span class="brand-copy"><span class="brand-title">DPSA</span><span class="brand-subtitle">Government Jobs</span></span></a>
<div class="nav-links"><a href="${SITE_URL}/">Home</a><a href="${new URL("/saved-vacancies/", requestUrl.origin).href}">Saved vacancies</a><details class="nav-dropdown"><summary>Circulars</summary><div class="nav-dropdown-menu"><a href="${SITE_URL}/dpsa-vacancy-circulars/">All circulars</a>${circularNavigation}</div></details><a href="${SITE_URL}/#listings">Vacancies</a></div>
</nav></header><main class="shell">
<nav class="breadcrumb" aria-label="Breadcrumb">${breadcrumbMarkup}</nav>
<article class="vacancy-card">${bookmarkButtonMarkup(pageUrl, title)}<div class="job-mark">${jobMark}</div><div class="job-content">
<h1 class="job-title">${escapeHtml(title)}</h1><p class="intro">${employer ? `The ${escapeHtml(employer)} invites applications for ${escapeHtml(title)}.` : `Applications are invited for ${escapeHtml(title)}. Check the official advert for the hiring department.`}</p>
<div class="meta-grid"><p class="meta"><strong>Hiring department:</strong> ${escapeHtml(employer || "Check the official advert")}</p>
${location ? `<p class="meta"><strong>Location/centre in advert:</strong> ${escapeHtml(location)}</p>` : ""}
<p class="meta"><strong>Employment type:</strong> ${employmentTypeCategory(job)
    ? `<a href="${SITE_URL}/?employmentType=${encodeURIComponent(employmentTypeCategory(job))}#listings">${escapeHtml(displayEmploymentType(job))}</a>`
    : escapeHtml(displayEmploymentType(job))}</p><p class="meta" id="salary-details"><strong>Salary:</strong> ${salaryMarkup}</p>
${jobLevel ? `<p class="meta"><strong>Job level:</strong> ${jobLevelMarkup}</p>` : ""}
<p class="meta"><strong>Closing date:</strong> ${escapeHtml(deadline)}</p>${referenceDetails.map(([label, value]) => `<p class="meta"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}
${publicationDetails.map(([label, value]) => `<p class="meta"><strong>${escapeHtml(label)}:</strong> ${label === "Published" && circularPath
  ? `<a class="circular-pill" href="${SITE_URL}${circularPath}">${escapeHtml(value)}</a>`
  : escapeHtml(value)}</p>`).join("")}</div>
</div><div class="sections">${sections}${vacancyLinksSection(job)}${officialCircularLink}
<section class="share-post" aria-labelledby="share-post-title"><h2 id="share-post-title">Share this post</h2>
<nav class="post-share-links" aria-label="Share this post">
<a class="post-share-link" href="${escapeHtml(shareLinks.facebook)}" target="_blank" rel="noopener noreferrer"><img class="post-share-icon" src="${SITE_URL}/footer-facebook.svg" alt="">Facebook</a>
<a class="post-share-link" href="${escapeHtml(shareLinks.twitter)}" target="_blank" rel="noopener noreferrer"><img class="post-share-icon" src="${SITE_URL}/footer-x.svg" alt="">X</a>
<a class="post-share-link" href="${escapeHtml(shareLinks.pinterest)}" target="_blank" rel="noopener noreferrer"><img class="post-share-icon" src="${SITE_URL}/footer-pinterest.svg" alt="">Pinterest</a>
</nav></section>
<p class="important"><strong>Important:</strong> Confirm the department, eligibility, closing date and submission instructions in the official advert.</p></div>
</article>${faq.markup}${relatedJobsMarkup(job, jobs, requestUrl.origin)}</main>
<footer class="site-footer"><div class="shell">
<div class="footer-main">
<div class="footer-contact"><a class="brand" href="${SITE_URL}/" aria-label="DPSA Government Jobs home"><img src="${SITE_URL}/south-african-flag.png" width="40" height="40" alt="" decoding="async"><span class="brand-copy"><span class="brand-title">DPSA</span><span class="brand-subtitle">Government Jobs</span></span></a>
<address class="footer-address"><img src="${SITE_URL}/footer-location.svg" alt=""><span>Office 531, 5th Floor, Barend van Erkom Building, 217 Pretorius Street, Pretoria Central, Pretoria, 0002</span></address>
</div>
<nav class="footer-column" aria-label="Vacancies"><h2>Vacancies</h2><a href="${SITE_URL}/">All vacancies</a><a href="${new URL("/saved-vacancies/", requestUrl.origin).href}">Saved vacancies</a><a href="${SITE_URL}/government-vacancies/">Vacancies by province</a><a href="${SITE_URL}/dpsa-vacancy-circulars/">DPSA circulars</a></nav>
<nav class="footer-column" aria-label="Job seeker resources"><h2>Job seeker resources</h2><a href="${SITE_URL}/how-to-apply/">How to apply</a><a href="${SITE_URL}/national-treasury-salary-scales/">National Treasury salary scales</a><a href="${SITE_URL}/job-alert-terms.html">Job alert terms</a></nav>
<nav class="footer-column footer-social-column" aria-label="Official information and social media"><h2>Official information</h2><a href="https://www.dpsa.gov.za/newsroom/psvc/" target="_blank" rel="noopener noreferrer">Official DPSA circulars ↗</a><span class="footer-follow-label">Follow us</span>
<div class="social-links"><a href="https://www.facebook.com/DPSAGovernmentJobs" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on Facebook"><img src="${SITE_URL}/footer-facebook.svg" alt=""></a>
<a href="https://x.com/dpsajobs" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on X"><img src="${SITE_URL}/footer-x.svg" alt=""></a>
<a href="https://za.pinterest.com/dpsavacancies/" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on Pinterest"><img src="${SITE_URL}/footer-pinterest.svg" alt=""></a></div></nav>
</div><div class="footer-bottom"><span>© DPSA Government Jobs</span><span>This is an independent guide and is not affiliated with DPSA.</span></div>
</div></footer></body></html>`);
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

  async fetch(request, env, context) {
    const url = new URL(request.url);
    const isAlertSignup = url.pathname === "/api/alerts/subscribe";
    const isAlertConfirmation = url.pathname === "/api/alerts/confirm";
    const isAlertUnsubscribe = url.pathname === "/api/alerts/unsubscribe";
    const isCvMatchRecord = url.pathname === "/api/cv-matches";
    if (request.method !== "GET" && request.method !== "PUT" && request.method !== "OPTIONS" &&
        !(request.method === "POST" && (isAlertSignup || isAlertConfirmation || isAlertUnsubscribe || isCvMatchRecord))) {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }
    if (request.method === "GET" && !url.pathname.startsWith("/api/") &&
        (isFeedRequest(url) || isAdminPath(url.pathname))) {
      return homeRedirect();
    }
    if (request.method === "OPTIONS" && (isAlertSignup || isCvMatchRecord)) {
      const origin = request.headers.get("Origin") ?? "";
      if (!ALERTS_ALLOWED_ORIGINS.has(origin)) return alertsJsonResponse({ error: "This request is not allowed." }, 403, origin);
      return alertsJsonResponse({}, 204, origin);
    }
    if (request.method === "POST" && isAlertSignup) return subscribeToJobAlerts(request, env);
    if (request.method === "POST" && isCvMatchRecord) return recordCvMatch(request, env);
    if (request.method === "GET" && isAlertConfirmation) {
      return showAlertConfirmation(url.searchParams.get("token"), env, "confirm");
    }
    if (request.method === "POST" && isAlertConfirmation) {
      try {
        const form = await request.formData();
        return confirmJobAlerts(String(form.get("token") ?? ""), env);
      } catch {
        return alertPage("Invalid confirmation request", "Use the confirmation button in your email to activate alerts.");
      }
    }
    if (request.method === "GET" && isAlertUnsubscribe) {
      return showAlertConfirmation(url.searchParams.get("token"), env, "unsubscribe");
    }
    if (request.method === "POST" && isAlertUnsubscribe) {
      let token = url.searchParams.get("token") ?? "";
      if (!token && request.headers.get("Content-Type")?.includes("application/x-www-form-urlencoded")) {
        try {
          const form = await request.formData();
          token = String(form.get("token") ?? "");
        } catch {
          return alertPage("Invalid unsubscribe request", "Use the unsubscribe link in your alert email.");
        }
      }
      return unsubscribeFromJobAlerts(token, env);
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
      if (/^\/saved-vacancies\/?$/.test(url.pathname)) return savedVacanciesPage(url);
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

    const previousJobs = await loadPublishedJobs(env);
    const previousIds = new Set(previousJobs.map(job => job.id));
    const cleanedJobs = prunePublishedJobs(jobs);
    const serializedJobs = JSON.stringify(cleanedJobs.jobs);
    if (new TextEncoder().encode(serializedJobs).byteLength > MAX_JOBS_BYTES) {
      return jsonResponse({ error: "Job list is too large to store. Shorten vacancy descriptions and try again." }, 413);
    }

    await env.JOBS.put(JOBS_KEY, serializedJobs);
    const newJobs = cleanedJobs.jobs.filter(job => !previousIds.has(job.id));
    if (newJobs.length) {
      const sendAlerts = () => sendNewJobAlerts(env, newJobs);
      if (context?.waitUntil) {
        context.waitUntil(sendAlerts().catch(error => {
          console.error("Could not process new-job alert delivery.", error);
        }));
      } else {
        await sendAlerts();
      }
    }
    return jsonResponse({
      success: true,
      count: cleanedJobs.jobs.length,
      removedExpiredCount: cleanedJobs.removedExpiredCount,
      removedCircularNames: cleanedJobs.removedCircularNames,
      removedJobIds: cleanedJobs.removedJobIds
    });
  }
};

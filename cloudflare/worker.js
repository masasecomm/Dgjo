import defaultJobs from "../jobs.json" with { type: "json" };

const JOBS_KEY = "published-jobs";
const CATEGORIES = new Set(["Design", "Engineering", "Marketing", "Product"]);
const TYPES = new Set(["Full-time", "Part-time", "Contract", "Internship"]);
const MAX_JOBS = 500;
const MAX_TEXT_LENGTH = 160;
const JOB_FIELDS = new Set([
  "id", "title", "company", "location", "type", "category", "salary",
  "salaryText", "posted", "logo", "color", "logoColor"
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
    ids.add(job.id);
    return true;
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/jobs") return jsonResponse({ error: "Not found." }, 404);
    if (request.method === "OPTIONS") return jsonResponse({}, 204);

    if (request.method === "GET") {
      const savedJobs = await env.JOBS.get(JOBS_KEY, "json");
      return jsonResponse(savedJobs ?? defaultJobs);
    }

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
      return jsonResponse({ error: "Job list is invalid or exceeds the 500-job limit." }, 400);
    }

    await env.JOBS.put(JOBS_KEY, JSON.stringify(jobs));
    return jsonResponse({ success: true, count: jobs.length });
  }
};

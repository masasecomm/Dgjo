import { normalizeJobRegion } from "../provinces.js";

const STOP_WORDS = new Set([
  "about", "after", "also", "and", "any", "are", "application", "applications", "been",
  "before", "being", "both", "candidate", "candidates", "could", "department", "departments",
  "include", "job", "skills",
  "each", "from", "further", "have", "having", "here", "into", "including", "invite", "invited",
  "must", "other", "please", "position", "post", "posts", "provide", "related", "required",
  "requirements", "should", "that", "their", "there", "these", "this", "those", "through",
  "under", "upon", "very", "which", "while", "with", "within", "would", "your",
  "african", "age", "asian", "black", "coloured", "disability", "disabled", "female",
  "gender", "indian", "male", "nationality", "race", "religion", "sex", "white"
]);

const TERM_GROUPS = [
  ["admin", "administration", "administrative", "administrator"],
  ["account", "accountant", "accounting", "accounts"],
  ["educat", "educate", "education", "educator", "teacher", "teaching"],
  ["engineer", "engineering"],
  ["financ", "finance", "financial"],
  ["manage", "manager", "management", "managing"],
  ["nurs", "nurse", "nursing"],
  ["legal", "law"]
];
const TERM_ROOTS = new Map(TERM_GROUPS.flatMap(group => group.map(term => [term, group[0]])));
const FIELD_WEIGHTS = [
  ["title", 4],
  ["requirements", 4],
  ["skillsAndCompetencies", 3],
  ["jobPurpose", 2],
  ["duties", 2],
  ["category", 1]
];

function normalizeToken(token) {
  const lower = token.toLocaleLowerCase("en-ZA").normalize("NFKD").replace(/\p{M}/gu, "");
  const grouped = TERM_ROOTS.get(lower);
  if (grouped) return grouped;
  if (lower.length > 5 && lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (lower.length > 5 && lower.endsWith("ing")) return lower.slice(0, -3);
  if (lower.length > 4 && lower.endsWith("ed")) return lower.slice(0, -2);
  if (lower.length > 4 && lower.endsWith("s")) return lower.slice(0, -1);
  return lower;
}

export function cvTerms(value) {
  return new Set(
    String(value ?? "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .match(/\p{L}{3,}/gu)
      ?.map(normalizeToken)
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token)) ?? []
  );
}

export function rankJobsForCv(cvText, jobs, { province = "all", department = "all", limit = Infinity } = {}) {
  const candidateTerms = cvTerms(cvText);
  if (!candidateTerms.size || !Array.isArray(jobs)) return [];

  const matches = [];
  for (const job of jobs) {
    if (province !== "all" && normalizeJobRegion(job.province) !== province) continue;
    if (department !== "all" && String(job.company ?? "").trim().toLowerCase() !== department.toLowerCase()) continue;

    const weightedTerms = new Map();
    for (const [field, weight] of FIELD_WEIGHTS) {
      for (const term of cvTerms(job[field])) {
        weightedTerms.set(term, Math.max(weightedTerms.get(term) ?? 0, weight));
      }
    }
    const matchedTerms = [...weightedTerms.keys()].filter(term => candidateTerms.has(term));
    if (matchedTerms.length < 2) continue;

    const totalWeight = [...weightedTerms.values()].reduce((sum, weight) => sum + weight, 0);
    const matchedWeight = matchedTerms.reduce((sum, term) => sum + weightedTerms.get(term), 0);
    const overlap = totalWeight ? Math.round((matchedWeight / totalWeight) * 100) : 0;
    if (overlap < 8) continue;
    matches.push({ job, matchedTerms, overlap });
  }

  return matches
    .sort((left, right) => right.overlap - left.overlap || right.matchedTerms.length - left.matchedTerms.length)
    .slice(0, Number.isFinite(limit) ? Math.max(0, Math.min(matches.length, limit)) : matches.length);
}

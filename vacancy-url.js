export function slugifyJobPart(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

const JOB_TITLE_SLUG_STOP_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

export function jobSlug(job) {
  const title = String(job.title ?? "")
    .split(":", 1)[0]
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  const titleWords = slugifyJobPart(title).split("-")
    .filter(word => word && !JOB_TITLE_SLUG_STOP_WORDS.has(word) && !/^(?:19|20)\d{2}$/.test(word))
    .slice(0, 5);
  const identity = [job.postNo, job.refNo]
    .map(slugifyJobPart)
    .filter(Boolean);
  return [titleWords.join("-"), ...identity].filter(Boolean).join("-") || slugifyJobPart(job.id) || "vacancy";
}

export function jobPagePath(job) {
  return `/${encodeURIComponent(jobSlug(job))}/`;
}

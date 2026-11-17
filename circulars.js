export function canonicalCircularName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  const match = name.match(/\bcircular\s+(\d{1,3})\s+(?:of|\/)\s*(20\d{2})\b/i);
  return match ? `Circular ${Number(match[1])} of ${match[2]}` : name;
}

export function circularArchivePath(value) {
  const slug = canonicalCircularName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug ? `/dpsa-vacancy-circulars/${slug}/` : "";
}

export function circularArchiveAnchor(value) {
  return circularArchivePath(value).split("/").filter(Boolean).at(-1) ?? "";
}

function circularOrder(value) {
  const match = canonicalCircularName(value).match(/^Circular (\d+) of (20\d{2})$/);
  return match ? { number: Number(match[1]), year: Number(match[2]) } : null;
}

export function compareCircularNames(leftValue, rightValue) {
  const left = circularOrder(leftValue);
  const right = circularOrder(rightValue);
  if (left && right) return left.year - right.year || left.number - right.number;
  if (left) return -1;
  if (right) return 1;
  return 0;
}

export function sortJobsByCircular(jobs) {
  return jobs
    .map((job, index) => ({ job, index }))
    .sort((left, right) =>
      compareCircularNames(left.job?.circularName, right.job?.circularName) || left.index - right.index
    )
    .map(({ job }) => job);
}

export const SEARCH_CONSOLE_ARCHIVED_CIRCULARS = [
  "Circular 30 of 2026",
  "Circular 29 of 2026",
  "Circular 28 of 2026",
  "Circular 27 of 2026",
  "Circular 26 of 2026",
  "Circular 25 of 2026",
  "Circular 24 of 2026",
  "Circular 23 of 2026",
  "Circular 21 of 2026",
  "Circular 20 of 2026",
  "Circular 19 of 2026",
  "Circular 18 of 2026",
  "Circular 17 of 2026",
  "Circular 12 of 2026",
  "Circular 10 of 2026",
  "Circular 8 of 2026",
  "Circular 4 of 2026",
  "Circular 3 of 2026",
  "Circular 2 of 2026",
  "Circular 1 of 2026"
];

export function groupJobsByCircular(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const name = canonicalCircularName(job?.circularName);
    const path = circularArchivePath(name);
    if (!name || !path) continue;
    if (!groups.has(path)) groups.set(path, { name, path, jobs: [] });
    groups.get(path).jobs.push(job);
  }
  return [...groups.values()].sort((a, b) => compareCircularNames(a.name, b.name));
}

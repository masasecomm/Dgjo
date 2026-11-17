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

export function groupJobsByCircular(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const name = canonicalCircularName(job?.circularName);
    const path = circularArchivePath(name);
    if (!name || !path) continue;
    if (!groups.has(path)) groups.set(path, { name, path, jobs: [] });
    groups.get(path).jobs.push(job);
  }
  return [...groups.values()].sort((a, b) => b.name.localeCompare(a.name, "en-ZA", { numeric: true }));
}

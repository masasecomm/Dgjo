function normalizeCircularName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-ZA");
}

export function vacancyMatchKey(job) {
  const postIdentity = [job.postNo, job.refNo].filter(Boolean).join("|").toLowerCase();
  if (postIdentity) return `${job.sourceUrl ?? ""}|${postIdentity}`;
  return `${job.title}|${job.company}`.toLowerCase().replace(/\s+/g, " ").trim();
}

export function mergeVacancyLinks(existingLinks, importedLinks) {
  const links = new Map();
  for (const link of [
    ...(Array.isArray(existingLinks) ? existingLinks : []),
    ...(Array.isArray(importedLinks) ? importedLinks : [])
  ]) {
    if (typeof link?.url !== "string" || typeof link.label !== "string") continue;
    links.set(link.url, { label: link.label, url: link.url });
  }
  return [...links.values()];
}

export function getCircularVacancies(vacancies, circularName) {
  const normalizedName = normalizeCircularName(circularName);
  if (!normalizedName) return [...vacancies];
  return [...vacancies].filter(vacancy => normalizeCircularName(vacancy.circularName) === normalizedName);
}

export function circularPublicationStatus(circularName, importedVacancies, publishedJobs) {
  const imported = getCircularVacancies(importedVacancies, circularName);
  const published = getCircularVacancies(publishedJobs, circularName);
  const publishedKeys = new Set(published.map(vacancyMatchKey));
  return {
    importedCount: imported.length,
    publishedCount: published.length,
    alreadyPublishedCount: imported.filter(vacancy => publishedKeys.has(vacancyMatchKey(vacancy))).length
  };
}

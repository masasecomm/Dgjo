function normalizeCircularName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-ZA");
}

export function vacancyMatchKey(job) {
  const postIdentity = [job.postNo, job.refNo].filter(Boolean).join("|").toLowerCase();
  if (postIdentity) return `${job.sourceUrl ?? ""}|${postIdentity}`;
  return `${job.title}|${job.company}`.toLowerCase().replace(/\s+/g, " ").trim();
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

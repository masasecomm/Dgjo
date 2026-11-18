const SITE_NAME = "DPSA Government Jobs";

export function homePageTitle({
  query = "",
  province = "",
  department = "",
  employmentType = "",
  cvMatches = false,
  year = new Date().getFullYear()
} = {}) {
  if (cvMatches) return `CV Job Matches | ${SITE_NAME}`;

  const search = String(query).trim().replace(/\s+/g, " ").slice(0, 70);
  const privateSearch = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(search) || /(?:\+?\d[\s().-]*){9,}/.test(search);
  const filters = [
    search && (privateSearch ? "Job Search Results" : `Jobs matching "${search}"`),
    province && `Government Jobs in ${province}`,
    department && `${department} Vacancies`,
    employmentType && `${employmentType} Jobs`
  ].filter(Boolean);

  return filters.length
    ? `${filters.join(" | ")} | ${SITE_NAME}`
    : `Government Vacancies | DPSA Vacancies in South Africa ${year}`;
}

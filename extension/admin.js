import * as XLSX from "@e965/xlsx";
import {
  discoverDpsaCirculars,
  downloadDpsaPdf,
  extractPdfText,
  parseDpsaCircular
} from "./importer.js";

const DEFAULT_API_URL = "https://goodwork-jobs-api.dpsajobs.workers.dev/api/jobs";
const SETTINGS_KEY = "goodworkAdminSettings";
const MAX_PUBLISHED_JOBS = 2000;
const apiUrlInput = document.querySelector("#api-url");
const tokenInput = document.querySelector("#admin-token");
const sourceUrlInput = document.querySelector("#source-url");
const connectionForm = document.querySelector("#connection-form");
const connectButton = document.querySelector("#connect");
const refreshButton = document.querySelector("#refresh-jobs");
const forgetButton = document.querySelector("#forget-credentials");
const connectionBadge = document.querySelector("#connection-badge");
const connectedDetails = document.querySelector("#connected-details");
const connectedUrl = document.querySelector("#connected-url");
const jobSearch = document.querySelector("#job-search");
const sortJobs = document.querySelector("#sort-jobs");
const jobList = document.querySelector("#job-list");
const jobSummary = document.querySelector("#job-summary");
const dialog = document.querySelector("#job-dialog");
const form = document.querySelector("#job-form");
const toast = document.querySelector("#toast");
const pdfFilesInput = document.querySelector("#pdf-files");
const pdfUrlInput = document.querySelector("#pdf-url");
const importStatus = document.querySelector("#import-status");
const importResults = document.querySelector("#import-results");
const importCount = document.querySelector("#import-count");
const importSources = document.querySelector("#import-sources");
const importTableBody = document.querySelector("#import-table-body");
const selectAllImport = document.querySelector("#select-all-import");
const circularPicker = document.querySelector("#circular-picker");
const loadCircularButton = document.querySelector("#load-circular");
const importProgress = document.querySelector("#import-progress");
const publishProgress = document.querySelector("#publish-progress");
const publishStatus = document.querySelector("#publish-status");
let apiUrl;
let adminToken;
let jobs = [];
let activeFilter = "All";
let toastTimer;
const importedVacancies = new Map();
let circularOptions = [];

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setConnected(connected) {
  connectionBadge.classList.toggle("badge-connected", connected);
  connectionBadge.classList.toggle("badge-muted", !connected);
  connectionBadge.innerHTML = `<span class="badge-dot"></span> ${connected ? "Connected" : "Not connected"}`;
  jobSearch.disabled = !connected;
  sortJobs.disabled = !connected;
  refreshButton.disabled = !connected;
  updatePublishButton();
}

function validateApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a valid Worker API URL.");
  }
  if (url.protocol !== "https:" || !url.pathname.endsWith("/api/jobs") || url.username || url.password) {
    throw new Error("Enter the HTTPS Cloudflare Worker URL ending in /api/jobs.");
  }
  return url;
}

async function requestPermission(url) {
  const originPattern = `${url.origin}/*`;
  return chrome.permissions.request({ origins: [originPattern] }).then(granted => {
    if (!granted) throw new Error("Allow access to your Cloudflare Worker to continue.");
  });
}

async function readJobs(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    let message = `Could not load jobs (HTTP ${response.status}).`;
    try {
      const result = await response.json();
      if (typeof result.error === "string") message = result.error;
    } catch {
      // Use the HTTP status when the server does not return JSON.
    }
    throw new Error(message);
  }
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("The Worker returned an invalid job list.");
  return data;
}

async function connect(urlValue, tokenValue, askPermission) {
  connectButton.disabled = true;
  try {
    const url = validateApiUrl(urlValue);
    if (!tokenValue) throw new Error("Enter your Worker admin key.");
    const permissionRequest = askPermission ? requestPermission(url) : Promise.resolve();
    await permissionRequest;
    const loadedJobs = await readJobs(url.href, tokenValue);

    apiUrl = url.href;
    adminToken = tokenValue;
    jobs = loadedJobs;
    await chrome.storage.local.set({
      [SETTINGS_KEY]: { apiUrl, adminToken, origin: url.origin }
    });

    apiUrlInput.value = apiUrl;
    tokenInput.value = "";
    connectionForm.classList.remove("connection-error");
    connectionForm.hidden = true;
    connectedDetails.hidden = false;
    forgetButton.hidden = false;
    connectedUrl.textContent = url.origin;
    setConnected(true);
    renderJobs();
    showToast("Connected. Your settings are saved on this device.");
  } catch (error) {
    if (askPermission) showToast(error.message, true);
    else {
      connectionForm.classList.add("connection-error");
      setConnected(false);
      showToast(`Could not reconnect: ${error.message} Enter your key and connect again.`, true);
    }
  } finally {
    connectButton.disabled = false;
  }
}

function renderJobs() {
  const query = jobSearch.value.trim().toLowerCase();
  const filtered = jobs.filter(job => {
    const matchesCategory = activeFilter === "All" || job.category === activeFilter;
    const searchable = `${job.title} ${job.company} ${job.location} ${job.category} ${job.type}`.toLowerCase();
    return matchesCategory && (!query || searchable.includes(query));
  });
  if (sortJobs.value === "salary") filtered.sort((a, b) => b.salary - a.salary);
  if (sortJobs.value === "title") filtered.sort((a, b) => a.title.localeCompare(b.title));
  jobSummary.textContent = `${filtered.length} ${filtered.length === 1 ? "opportunity" : "opportunities"}${filtered.length !== jobs.length ? ` · ${jobs.length} total` : ""}`;
  jobList.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const icon = document.createElement("span");
    icon.className = "empty-icon";
    icon.textContent = "✳";
    const title = document.createElement("strong");
    title.textContent = jobs.length ? "No matching opportunities." : "No jobs yet.";
    const message = document.createElement("span");
    message.textContent = jobs.length ? "Try a different search or category." : "Add your first listing to get started.";
    empty.append(icon, title, message);
    jobList.append(empty);
    return;
  }

  filtered.forEach(job => {
    const card = document.createElement("article");
    card.className = "job-card";

    const top = document.createElement("div");
    top.className = "job-top";
    const company = document.createElement("div");
    company.className = "company";
    const logo = document.createElement("span");
    logo.className = "company-logo";
    logo.style.backgroundColor = /^#[0-9a-f]{6}$/i.test(job.color) ? job.color : "#eaf1e2";
    logo.style.color = /^#[0-9a-f]{6}$/i.test(job.logoColor) ? job.logoColor : "#64803f";
    logo.textContent = job.logo;
    const companyDetails = document.createElement("div");
    const companyName = document.createElement("span");
    companyName.className = "company-name";
    companyName.textContent = job.company;
    const location = document.createElement("span");
    location.className = "company-location";
    location.textContent = job.location;
    companyDetails.append(companyName, location);
    company.append(logo, companyDetails);

    const actions = document.createElement("div");
    actions.className = "job-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEditor(job));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove “${job.title}” from the website?`)) return;
      remove.disabled = true;
      try {
        await publishJobs(jobs.filter(candidate => candidate.id !== job.id));
      } catch (error) {
        showToast(error.message, true);
      } finally {
        remove.disabled = false;
      }
    });
    actions.append(edit, remove);
    top.append(company, actions);

    const title = document.createElement("h3");
    title.textContent = job.title;
    const tags = document.createElement("div");
    tags.className = "job-tags";
    [job.type, job.category, "Remote-friendly"].forEach(value => {
      const tag = document.createElement("span");
      tag.textContent = value;
      tags.append(tag);
    });

    const bottom = document.createElement("div");
    bottom.className = "job-bottom";
    const salary = document.createElement("span");
    salary.className = "salary";
    salary.append(document.createTextNode(job.salaryText));
    const salaryPeriod = document.createElement("small");
    salaryPeriod.textContent = " / yr";
    salary.append(salaryPeriod);
    const posted = document.createElement("span");
    posted.className = "posted";
    posted.textContent = job.posted;
    bottom.append(salary, posted);
    card.append(top, title, tags, bottom);
    jobList.append(card);
  });
}

function setImportStatus(message, isError = false) {
  importStatus.textContent = message;
  importStatus.classList.toggle("error", isError);
}

function requestDpsaPermission(url) {
  return chrome.permissions.request({ origins: [`${url.origin}/*`] }).then(granted => {
    if (!granted) throw new Error("Allow access to the DPSA website to load its circulars.");
  });
}

function renderImportedVacancies() {
  const vacancies = [...importedVacancies.values()];
  importResults.hidden = vacancies.length === 0;
  importCount.textContent = `${vacancies.length} ${vacancies.length === 1 ? "vacancy" : "vacancies"} found`;
  importSources.textContent = vacancies.length > 200
    ? `Showing the first 200 here. Excel export and publishing include all ${vacancies.length}.`
    : `${new Set(vacancies.map(job => job.circularName)).size} circular${new Set(vacancies.map(job => job.circularName)).size === 1 ? "" : "s"} loaded`;
  importTableBody.replaceChildren();

  for (const vacancy of vacancies.slice(0, 200)) {
    const row = document.createElement("tr");
    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = vacancy.selected;
    checkbox.setAttribute("aria-label", `Select ${vacancy.title}`);
    checkbox.addEventListener("change", () => {
      vacancy.selected = checkbox.checked;
      selectAllImport.checked = vacancies.every(item => item.selected);
      selectAllImport.indeterminate = !selectAllImport.checked && vacancies.some(item => item.selected);
      updatePublishButton();
    });
    selectCell.append(checkbox);

    const identity = document.createElement("td");
    identity.textContent = [vacancy.postNo && `Post ${vacancy.postNo}`, vacancy.refNo && `Ref ${vacancy.refNo}`].filter(Boolean).join(" / ") || "Not stated";
    row.append(selectCell, identity);
    appendEditableCell(row, vacancy, "title", "Job title");
    appendEditableCell(row, vacancy, "company", "Department");
    appendEditableCell(row, vacancy, "location", "Location");
    appendEditableCell(row, vacancy, "closingDate", "Closing date");

    const detailsCell = document.createElement("td");
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Edit details";
    details.append(summary);
    const detailFields = [
      ["requirements", "Requirements"],
      ["duties", "Duties"],
      ["jobPurpose", "Job purpose"],
      ["skillsAndCompetencies", "Skills and competencies"],
      ["natureOfAppointment", "Appointment type"],
      ["salaryText", "Salary / stipend"],
      ["sourceUrl", "Official advert or circular URL"],
      ["circularPage", "Circular page number"],
      ["level", "Level"],
      ["branch", "Branch"],
      ["directorate", "Directorate"],
      ["chiefDirectorate", "Chief directorate"],
      ["cluster", "Cluster"],
      ["centre", "Centre"],
      ["enquiries", "Enquiries"],
      ["applications", "How to apply"],
      ["note", "Notes"],
      ["links", "Links found in circular PDF"]
    ];
    for (const [key, label] of detailFields) {
      const field = document.createElement("label");
      field.className = "import-detail-field";
      const fieldLabel = document.createElement("span");
      fieldLabel.textContent = label;
      const input = document.createElement(["requirements", "duties", "jobPurpose", "skillsAndCompetencies", "enquiries", "applications", "note", "links"].includes(key) ? "textarea" : "input");
      if (key === "sourceUrl") input.type = "url";
      input.value = key === "links"
        ? (vacancy.links ?? []).map(link => `${link.label || link.url} | ${link.url}`).join("\n")
        : vacancy[key] ?? "";
      input.maxLength = key === "sourceUrl" ? 2048 : key === "circularPage" ? 20 : ["requirements", "duties", "jobPurpose", "skillsAndCompetencies", "enquiries", "applications", "note", "links"].includes(key) ? 6000 : 160;
      input.addEventListener("input", () => {
        if (key === "links") {
          vacancy.links = input.value.split(/\r?\n/).map(line => {
            const value = line.trim();
            if (!value) return null;
            const match = value.match(/^(.*?)\s+\|\s+(https?:\/\/\S+)$/i);
            if (match) return { label: match[1].trim(), url: match[2].trim() };
            if (/^https?:\/\//i.test(value)) return { label: value, url: value };
            return { label: value, url: "" };
          }).filter(Boolean);
        } else {
          vacancy[key] = input.value.trim();
        }
      });
      field.append(fieldLabel, input);
      details.append(field);
    }
    detailsCell.append(details);
    row.append(detailsCell);
    importTableBody.append(row);
  }
  selectAllImport.checked = vacancies.length > 0 && vacancies.every(item => item.selected);
  selectAllImport.indeterminate = !selectAllImport.checked && vacancies.some(item => item.selected);
  updatePublishButton();
}

function appendEditableCell(row, vacancy, key, label) {
  const cell = document.createElement("td");
  const input = document.createElement("input");
  input.type = "text";
  input.value = vacancy[key] ?? "";
  input.maxLength = key === "title" || key === "company" || key === "location" ? 160 : 120;
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => {
    vacancy[key] = input.value.trim();
  });
  cell.append(input);
  row.append(cell);
}

function updatePublishButton() {
  const selectedCount = [...importedVacancies.values()].filter(job => job.selected).length;
  const button = document.querySelector("#publish-import");
  button.disabled = !adminToken || selectedCount === 0;
  button.textContent = selectedCount ? `Publish selected (${selectedCount})` : "Publish selected";
}

async function importPdfFile(file, sourceUrl = "", circularMetadata = null) {
  const extracted = await extractPdfText(file);
  const text = extracted.text;
  if (!text.replace(/__PAGE_\d+__/g, "").trim()) {
    throw new Error("No selectable text was found. This may be a scanned PDF; image-only PDFs need OCR and cannot be imported automatically.");
  }
  const { vacancies } = parseDpsaCircular(text, { fileName: file.name, sourceUrl, links: extracted.links });
  if (!vacancies.length) {
    throw new Error("No DPSA post headings were found. Check that this is a text-based DPSA vacancy circular.");
  }
  let added = 0;
  for (const vacancy of vacancies) {
    if (!importedVacancies.has(vacancy.id)) added++;
    importedVacancies.set(vacancy.id, {
      ...vacancy,
      ...(circularMetadata?.circularName ? { circularName: circularMetadata.circularName } : {}),
      ...(circularMetadata?.publishedDate ? { circularDate: circularMetadata.publishedDate } : {}),
      selected: false
    });
  }
  renderImportedVacancies();
  return { found: vacancies.length, added };
}

async function importFiles(files) {
  if (!files.length) return;
  setImportStatus(`Reading ${files.length} PDF${files.length === 1 ? "" : "s"}…`);
  const results = [];
  let successfulFiles = 0;
  let failedFiles = 0;
  for (const file of files) {
    try {
      const result = await importPdfFile(file);
      results.push(`${file.name}: ${result.found} vacancies`);
      successfulFiles++;
    } catch (error) {
      results.push(`${file.name}: ${error.message}`);
      failedFiles++;
    }
  }
  setImportStatus(results.join(" · "), failedFiles > 0 && successfulFiles === 0);
}

async function importDpsaUrl(url, circularMetadata = null) {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" || !["www.dpsa.gov.za", "dpsa.gov.za"].includes(parsedUrl.hostname) || !parsedUrl.pathname.toLowerCase().endsWith(".pdf")) {
    throw new Error("For safety, PDF links must be HTTPS PDFs hosted on dpsa.gov.za.");
  }
  await requestDpsaPermission(parsedUrl);
  const { file, url: sourceUrl } = await downloadDpsaPdf(parsedUrl.href);
  return importPdfFile(file, sourceUrl, circularMetadata);
}

function truncate(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

function createPublishedVacancy(vacancy) {
  const title = truncate(vacancy.title, 160);
  const company = truncate(vacancy.company, 160) || "Hiring department not identified";
  const location = truncate(vacancy.location, 160) || "South Africa";
  const salaryText = truncate(vacancy.salaryText || "Not stated in advert", 160);
  const closingDate = truncate(vacancy.closingDate, 120);
  const maxDetailLength = 6000;
  const existingDetails = {
    circularName: truncate(vacancy.circularName, 160),
    circularDate: truncate(vacancy.circularDate, 80),
    circularPage: truncate(vacancy.circularPage, 20),
    postNo: truncate(vacancy.postNo, 80),
    refNo: truncate(vacancy.refNo, 160),
    province: truncate(vacancy.province, 80),
    natureOfAppointment: truncate(vacancy.natureOfAppointment, 160),
    branch: truncate(vacancy.branch, maxDetailLength),
    chiefDirectorate: truncate(vacancy.chiefDirectorate, maxDetailLength),
    directorate: truncate(vacancy.directorate, maxDetailLength),
    cluster: truncate(vacancy.cluster, maxDetailLength),
    level: truncate(vacancy.level, 160),
    centre: truncate(vacancy.centre, maxDetailLength),
    closingDate,
    requirements: truncate(vacancy.requirements, maxDetailLength),
    duties: truncate(vacancy.duties, maxDetailLength),
    jobPurpose: truncate(vacancy.jobPurpose, maxDetailLength),
    skillsAndCompetencies: truncate(vacancy.skillsAndCompetencies, maxDetailLength),
    enquiries: truncate(vacancy.enquiries, maxDetailLength),
    applications: truncate(vacancy.applications, maxDetailLength),
    note: truncate(vacancy.note, maxDetailLength),
    links: [...new Map((Array.isArray(vacancy.links) ? vacancy.links : [])
      .filter(link => typeof link?.url === "string" && /^(?:https?:\/\/|mailto:|tel:)/i.test(link.url))
      .map(link => [link.url, {
        label: String(link.label || link.url).trim(),
        url: link.url
      }])).values()]
  };
  const sourceUrl = truncate(vacancy.sourceUrl, 2048);
  return {
    id: truncate(vacancy.id, 160),
    ...(sourceUrl ? { sourceUrl } : {}),
    title,
    company,
    location,
    category: vacancy.category,
    type: vacancy.type,
    salary: Number.isFinite(vacancy.salary) ? vacancy.salary : 0,
    salaryText,
    posted: closingDate ? `Closing date: ${closingDate}` : "Closing date: check official advert",
    logo: company.slice(0, 1).toLowerCase(),
    color: "#eaf1e2",
    logoColor: "#64803f",
    ...existingDetails
  };
}

function vacancyMatchKey(job) {
  const postIdentity = [job.postNo, job.refNo].filter(Boolean).join("|").toLowerCase();
  if (postIdentity) return `${job.sourceUrl ?? ""}|${postIdentity}`;
  return `${job.title}|${job.company}`.toLowerCase().replace(/\s+/g, " ").trim();
}

async function publishImportedVacancies() {
  if (!apiUrl || !adminToken) {
    showToast("Connect to your Worker before publishing imported jobs.", true);
    return;
  }
  const selected = [...importedVacancies.values()].filter(vacancy => vacancy.selected);
  if (!selected.length) {
    showToast("Select at least one vacancy to publish.", true);
    return;
  }
  const incomplete = selected.find(vacancy => !vacancy.title.trim() || !vacancy.company.trim() || !vacancy.location.trim());
  if (incomplete) {
    showToast(`Complete the title, department, and location for “${incomplete.title || "the selected vacancy"}” before publishing.`, true);
    return;
  }
  const invalidSource = selected.find(vacancy => {
    if (!vacancy.sourceUrl) return false;
    try {
      return new URL(vacancy.sourceUrl).protocol !== "https:";
    } catch {
      return true;
    }
  });
  if (invalidSource) {
    showToast(`Use a valid HTTPS official advert or circular URL for “${invalidSource.title}”.`, true);
    return;
  }
  const invalidPdfLink = selected.flatMap(vacancy => vacancy.links ?? []).find(link =>
    !link || typeof link.url !== "string" || link.url.length > 2048 ||
    typeof link.label !== "string" || link.label.length > 300 ||
    !/^(?:https?:\/\/|mailto:|tel:)/i.test(link.url)
  );
  const tooManyPdfLinks = selected.find(vacancy => Array.isArray(vacancy.links) && vacancy.links.length > 100);
  if (tooManyPdfLinks) {
    showToast(`“${tooManyPdfLinks.title}” has more than 100 extracted PDF links. Remove unrelated links before publishing.`, true);
    return;
  }
  if (invalidPdfLink) {
    showToast("A circular PDF link is invalid or too long. Review the extracted links before publishing.", true);
    return;
  }
  if (!confirm(`Publish ${selected.length} selected vacancies to your website? Existing jobs will be kept.`)) return;
  if (jobs.length > MAX_PUBLISHED_JOBS) {
    showToast(`The Worker currently has more than ${MAX_PUBLISHED_JOBS} jobs. Remove some listings before importing.`, true);
    return;
  }

  const byKey = new Map(jobs.map(job => [vacancyMatchKey(job), job]));
  const imported = selected.map(createPublishedVacancy);
  for (const vacancy of imported) byKey.set(vacancyMatchKey(vacancy), vacancy);
  const nextJobs = [...byKey.values()];
  if (nextJobs.length > MAX_PUBLISHED_JOBS) {
    showToast(`This import would exceed the ${MAX_PUBLISHED_JOBS}-job limit (${nextJobs.length}). Select fewer vacancies or remove existing jobs.`, true);
    return;
  }

  const button = document.querySelector("#publish-import");
  button.disabled = true;
  importProgress.hidden = false;
  publishProgress.value = 20;
  publishStatus.textContent = `Publishing ${selected.length} vacancies…`;
  try {
    await publishJobs(nextJobs);
    publishProgress.value = 100;
    publishStatus.textContent = `Published ${selected.length} vacancies. Existing listings were retained.`;
    showToast(`${selected.length} vacancies published.`);
  } catch (error) {
    publishProgress.value = 0;
    publishStatus.textContent = `Publish failed: ${error.message}`;
    showToast(`Could not publish imported vacancies: ${error.message}`, true);
  } finally {
    updatePublishButton();
  }
}

async function publishJobs(nextJobs) {
  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(nextJobs)
  });
  if (!response.ok) {
    let message = `Could not publish jobs (HTTP ${response.status}).`;
    try {
      const result = await response.json();
      if (typeof result.error === "string") message = result.error;
    } catch {
      // Use the HTTP status when the server does not return JSON.
    }
    throw new Error(message);
  }
  jobs = nextJobs;
  renderJobs();
  showToast("Changes published. Your website is up to date.");
}

function openEditor(job = null) {
  form.reset();
  document.querySelector("#job-id").value = job?.id ?? "";
  sourceUrlInput.value = job?.sourceUrl ?? "";
  sourceUrlInput.required = job ? Boolean(job.sourceUrl) : true;
  document.querySelector("#title").value = job?.title ?? "";
  document.querySelector("#company").value = job?.company ?? "";
  document.querySelector("#location").value = job?.location ?? "";
  document.querySelector("#category").value = job?.category ?? "Other";
  document.querySelector("#type").value = job?.type ?? "Permanent";
  document.querySelector("#salary").value = job?.salary ?? "";
  document.querySelector("#salary-text").value = job?.salaryText ?? "";
  document.querySelector("#posted").value = job?.posted ?? "Just posted";
  document.querySelector("#color").value = job?.color ?? "#eaf1e2";
  document.querySelector("#logo-color").value = job?.logoColor ?? "#64803f";
  document.querySelector("#form-title").textContent = job ? "Edit a job" : "Add a job";
  document.querySelector("#save-job").textContent = job ? "Save changes" : "Publish job";
  dialog.showModal();
}

connectionForm.addEventListener("submit", event => {
  event.preventDefault();
  connect(apiUrlInput.value.trim(), tokenInput.value, true);
});

document.querySelector("#change-connection").addEventListener("click", () => {
  connectionForm.hidden = false;
  connectedDetails.hidden = true;
});

forgetButton.addEventListener("click", async () => {
  if (!confirm("Forget the saved connection and admin key on this device?")) return;
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const origin = stored[SETTINGS_KEY]?.origin;
  await chrome.storage.local.remove(SETTINGS_KEY);
  if (origin) await chrome.permissions.remove({ origins: [`${origin}/*`] });
  apiUrl = undefined;
  adminToken = undefined;
  jobs = [];
  tokenInput.value = "";
  apiUrlInput.value = DEFAULT_API_URL;
  connectionForm.hidden = false;
  connectedDetails.hidden = true;
  forgetButton.hidden = true;
  connectionForm.classList.remove("connection-error");
  setConnected(false);
  jobSummary.textContent = "Connect to load your current listings.";
  renderJobs();
  showToast("Saved connection forgotten.");
});

document.querySelector("#add-job").addEventListener("click", () => {
  if (adminToken) openEditor();
  else showToast("Connect to your Worker before adding a job.", true);
});
refreshButton.addEventListener("click", async () => {
  if (!apiUrl || !adminToken) {
    showToast("Connect to your Worker before refreshing jobs.", true);
    return;
  }
  refreshButton.disabled = true;
  try {
    jobs = await readJobs(apiUrl, adminToken);
    renderJobs();
    showToast("Job list refreshed.");
  } catch (error) {
    showToast(`Could not refresh jobs: ${error.message}`, true);
  } finally {
    refreshButton.disabled = false;
  }
});
document.querySelector("#cancel-edit").addEventListener("click", () => dialog.close());
document.querySelector("#cancel-form").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => {
  if (event.target === dialog) dialog.close();
});
document.querySelectorAll(".filter-chip").forEach(button => button.addEventListener("click", () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll(".filter-chip").forEach(chip => chip.classList.toggle("active", chip === button));
  renderJobs();
}));
jobSearch.addEventListener("input", renderJobs);
sortJobs.addEventListener("change", renderJobs);

form.addEventListener("submit", async event => {
  event.preventDefault();
  const id = document.querySelector("#job-id").value || crypto.randomUUID();
  const title = document.querySelector("#title").value.trim();
  const sourceUrl = sourceUrlInput.value.trim();
  const job = {
    id,
    ...(sourceUrl ? { sourceUrl } : {}),
    title,
    company: document.querySelector("#company").value.trim(),
    location: document.querySelector("#location").value.trim(),
    category: document.querySelector("#category").value,
    type: document.querySelector("#type").value,
    salary: Number(document.querySelector("#salary").value),
    salaryText: document.querySelector("#salary-text").value.trim(),
    posted: document.querySelector("#posted").value.trim(),
    logo: title.slice(0, 1).toLowerCase(),
    color: document.querySelector("#color").value,
    logoColor: document.querySelector("#logo-color").value
  };
  const nextJobs = jobs.some(candidate => candidate.id === id)
    ? jobs.map(candidate => candidate.id === id ? job : candidate)
    : [job, ...jobs];
  const saveButton = document.querySelector("#save-job");
  saveButton.disabled = true;
  try {
    await publishJobs(nextJobs);
    dialog.close();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

async function initialize() {
  apiUrlInput.value = DEFAULT_API_URL;
  setConnected(false);
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY];
  if (!settings?.apiUrl || !settings?.adminToken) return;

  forgetButton.hidden = false;
  apiUrlInput.value = settings.apiUrl;
  await connect(settings.apiUrl, settings.adminToken, false);
}

initialize().catch(error => showToast(`Could not load saved settings: ${error.message}`, true));

pdfFilesInput.addEventListener("change", async () => {
  await importFiles([...pdfFilesInput.files]);
  pdfFilesInput.value = "";
});

document.querySelector("#load-pdf-url").addEventListener("click", async event => {
  const button = event.currentTarget;
  const url = pdfUrlInput.value.trim();
  if (!url) {
    setImportStatus("Paste an official DPSA PDF URL first.", true);
    return;
  }
  button.disabled = true;
  setImportStatus("Loading the DPSA PDF…");
  try {
    const result = await importDpsaUrl(url);
    setImportStatus(`Loaded ${result.found} vacancies from the DPSA PDF.`);
  } catch (error) {
    setImportStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#discover-circulars").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  circularPicker.disabled = true;
  loadCircularButton.disabled = true;
  setImportStatus("Checking the official DPSA circular page…");
  try {
    await requestDpsaPermission(new URL("https://www.dpsa.gov.za/"));
    const discovery = await discoverDpsaCirculars();
    circularOptions = discovery.circulars;
    circularPicker.replaceChildren();
    if (!circularOptions.length) {
      circularPicker.add(new Option("No PDF circulars found", ""));
      setImportStatus("No PDF circular links were found on the DPSA page.");
    } else {
      circularPicker.add(new Option("Choose a circular…", ""));
      circularOptions.forEach((circular, index) => circularPicker.add(new Option(circular.label, String(index))));
      circularPicker.disabled = false;
      const partialWarning = discovery.warnings.length
        ? ` ${discovery.warnings.join(" ")}`
        : "";
      setImportStatus(`Found the ${circularOptions.length} most recent PDF circular${circularOptions.length === 1 ? "" : "s"}.${partialWarning}`, discovery.warnings.length > 0);
    }
  } catch (error) {
    setImportStatus(error.message, true);
    circularPicker.replaceChildren(new Option("Could not load circulars", ""));
  } finally {
    button.disabled = false;
  }
});

circularPicker.addEventListener("change", () => {
  loadCircularButton.disabled = !circularPicker.value;
});

loadCircularButton.addEventListener("click", async () => {
  const circular = circularOptions[Number(circularPicker.value)];
  if (!circular) return;
  loadCircularButton.disabled = true;
  setImportStatus(`Loading ${circular.label}…`);
  try {
    const result = await importDpsaUrl(circular.url, circular);
    setImportStatus(`Loaded ${result.found} vacancies from ${circular.label}.`);
  } catch (error) {
    setImportStatus(error.message, true);
  } finally {
    loadCircularButton.disabled = !circularPicker.value;
  }
});

selectAllImport.addEventListener("change", () => {
  for (const vacancy of importedVacancies.values()) vacancy.selected = selectAllImport.checked;
  renderImportedVacancies();
});

document.querySelector("#export-excel").addEventListener("click", () => {
  if (!importedVacancies.size) {
    showToast("Import a DPSA circular before exporting.", true);
    return;
  }
  try {
    const rows = [...importedVacancies.values()].map(({ selected, ...vacancy }) => ({
    Selected: selected ? "Yes" : "No",
    "Circular": vacancy.circularName,
    "Circular date": vacancy.circularDate,
    "Circular page": vacancy.circularPage,
    "Post number": vacancy.postNo,
    "Reference number": vacancy.refNo,
    "Job title": vacancy.title,
    Department: vacancy.company,
    Location: vacancy.location,
    Province: vacancy.province,
    "Employment type": vacancy.type,
    "Nature of appointment": vacancy.natureOfAppointment,
    "Salary / stipend": vacancy.salaryText,
    "Closing date": vacancy.closingDate,
    "Job level": vacancy.level,
    Branch: vacancy.branch,
    Directorate: vacancy.directorate,
    "Chief directorate": vacancy.chiefDirectorate,
    Cluster: vacancy.cluster,
    Centre: vacancy.centre,
    Requirements: vacancy.requirements,
    Duties: vacancy.duties,
    "Job purpose": vacancy.jobPurpose,
    "Skills and competencies": vacancy.skillsAndCompetencies,
    Enquiries: vacancy.enquiries,
    Applications: vacancy.applications,
    Notes: vacancy.note,
    "PDF hyperlinks": (vacancy.links ?? []).map(link => `${link.label} | ${link.url}`).join("\n"),
    "Official circular URL": vacancy.sourceUrl
    }));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, "DPSA vacancies");
    XLSX.writeFile(workbook, "dpsa-vacancies.xlsx");
  } catch (error) {
    showToast(`Could not create the Excel file: ${error.message}`, true);
  }
});

document.querySelector("#clear-import").addEventListener("click", () => {
  if (importedVacancies.size && !confirm("Clear all imported vacancies from this review? Published jobs will not be removed.")) return;
  importedVacancies.clear();
  importProgress.hidden = true;
  publishProgress.value = 0;
  publishStatus.textContent = "";
  setImportStatus("Import cleared.");
  renderImportedVacancies();
});

document.querySelector("#publish-import").addEventListener("click", publishImportedVacancies);

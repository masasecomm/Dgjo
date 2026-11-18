import * as XLSX from "@e965/xlsx";
import {
  discoverDpsaCirculars,
  downloadDpsaPdf,
  extractPdfText,
  parseDpsaCircular
} from "./importer.js";
import {
  circularPublicationStatus,
  compareCircularDates,
  comparePostNumbers,
  createPublishedVacancy,
  displayVacancyTitle,
  getCircularVacancies,
  mergeVacancyLinks,
  sanitizePublishedJob,
  vacancyLinkMatchesText,
  vacancyMatchKey
} from "./publication.js";
import {
  canonicalCircularName,
  compareCircularNames,
  groupJobsByCircular,
  MAX_ACTIVE_CIRCULARS,
  retainLatestCircularJobs
} from "../circulars.js";

const DEFAULT_API_URL = "https://goodwork-jobs-api.dpsajobs.workers.dev/api/jobs";
const SETTINGS_KEY = "goodworkAdminSettings";
const MAX_PUBLISHED_JOBS = 6000;
const MAX_JOB_LINKS = 100;
const apiUrlInput = document.querySelector("#api-url");
const tokenInput = document.querySelector("#admin-token");
const sourceUrlInput = document.querySelector("#source-url");
const connectionForm = document.querySelector("#connection-form");
const connectButton = document.querySelector("#connect");
const refreshButton = document.querySelector("#refresh-jobs");
const forgetButton = document.querySelector("#forget-credentials");
const autoPublishToggle = document.querySelector("#auto-publish-toggle");
const autoPublishStatus = document.querySelector("#auto-publish-status");
const autoPublishHistory = document.querySelector("#auto-publish-history");
const connectionBadge = document.querySelector("#connection-badge");
const connectedDetails = document.querySelector("#connected-details");
const connectedUrl = document.querySelector("#connected-url");
const jobSearch = document.querySelector("#job-search");
const sortJobs = document.querySelector("#sort-jobs");
const jobList = document.querySelector("#job-list");
const jobSummary = document.querySelector("#job-summary");
const circularFilter = document.querySelector("#circular-filter");
const selectAllJobs = document.querySelector("#select-all-jobs");
const selectionCount = document.querySelector("#selection-count");
const editSelectedButton = document.querySelector("#edit-selected");
const deleteSelectedButton = document.querySelector("#delete-selected");
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
const selectedJobIds = new Set();
let toastTimer;
const importedVacancies = new Map();
let circularOptions = [];
let activeCircularName = "";
let publishInProgress = false;
let autoPublishBusy = false;

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
  autoPublishToggle.disabled = !connected || autoPublishBusy;
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

async function requestAutomation(path, method = "GET", body) {
  const endpoint = new URL(apiUrl);
  endpoint.pathname = `/api/automation/${path}`;
  endpoint.search = "";
  endpoint.hash = "";
  const response = await fetch(endpoint, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    let message = `Could not load automatic publishing data (HTTP ${response.status}).`;
    try {
      const result = await response.json();
      if (typeof result.error === "string") message = result.error;
    } catch {
      // Use the HTTP status when the server does not return JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

function renderAutoPublishHistory(publications) {
  autoPublishHistory.replaceChildren();
  if (!publications.length) {
    const empty = document.createElement("li");
    empty.className = "automation-empty";
    empty.textContent = "No circulars have been auto-published yet.";
    autoPublishHistory.append(empty);
    return;
  }
  for (const publication of publications.slice(0, 20)) {
    const item = document.createElement("li");
    const circular = document.createElement("strong");
    circular.textContent = `Auto-published ${publication.circularName}`;
    const timestamp = new Date(publication.publishedAt);
    const time = document.createElement("time");
    time.dateTime = publication.publishedAt;
    time.textContent = Number.isNaN(timestamp.getTime())
      ? publication.publishedAt
      : `${timestamp.toLocaleString("en-ZA", {
        timeZone: "Africa/Johannesburg",
        dateStyle: "medium",
        timeStyle: "short"
      })} SAST`;
    item.append(circular, document.createTextNode(" — "), time);
    if (Number.isInteger(publication.jobCount)) {
      item.append(document.createTextNode(` (${publication.jobCount} vacancies)`));
    }
    autoPublishHistory.append(item);
  }
}

async function refreshAutomationPanel() {
  if (!apiUrl || !adminToken) return;
  autoPublishBusy = true;
  autoPublishToggle.disabled = true;
  autoPublishStatus.classList.remove("error");
  autoPublishStatus.textContent = "Loading automatic publishing settings and history…";
  try {
    const [settings, history] = await Promise.all([
      requestAutomation("settings"),
      requestAutomation("publications")
    ]);
    if (typeof settings?.enabled !== "boolean" || !Array.isArray(history?.publications)) {
      throw new Error("The Worker returned invalid automatic publishing data.");
    }
    autoPublishToggle.checked = settings.enabled;
    autoPublishStatus.textContent = settings.enabled
      ? "Auto publish is on. The Friday monitor will check for new DPSA circulars."
      : "Auto publish is off. Turn it on here to enable the Friday circular monitor.";
    renderAutoPublishHistory(history.publications);
  } catch (error) {
    autoPublishStatus.classList.add("error");
    autoPublishStatus.textContent = `Could not load auto-publish settings: ${error.message}`;
    renderAutoPublishHistory([]);
  } finally {
    autoPublishBusy = false;
    autoPublishToggle.disabled = !adminToken;
  }
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
    selectedJobIds.clear();
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
    renderImportedVacancies();
    await refreshAutomationPanel();
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

function updateCircularFilterOptions() {
  const selectedCircular = circularFilter.value;
  const groups = groupJobsByCircular(jobs)
    .sort((left, right) => compareCircularNames(right.name, left.name));
  circularFilter.replaceChildren(new Option("All published posts", ""));
  for (const group of groups) {
    circularFilter.add(new Option(`${group.name} (${group.jobs.length})`, group.name));
  }
  circularFilter.value = groups.some(group => group.name === selectedCircular) ? selectedCircular : "";
  circularFilter.disabled = !adminToken || groups.length === 0;
}

function getVisibleJobs() {
  const query = jobSearch.value.trim().toLowerCase();
  const selectedCircular = circularFilter.value;
  const filtered = jobs.filter(job => {
    const matchesCircular = !selectedCircular || canonicalCircularName(job.circularName) === selectedCircular;
    const searchable = [
      job.title, job.company, job.location, job.postNo, job.refNo, job.circularName,
      job.category, job.type
    ].join(" ").toLowerCase();
    return matchesCircular && (!query || searchable.includes(query));
  });
  if (sortJobs.value === "recent") return filtered;
  if (sortJobs.value === "date-newest") {
    filtered.sort((a, b) =>
      compareCircularDates(a.circularDate, b.circularDate) ||
      compareCircularNames(canonicalCircularName(b.circularName), canonicalCircularName(a.circularName)) ||
      comparePostNumbers(a.postNo, b.postNo)
    );
  } else if (sortJobs.value === "title-asc" || sortJobs.value === "title-desc") {
    const direction = sortJobs.value === "title-asc" ? 1 : -1;
    filtered.sort((a, b) =>
      direction * displayVacancyTitle(a.title).localeCompare(displayVacancyTitle(b.title), "en-ZA", {
        numeric: true,
        sensitivity: "base"
      })
    );
  } else {
    filtered.sort((a, b) =>
      compareCircularNames(canonicalCircularName(b.circularName), canonicalCircularName(a.circularName)) ||
      comparePostNumbers(a.postNo, b.postNo) ||
      displayVacancyTitle(a.title).localeCompare(displayVacancyTitle(b.title))
    );
  }
  return filtered;
}

function updateSelectionControls(visibleJobs) {
  const visibleSelectedCount = visibleJobs.filter(job => selectedJobIds.has(job.id)).length;
  const selectedCount = selectedJobIds.size;
  selectAllJobs.checked = visibleJobs.length > 0 && visibleSelectedCount === visibleJobs.length;
  selectAllJobs.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleJobs.length;
  selectAllJobs.disabled = !adminToken || visibleJobs.length === 0;
  selectionCount.textContent = `${selectedCount} selected`;
  editSelectedButton.disabled = !adminToken || selectedCount !== 1;
  deleteSelectedButton.disabled = !adminToken || selectedCount === 0;
  deleteSelectedButton.textContent = selectedCount ? `Delete selected (${selectedCount})` : "Delete selected";
}

function renderJobs() {
  updateCircularFilterOptions();
  const filtered = getVisibleJobs();
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
    message.textContent = jobs.length ? "Try a different search or circular." : "Add your first listing to get started.";
    empty.append(icon, title, message);
    jobList.append(empty);
    updateSelectionControls(filtered);
    return;
  }

  filtered.forEach(job => {
    const card = document.createElement("article");
    card.className = "job-card";

    const selectLabel = document.createElement("label");
    selectLabel.className = "job-select-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "job-select";
    checkbox.dataset.jobId = job.id;
    checkbox.checked = selectedJobIds.has(job.id);
    checkbox.setAttribute("aria-label", `Select Post ${job.postNo || "number not stated"}: ${displayVacancyTitle(job.title)}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedJobIds.add(job.id);
      else selectedJobIds.delete(job.id);
      updateSelectionControls(getVisibleJobs());
    });
    selectLabel.append(checkbox);

    const details = document.createElement("div");
    details.className = "job-details";

    const title = document.createElement("h3");
    title.textContent = displayVacancyTitle(job.title);
    const metadata = document.createElement("div");
    metadata.className = "job-metadata";
    const postNumber = document.createElement("span");
    postNumber.className = "job-post-number";
    postNumber.textContent = `Post ${job.postNo || "number not stated"}`;
    metadata.append(postNumber);
    if (job.circularName) {
      const circular = document.createElement("span");
      circular.textContent = canonicalCircularName(job.circularName);
      metadata.append(circular);
    }
    const department = document.createElement("span");
    department.textContent = job.company || "Department not stated";
    metadata.append(department);
    if (job.location) {
      const location = document.createElement("span");
      location.textContent = job.location;
      metadata.append(location);
    }
    details.append(title, metadata);

    const actions = document.createElement("div");
    actions.className = "job-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openEditor(job));
    actions.append(edit);
    card.append(selectLabel, details, actions);
    jobList.append(card);
  });
  updateSelectionControls(filtered);
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

function circularOptionLabel(circular) {
  if (!adminToken) return `${circular.label} · Connect to check publication status`;
  const status = circularPublicationStatus(circular.circularName || circular.label, [], jobs);
  const publicationLabel = status.publishedCount
    ? `Published (${status.publishedCount} posts; republish available)`
    : "Not published";
  return `${circular.label} · ${publicationLabel}`;
}

function updateCircularOptionLabels() {
  circularOptions.forEach((circular, index) => {
    const option = circularPicker.options[index + 1];
    if (option) option.textContent = circularOptionLabel(circular);
  });
}

function renderImportedVacancies() {
  const vacancies = [...importedVacancies.values()];
  updateCircularOptionLabels();
  importResults.hidden = vacancies.length === 0;
  importCount.textContent = `${vacancies.length} ${vacancies.length === 1 ? "vacancy" : "vacancies"} found`;
  const sourceSummary = vacancies.length > 200
    ? `Showing the first 200 here. Excel export and publishing include all ${vacancies.length}.`
    : `${new Set(vacancies.map(job => job.circularName)).size} circular${new Set(vacancies.map(job => job.circularName)).size === 1 ? "" : "s"} loaded`;
  const publicationStatus = activeCircularName
    ? circularPublicationStatus(activeCircularName, vacancies, jobs)
    : null;
  let circularStatusText = "";
  if (publicationStatus?.importedCount) {
    if (!adminToken) {
      circularStatusText = ` Connect to check whether ${activeCircularName} is published.`;
    } else if (publicationStatus.alreadyPublishedCount === publicationStatus.importedCount) {
      circularStatusText = ` ${activeCircularName} is published (${publicationStatus.alreadyPublishedCount}/${publicationStatus.importedCount} imported posts); republish all is available.`;
    } else if (publicationStatus.alreadyPublishedCount) {
      circularStatusText = ` ${activeCircularName} is published; ${publicationStatus.alreadyPublishedCount}/${publicationStatus.importedCount} imported posts already match. Republish all to update or add every post.`;
    } else if (publicationStatus.publishedCount) {
      circularStatusText = ` ${activeCircularName} is already published (${publicationStatus.publishedCount} posts); republish this import to add these vacancies.`;
    } else {
      circularStatusText = ` ${activeCircularName} is not published yet.`;
    }
  }
  importSources.textContent = `${sourceSummary}${circularStatusText}`;
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
  const selectedButton = document.querySelector("#publish-import");
  const allButton = document.querySelector("#publish-all-import");
  const circularVacancies = activeCircularName
    ? getCircularVacancies(importedVacancies.values(), activeCircularName)
    : [...importedVacancies.values()];
  const publicationStatus = activeCircularName
    ? circularPublicationStatus(activeCircularName, circularVacancies, jobs)
    : {
        publishedCount: circularVacancies.filter(vacancy =>
          jobs.some(job => vacancyMatchKey(job) === vacancyMatchKey(vacancy))
        ).length
      };
  selectedButton.disabled = !adminToken || selectedCount === 0 || publishInProgress;
  selectedButton.textContent = selectedCount ? `Publish selected (${selectedCount})` : "Publish selected";
  allButton.disabled = !adminToken || circularVacancies.length === 0 || publishInProgress;
  allButton.textContent = publicationStatus.publishedCount
    ? `Republish all (${circularVacancies.length})`
    : `Publish all (${circularVacancies.length})`;
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
  const circularNames = [...new Set([...importedVacancies.values()].map(vacancy => vacancy.circularName).filter(Boolean))];
  activeCircularName = circularMetadata?.circularName || (circularNames.length === 1 ? circularNames[0] : "");
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

async function publishImportedVacancies(publishAll = false) {
  if (!apiUrl || !adminToken) {
    showToast("Connect to your Worker before publishing imported jobs.", true);
    return;
  }
  const circularVacancies = activeCircularName
    ? getCircularVacancies(importedVacancies.values(), activeCircularName)
    : [...importedVacancies.values()];
  const selected = publishAll
    ? circularVacancies
    : [...importedVacancies.values()].filter(vacancy => vacancy.selected);
  if (!selected.length) {
    showToast(publishAll ? "Import a circular before publishing all vacancies." : "Select at least one vacancy to publish.", true);
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
  const tooManyPdfLinks = selected.find(vacancy => Array.isArray(vacancy.links) && vacancy.links.length > MAX_JOB_LINKS);
  if (tooManyPdfLinks) {
    showToast(`“${tooManyPdfLinks.title}” has more than 100 extracted PDF links. Remove unrelated links before publishing.`, true);
    return;
  }
  if (invalidPdfLink) {
    showToast("A circular PDF link is invalid or too long. Review the extracted links before publishing.", true);
    return;
  }
  const matchingPublishedCount = selected.filter(vacancy =>
    jobs.some(job => vacancyMatchKey(job) === vacancyMatchKey(vacancy))
  ).length;
  const circularAlreadyPublished = publishAll && activeCircularName
    ? circularPublicationStatus(activeCircularName, selected, jobs).publishedCount > 0
    : false;
  const isRepublish = circularAlreadyPublished || matchingPublishedCount > 0;
  const action = isRepublish ? "Republish" : "Publish";
  const targetDescription = publishAll
    ? `all ${selected.length} imported vacancies from ${activeCircularName || "this import"}`
    : `${selected.length} selected vacancies`;

  const byKey = new Map(jobs.map(job => [vacancyMatchKey(job), job]));
  const imported = selected.map(createPublishedVacancy);
  for (const vacancy of imported) {
    const key = vacancyMatchKey(vacancy);
    const existing = byKey.get(key);
    if (existing) {
      const existingText = [
        existing.title, existing.requirements, existing.duties, existing.jobPurpose,
        existing.skillsAndCompetencies, existing.enquiries, existing.applications, existing.note
      ].join("\n");
      const supportedExistingLinks = (existing.links ?? [])
        .filter(link => vacancyLinkMatchesText(link, existingText));
      vacancy.links = mergeVacancyLinks(supportedExistingLinks, vacancy.links);
      if (existing.sourceUrl && vacancy.sourceUrl && existing.sourceUrl !== vacancy.sourceUrl &&
          !vacancy.links.some(link => link.url === existing.sourceUrl)) {
        vacancy.links = mergeVacancyLinks(vacancy.links, [{
          label: "Previous official advert or circular",
          url: existing.sourceUrl
        }]);
      }
      if (!vacancy.sourceUrl && existing.sourceUrl) vacancy.sourceUrl = existing.sourceUrl;
    }
    if (vacancy.links.length > MAX_JOB_LINKS) {
      showToast(`Republishing “${vacancy.title}” would exceed the ${MAX_JOB_LINKS}-link limit. Reduce the new links, then try again; existing links are preserved.`, true);
      return;
    }
    byKey.set(key, vacancy);
  }
  const nextJobs = [...byKey.values()];
  const retained = retainLatestCircularJobs(nextJobs);
  const selectedKeys = new Set(imported.map(vacancyMatchKey));
  if (!retained.jobs.some(job => selectedKeys.has(vacancyMatchKey(job)))) {
    showToast(`This circular is older than the ${MAX_ACTIVE_CIRCULARS} circulars kept on the website, so its posts cannot be published.`, true);
    return;
  }
  if (retained.jobs.length > MAX_PUBLISHED_JOBS) {
    showToast(`This import would exceed the ${MAX_PUBLISHED_JOBS}-job limit (${retained.jobs.length}). Select fewer vacancies or remove existing jobs.`, true);
    return;
  }
  const deletionWarning = retained.removedCircularNames.length
    ? ` Existing jobs outside ${retained.removedCircularNames.join(", ")} will be kept; those circulars and all their posts will be permanently deleted to keep only the latest ${MAX_ACTIVE_CIRCULARS}.`
    : " Existing jobs will be kept.";
  if (!confirm(`${action} ${targetDescription} to your website?${deletionWarning}`)) return;

  publishInProgress = true;
  updatePublishButton();
  importProgress.hidden = false;
  publishProgress.value = 20;
  publishStatus.textContent = `Publishing ${selected.length} vacancies…`;
  try {
    const result = await publishJobs(retained.jobs);
    publishProgress.value = 100;
    const expiryNotice = result.removedExpiredCount
      ? ` Removed ${result.removedExpiredCount} expired posts.`
      : "";
    publishStatus.textContent = `Published ${selected.length} vacancies.${expiryNotice}`;
    showToast(`${selected.length} vacancies published.${expiryNotice}`);
  } catch (error) {
    publishProgress.value = 0;
    publishStatus.textContent = `Publish failed: ${error.message}`;
    showToast(`Could not publish imported vacancies: ${error.message}`, true);
  } finally {
    publishInProgress = false;
    updatePublishButton();
    renderImportedVacancies();
  }
}

async function publishJobs(nextJobs) {
  const publishableJobs = nextJobs.map(sanitizePublishedJob);
  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(publishableJobs)
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
  const result = await response.json();
  if (!result || result.success !== true || !Array.isArray(result.removedJobIds)) {
    throw new Error("The Worker returned an invalid publish result.");
  }
  const removedIds = new Set(result.removedJobIds);
  jobs = publishableJobs.filter(job => !removedIds.has(job.id));
  const remainingIds = new Set(jobs.map(job => job.id));
  for (const id of selectedJobIds) {
    if (!remainingIds.has(id)) selectedJobIds.delete(id);
  }
  renderJobs();
  renderImportedVacancies();
  const removedCirculars = Array.isArray(result.removedCircularNames) ? result.removedCircularNames : [];
  showToast(removedCirculars.length
    ? `Changes published. Removed ${removedCirculars.join(", ")} and their posts.`
    : "Changes published. Your website is up to date.");
  return result;
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
  selectedJobIds.clear();
  tokenInput.value = "";
  apiUrlInput.value = DEFAULT_API_URL;
  connectionForm.hidden = false;
  connectedDetails.hidden = true;
  forgetButton.hidden = true;
  connectionForm.classList.remove("connection-error");
  setConnected(false);
  autoPublishToggle.checked = false;
  autoPublishStatus.classList.remove("error");
  autoPublishStatus.textContent = "Connect to the Worker to manage automatic publishing.";
  renderAutoPublishHistory([]);
  jobSummary.textContent = "Connect to load your current listings.";
  renderJobs();
  renderImportedVacancies();
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
    selectedJobIds.clear();
    renderJobs();
    renderImportedVacancies();
    await refreshAutomationPanel();
    showToast("Job list refreshed.");
  } catch (error) {
    showToast(`Could not refresh jobs: ${error.message}`, true);
  } finally {
    refreshButton.disabled = false;
  }
});
autoPublishToggle.addEventListener("change", async () => {
  const enabled = autoPublishToggle.checked;
  autoPublishBusy = true;
  autoPublishToggle.disabled = true;
  autoPublishStatus.classList.remove("error");
  autoPublishStatus.textContent = "Saving automatic publishing setting…";
  try {
    const result = await requestAutomation("settings", "PUT", { enabled });
    if (result?.success !== true || result.enabled !== enabled) {
      throw new Error("The Worker did not confirm the requested setting.");
    }
    autoPublishStatus.textContent = enabled
      ? "Auto publish is on. The Friday monitor will check for new DPSA circulars."
      : "Auto publish is off. The Friday circular monitor will skip publishing.";
  } catch (error) {
    autoPublishToggle.checked = !enabled;
    autoPublishStatus.classList.add("error");
    autoPublishStatus.textContent = `Could not save auto-publish setting: ${error.message}`;
  } finally {
    autoPublishBusy = false;
    autoPublishToggle.disabled = !adminToken;
  }
});
document.querySelector("#cancel-edit").addEventListener("click", () => dialog.close());
document.querySelector("#cancel-form").addEventListener("click", () => dialog.close());
dialog.addEventListener("click", event => {
  if (event.target === dialog) dialog.close();
});
jobSearch.addEventListener("input", renderJobs);
sortJobs.addEventListener("change", renderJobs);
circularFilter.addEventListener("change", () => {
  selectedJobIds.clear();
  renderJobs();
});
selectAllJobs.addEventListener("change", () => {
  const visibleJobs = getVisibleJobs();
  for (const job of visibleJobs) {
    if (selectAllJobs.checked) selectedJobIds.add(job.id);
    else selectedJobIds.delete(job.id);
  }
  jobList.querySelectorAll(".job-select").forEach(checkbox => {
    checkbox.checked = selectedJobIds.has(checkbox.dataset.jobId);
  });
  updateSelectionControls(visibleJobs);
});
editSelectedButton.addEventListener("click", () => {
  const selectedJob = jobs.find(job => selectedJobIds.has(job.id));
  if (selectedJob && selectedJobIds.size === 1) openEditor(selectedJob);
});
deleteSelectedButton.addEventListener("click", async () => {
  const selectedJobs = jobs.filter(job => selectedJobIds.has(job.id));
  if (!selectedJobs.length) return;
  if (!confirm(`Remove all ${selectedJobs.length} selected ${selectedJobs.length === 1 ? "post" : "posts"} from the website? This cannot be undone.`)) return;
  deleteSelectedButton.disabled = true;
  try {
    await publishJobs(jobs.filter(job => !selectedJobIds.has(job.id)));
    selectedJobIds.clear();
    renderJobs();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    deleteSelectedButton.disabled = false;
    renderJobs();
  }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const id = document.querySelector("#job-id").value || crypto.randomUUID();
  const existingJob = jobs.find(candidate => candidate.id === id);
  const title = document.querySelector("#title").value.trim();
  const sourceUrl = sourceUrlInput.value.trim();
  const job = {
    ...(existingJob ?? {}),
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
      circularOptions.forEach((circular, index) =>
        circularPicker.add(new Option(circularOptionLabel(circular), String(index)))
      );
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
  activeCircularName = "";
  importProgress.hidden = true;
  publishProgress.value = 0;
  publishStatus.textContent = "";
  setImportStatus("Import cleared.");
  renderImportedVacancies();
});

document.querySelector("#publish-import").addEventListener("click", () => publishImportedVacancies(false));
document.querySelector("#publish-all-import").addEventListener("click", () => publishImportedVacancies(true));

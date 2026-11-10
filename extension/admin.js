const DEFAULT_API_URL = "https://goodwork-jobs-api.dpsajobs.workers.dev/api/jobs";
const SETTINGS_KEY = "goodworkAdminSettings";
const apiUrlInput = document.querySelector("#api-url");
const tokenInput = document.querySelector("#admin-token");
const connectionForm = document.querySelector("#connection-form");
const connectButton = document.querySelector("#connect");
const forgetButton = document.querySelector("#forget-credentials");
const connectionBadge = document.querySelector("#connection-badge");
const jobSearch = document.querySelector("#job-search");
const sortJobs = document.querySelector("#sort-jobs");
const jobList = document.querySelector("#job-list");
const jobSummary = document.querySelector("#job-summary");
const dialog = document.querySelector("#job-dialog");
const form = document.querySelector("#job-form");
const toast = document.querySelector("#toast");
let apiUrl;
let adminToken;
let jobs = [];
let activeFilter = "All";
let toastTimer;

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
    setConnected(true);
    forgetButton.hidden = false;
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
  document.querySelector("#title").value = job?.title ?? "";
  document.querySelector("#company").value = job?.company ?? "";
  document.querySelector("#location").value = job?.location ?? "";
  document.querySelector("#category").value = job?.category ?? "Design";
  document.querySelector("#type").value = job?.type ?? "Full-time";
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
  const job = {
    id,
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

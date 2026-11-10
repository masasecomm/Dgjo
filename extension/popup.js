const apiUrlInput = document.querySelector("#api-url");
const tokenInput = document.querySelector("#admin-token");
const connectButton = document.querySelector("#connect");
const manager = document.querySelector("#manager");
const jobList = document.querySelector("#job-list");
const form = document.querySelector("#job-form");
const statusMessage = document.querySelector("#status");
let apiUrl;
let adminToken;
let jobs = [];

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function validateApiUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.pathname.endsWith("/api/jobs") || url.username || url.password) {
    throw new Error("Enter the HTTPS Cloudflare Worker URL ending in /api/jobs.");
  }
  return url;
}

async function requestPermission(url) {
  const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
  if (!granted) throw new Error("Allow access to your Cloudflare Worker to continue.");
}

async function fetchJobs() {
  const response = await fetch(apiUrl, { headers: { Authorization: `Bearer ${adminToken}` } });
  if (!response.ok) throw new Error(`Could not load jobs (HTTP ${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("The Worker returned an invalid job list.");
  jobs = data;
  renderJobs();
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
  setStatus("Changes published. The website will show them right away.");
}

function renderJobs() {
  jobList.replaceChildren();
  if (!jobs.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No jobs yet. Add your first listing.";
    jobList.append(empty);
    return;
  }
  jobs.forEach(job => {
    const item = document.createElement("div");
    item.className = "job-item";
    const details = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = job.title;
    const company = document.createElement("small");
    company.textContent = `${job.company} · ${job.location}`;
    details.append(title, company);
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
        setStatus(error.message, true);
      } finally {
        remove.disabled = false;
      }
    });
    actions.append(edit, remove);
    item.append(details, actions);
    jobList.append(item);
  });
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
  form.hidden = false;
}

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  try {
    apiUrl = validateApiUrl(apiUrlInput.value.trim());
    adminToken = tokenInput.value;
    if (!adminToken) throw new Error("Enter your Worker admin key.");
    await requestPermission(apiUrl);
    await fetchJobs();
    tokenInput.value = "";
    manager.hidden = false;
    setStatus("Connected securely. Your admin key is not saved.");
  } catch (error) {
    adminToken = undefined;
    setStatus(error.message, true);
  } finally {
    connectButton.disabled = false;
  }
});

document.querySelector("#add-job").addEventListener("click", () => openEditor());
document.querySelector("#cancel-edit").addEventListener("click", () => { form.hidden = true; });

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
    form.hidden = true;
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

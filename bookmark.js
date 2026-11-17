const STORAGE_KEY = "dpsa-saved-vacancies";
const SAVED_VACANCY_HOSTS = new Set(["dpsagovernmentjobs.co.za", "www.dpsagovernmentjobs.co.za", "jobs.dpsagovernmentjobs.co.za"]);

function getSavedVacancies() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const vacancies = JSON.parse(stored);
    if (!Array.isArray(vacancies)) {
      console.error("Saved vacancies data is not a list.");
      return null;
    }
    return vacancies.filter(vacancy =>
      vacancy &&
      typeof vacancy.url === "string" &&
      typeof vacancy.title === "string"
    );
  } catch (error) {
    console.error("Could not read saved vacancies.", error);
    return null;
  }
}

function updateBookmark(button, saved) {
  const isSaved = saved.some(vacancy => vacancy.url === button.dataset.bookmarkUrl);
  const title = button.dataset.bookmarkTitle;
  button.setAttribute("aria-pressed", String(isSaved));
  button.setAttribute("aria-label", `${isSaved ? "Remove" : "Save"} ${title} ${isSaved ? "from" : "to"} saved vacancies`);
  button.title = isSaved ? "Remove from saved vacancies" : "Save vacancy";
  button.classList.toggle("is-saved", isSaved);
}

function savedVacancyHref(url) {
  try {
    const parsedUrl = new URL(url, window.location.href);
    return parsedUrl.protocol === "https:" && SAVED_VACANCY_HOSTS.has(parsedUrl.hostname)
      ? parsedUrl.href
      : null;
  } catch (error) {
    console.error("Could not read a saved vacancy URL.", error);
    return null;
  }
}

function renderSavedVacancies() {
  const list = document.querySelector("[data-saved-vacancies-list]");
  const status = document.querySelector("[data-saved-vacancies-status]");
  if (!list || !status) return;

  const saved = getSavedVacancies();
  list.replaceChildren();
  if (!saved) {
    status.textContent = "Saved vacancies are unavailable in this browser.";
    return;
  }

  const validSaved = saved
    .map(vacancy => ({ ...vacancy, href: savedVacancyHref(vacancy.url) }))
    .filter(vacancy => vacancy.href);

  if (!validSaved.length) {
    status.textContent = "You have no saved vacancies yet. Use the bookmark icon on a vacancy to save it here.";
    return;
  }

  status.textContent = `${validSaved.length} saved ${validSaved.length === 1 ? "vacancy" : "vacancies"}.`;
  for (const vacancy of validSaved) {
    const card = document.createElement("article");
    card.className = "listing-card saved-vacancy-card";

    const removeButton = document.createElement("button");
    removeButton.className = "bookmark-button is-saved";
    removeButton.type = "button";
    removeButton.dataset.bookmarkUrl = vacancy.href;
    removeButton.dataset.bookmarkTitle = vacancy.title;
    removeButton.setAttribute("aria-pressed", "true");
    removeButton.setAttribute("aria-label", `Remove ${vacancy.title} from saved vacancies`);
    removeButton.title = "Remove from saved vacancies";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
    shape.setAttribute("d", "M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-4-6 4V4.75Z");
    icon.append(shape);
    removeButton.append(icon);

    const content = document.createElement("div");
    content.className = "listing-card-content";
    const heading = document.createElement("h3");
    const link = document.createElement("a");
    link.href = vacancy.href;
    link.textContent = vacancy.title;
    heading.append(link);
    const note = document.createElement("p");
    note.className = "saved-vacancy-note";
    note.textContent = "Saved in this browser";
    content.append(heading, note);
    card.append(removeButton, content);
    list.append(card);
  }
}

function initializeBookmark(button) {
  const saved = getSavedVacancies();
  if (!saved) {
    button.disabled = true;
    button.title = "Bookmarks are unavailable in this browser";
    return;
  }
  updateBookmark(button, saved);
}

function initializeBookmarks(root = document) {
  if (root.matches?.("[data-bookmark-url]")) initializeBookmark(root);
  root.querySelectorAll?.("[data-bookmark-url]").forEach(initializeBookmark);
}

initializeBookmarks();
renderSavedVacancies();

new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element) initializeBookmarks(node);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener("click", event => {
  const button = event.target instanceof Element
    ? event.target.closest("button[data-bookmark-url]")
    : null;
  if (!button) return;

  const saved = getSavedVacancies();
  if (!saved) {
    button.disabled = true;
    button.title = "Bookmarks are unavailable in this browser";
    return;
  }

  const url = button.dataset.bookmarkUrl;
  const existing = saved.find(vacancy => vacancy.url === url);
  const updated = existing
    ? saved.filter(vacancy => vacancy.url !== url)
    : [...saved, { url, title: button.dataset.bookmarkTitle }];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    document.querySelectorAll("[data-bookmark-url]").forEach(otherButton => {
      if (otherButton.dataset.bookmarkUrl === url) updateBookmark(otherButton, updated);
    });
    renderSavedVacancies();
  } catch (error) {
    console.error("Could not save this vacancy.", error);
    button.title = "Could not save vacancy in this browser";
  }
});

window.addEventListener("storage", event => {
  if (event.key !== STORAGE_KEY) return;
  const saved = getSavedVacancies();
  if (saved) {
    document.querySelectorAll("[data-bookmark-url]").forEach(button => updateBookmark(button, saved));
  }
  renderSavedVacancies();
});

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

function savedVacancyImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const parsedUrl = new URL(value, window.location.href);
    if (parsedUrl.protocol !== "https:" || !SAVED_VACANCY_HOSTS.has(parsedUrl.hostname)) return "";
    if (!/^\/(?:province-[a-z-]+|south-african-coat-of-arms)\.png$/.test(parsedUrl.pathname)) return "";
    return new URL(parsedUrl.pathname, "https://dpsagovernmentjobs.co.za").href;
  } catch (error) {
    console.error("Could not read the saved vacancy image.", error);
    return "";
  }
}

function addSavedVacancyMetadata(button, vacancy) {
  const metadata = {
    company: button.dataset.bookmarkCompany,
    location: button.dataset.bookmarkLocation,
    province: button.dataset.bookmarkProvince,
    employmentType: button.dataset.bookmarkEmploymentType,
    scope: button.dataset.bookmarkScope,
    circularName: button.dataset.bookmarkCircular,
    image: button.dataset.bookmarkImage
  };
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string" && value.trim()) vacancy[key] = value.trim();
  }
}

function appendSavedMetadata(container, value, iconType = "", className = "listing-meta-item") {
  if (!value) return;
  const item = document.createElement("span");
  item.className = className;
  const iconPaths = {
    department: "M3 8h18v12H3z M8 8V5h8v3 M3 12h18 M10 12v2h4v-2",
    location: "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0 M12 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5"
  };
  if (iconPaths[iconType]) {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", iconPaths[iconType]);
    icon.append(path);
    item.append(icon);
  }
  item.append(document.createTextNode(value));
  container.append(item);
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
    const mark = document.createElement("div");
    mark.className = "listing-card-mark";
    const safeImage = savedVacancyImageUrl(vacancy.image);
    if (safeImage) {
      const image = document.createElement("img");
      image.src = safeImage;
      image.alt = "";
      image.width = 64;
      image.height = 64;
      image.loading = "lazy";
      image.decoding = "async";
      mark.append(image);
    } else {
      mark.classList.add("listing-card-mark-generic");
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "▦";
    }

    const heading = document.createElement("h3");
    const link = document.createElement("a");
    link.href = vacancy.href;
    link.textContent = vacancy.title;
    heading.append(link);
    const titleRow = document.createElement("div");
    titleRow.className = "listing-card-title";
    titleRow.append(heading);
    const metadata = document.createElement("div");
    metadata.className = "listing-card-meta";
    appendSavedMetadata(metadata, vacancy.company, "department");
    appendSavedMetadata(metadata, vacancy.location || vacancy.province, "location");
    const bottom = document.createElement("div");
    bottom.className = "listing-card-bottom";
    appendSavedMetadata(bottom, vacancy.employmentType, "", "listing-card-type");
    if (vacancy.scope === "Provincial" || vacancy.scope === "National") {
      appendSavedMetadata(bottom, vacancy.scope, "", `listing-card-type listing-card-scope-${vacancy.scope.toLowerCase()}`);
    }
    appendSavedMetadata(bottom, vacancy.circularName, "", "listing-card-type listing-card-circular");
    const savedNote = document.createElement("span");
    savedNote.className = "listing-card-type listing-card-saved";
    savedNote.textContent = "Saved";
    bottom.append(savedNote);
    const apply = document.createElement("a");
    apply.className = "listing-card-apply";
    apply.href = `${vacancy.href}#how-to-apply`;
    apply.textContent = "View vacancy";
    bottom.append(apply);
    content.append(titleRow, metadata, bottom);
    card.append(removeButton, mark, content);
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
    : (() => {
      const vacancy = { url, title: button.dataset.bookmarkTitle };
      addSavedVacancyMetadata(button, vacancy);
      return [...saved, vacancy];
    })();

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

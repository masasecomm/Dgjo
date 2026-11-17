const STORAGE_KEY = "dpsa-saved-vacancies";

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
});

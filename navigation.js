const mobileNavigations = document.querySelectorAll(".mobile-navigation");
const jobsApiUrl = "https://goodwork-jobs-api.dpsajobs.workers.dev/api/jobs";

for (const navigation of mobileNavigations) {
  const header = navigation.closest(".site-header");
  const toggle = navigation.querySelector(".mobile-menu-toggle");
  if (!header || !toggle) continue;

  const circularDropdown = navigation.querySelector(".nav-dropdown");
  let circularNavigationLoaded = false;
  let circularNavigationPromise;

  const loadCircularNavigation = () => {
    if (!circularDropdown || circularNavigationLoaded || circularNavigationPromise) return;
    const menu = circularDropdown.querySelector(".nav-dropdown-menu");
    menu.querySelectorAll(".nav-dropdown-error, .nav-dropdown-loading").forEach(message => message.remove());
    const loading = document.createElement("p");
    loading.className = "nav-dropdown-loading";
    loading.setAttribute("role", "status");
    loading.textContent = "Loading published circulars…";
    menu.append(loading);
    circularNavigationPromise = (async () => {
      try {
        const [{ groupJobsByCircular }, response] = await Promise.all([
          import("./circulars.js"),
          fetch(jobsApiUrl)
        ]);
        if (!response.ok) throw new Error(`Job service returned HTTP ${response.status}.`);
        const jobs = await response.json();
        if (!Array.isArray(jobs)) throw new Error("Job service returned an invalid list.");

        menu.querySelectorAll("a:not(.nav-dropdown-all)").forEach(link => link.remove());
        loading.remove();
        const links = document.createDocumentFragment();
        const circulars = groupJobsByCircular(jobs);
        for (const circular of circulars) {
          const link = document.createElement("a");
          link.href = circular.path;
          link.append(document.createTextNode(circular.name));
          const count = document.createElement("span");
          count.className = "nav-dropdown-count";
          count.textContent = `${circular.jobs.length} ${circular.jobs.length === 1 ? "job" : "jobs"}`;
          link.append(count);
          links.append(link);
        }
        if (circulars.length) {
          menu.append(links);
        } else {
          const empty = document.createElement("p");
          empty.className = "nav-dropdown-error";
          empty.setAttribute("role", "status");
          empty.textContent = "There are no published circulars to show yet.";
          menu.append(empty);
        }
        circularNavigationLoaded = true;
      } catch (error) {
        console.error("Could not load circular navigation.", error);
        const message = document.createElement("p");
        message.className = "nav-dropdown-error";
        message.setAttribute("role", "status");
        message.textContent = "Published circulars could not be loaded. Use “All circulars” to browse them.";
        loading.remove();
        menu.append(message);
      } finally {
        circularNavigationPromise = undefined;
      }
    })();
  };

  circularDropdown?.addEventListener("toggle", () => {
    if (circularDropdown.open) loadCircularNavigation();
  });

  const closeMenu = () => {
    navigation.open = false;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation menu");
  };

  navigation.addEventListener("toggle", () => {
    toggle.setAttribute("aria-expanded", String(navigation.open));
    toggle.setAttribute("aria-label", navigation.open ? "Close navigation menu" : "Open navigation menu");
  });

  navigation.addEventListener("click", event => {
    if (event.target.closest(".nav-links a")) closeMenu();
  });

  document.addEventListener("click", event => {
    if (!navigation.contains(event.target)) closeMenu();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && navigation.open) {
      closeMenu();
      toggle.focus();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) closeMenu();
  });
}

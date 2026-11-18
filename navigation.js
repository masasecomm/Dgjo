const mobileNavigations = document.querySelectorAll(".mobile-navigation");

for (const navigation of mobileNavigations) {
  const header = navigation.closest(".site-header");
  const toggle = navigation.querySelector(".mobile-menu-toggle");
  if (!header || !toggle) continue;

  const closeMenu = () => {
    navigation.open = false;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation menu");
  };

  navigation.addEventListener("toggle", () => {
    toggle.setAttribute("aria-expanded", String(navigation.open));
    toggle.setAttribute("aria-label", navigation.open ? "Close navigation menu" : "Open navigation menu");
  });

  navigation.querySelectorAll(".nav-links a").forEach(link => {
    link.addEventListener("click", closeMenu);
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

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const pages = [
  "index.html",
  "404.html",
  "dpsa-vacancy-circulars/index.html",
  "government-vacancies/index.html",
  "how-to-apply/index.html",
  "job-alert-terms.html",
  "national-treasury-salary-scales/index.html",
  "saved-vacancies/index.html"
];
const pageMarkup = await Promise.all(pages.map(path => readFile(new URL(path, import.meta.url), "utf8")));
const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");
const navigationScript = await readFile(new URL("./navigation.js", import.meta.url), "utf8");

test("public pages have an accessible, wired mobile navigation toggle", () => {
  for (const [index, html] of pageMarkup.entries()) {
    assert.match(html, /class="mobile-menu-toggle"[^>]+aria-controls="main-nav-links"[^>]+aria-expanded="false"/, pages[index]);
    assert.match(html, /class="nav-links" id="main-nav-links"/, pages[index]);
    assert.match(html, /navigation\.js\?v=20261118-mobile-nav/, pages[index]);
  }
  assert.match(navigationScript, /event\.key === "Escape"/);
  assert.match(navigationScript, /header\.querySelectorAll\("\.nav-links a"\)/);
});

test("mobile menu icon uses three equal thick strokes", () => {
  assert.match(styles, /\.mobile-menu-toggle span\s*\{\s*width:\s*23px;\s*height:\s*3px;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.site-header\.is-menu-open \.nav-links \{ display: flex; \}/);
});

test("responsive ad slots are constrained to their content width instead of clipped", () => {
  assert.match(styles, /\.content-ad \{[^}]*width: 100%;[^}]*overflow: visible;/);
  assert.match(styles, /\.content-ad \.adsbygoogle \{[^}]*width: 100% !important;[^}]*min-width: 0 !important;/);
  assert.match(styles, /\.content-ad iframe \{ max-width: 100% !important; \}/);
});

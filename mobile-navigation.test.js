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
    assert.match(html, /<details class="mobile-navigation" open>\s*<summary class="mobile-menu-toggle"[^>]+aria-controls="main-nav-links"[^>]+aria-expanded="true">/, pages[index]);
    assert.match(html, /class="nav-links" id="main-nav-links"/, pages[index]);
    assert.match(html, /navigation\.js\?v=20261118-mobile-nav6/, pages[index]);
    assert.match(html, /styles\.css\?v=20261118-mobile-nav9/, pages[index]);
  }
  assert.match(styles, /\.mobile-navigation\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1;[^}]*min-width:\s*0;[^}]*border:\s*0;/);
  assert.match(styles, /\.site-header \.mobile-navigation\s*\{\s*border:\s*0;/);
  assert.match(styles, /\.mobile-navigation > \.nav-links\s*\{[^}]*justify-content:\s*flex-end;/);
  assert.match(navigationScript, /navigation\.addEventListener\("toggle"/);
  assert.match(navigationScript, /navigation\.open = window\.innerWidth > 760/);
  assert.match(navigationScript, /event\.key === "Escape"/);
  assert.match(navigationScript, /fetch\(jobsApiUrl\)/);
  assert.match(navigationScript, /groupJobsByCircular\(jobs\)/);
  assert.match(navigationScript, /circularNavigationPromise/);
  assert.match(navigationScript, /circularNavigationLoaded/);
  assert.match(navigationScript, /menu\.querySelectorAll\("a:not\(\.nav-dropdown-all\)"\)\.forEach\(link => link\.remove\(\)\)/);
  assert.match(navigationScript, /Loading published circulars…/);
  assert.match(navigationScript, /Published circulars could not be loaded/);
  assert.match(styles, /\.nav-dropdown-error, \.nav-dropdown-loading \{ margin: 0; padding: 10px; color: var\(--muted\); font-size: 13px; \}/);
});

test("mobile menu icon uses three equal thick strokes", () => {
  assert.match(styles, /\.mobile-navigation \{ flex: 0 0 auto; \}/);
  assert.match(styles, /\.mobile-menu-toggle span\s*\{\s*width:\s*23px;\s*height:\s*3px;/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.mobile-navigation\[open\] > \.nav-links \{ display: flex; \}/);
  assert.match(styles, /\.nav-links \.nav-dropdown\[open\] > \.nav-dropdown-menu \{ display: grid; grid-template-columns: minmax\(0, 1fr\); \}/);
});

test("responsive ad slots are constrained to their content width instead of clipped", () => {
  assert.match(styles, /\.content-ad \{[^}]*width: 100%;[^}]*overflow: visible;/);
  assert.match(styles, /\.content-ad \.adsbygoogle \{[^}]*width: 100% !important;[^}]*min-width: 0 !important;/);
  assert.match(styles, /\.content-ad iframe \{ max-width: 100% !important; \}/);
});

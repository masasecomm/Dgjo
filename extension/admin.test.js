import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const adminHtml = await readFile(new URL("./admin.html", import.meta.url), "utf8");
const adminCss = await readFile(new URL("./admin.css", import.meta.url), "utf8");
const adminJs = await readFile(new URL("./admin.js", import.meta.url), "utf8");

test("admin listings use the site font and provide circular-scoped bulk selection", () => {
  const listings = adminHtml.slice(adminHtml.indexOf('<section class="list-section"'), adminHtml.indexOf("</section>", adminHtml.indexOf('<section class="list-section"')));

  assert.match(adminHtml, /family=Jost:wght@400;500;600;700;800/);
  assert.match(adminCss, /font-family: "Jost", Arial, Helvetica, sans-serif/);
  assert.match(listings, /id="circular-filter"/);
  assert.match(listings, /id="select-all-jobs"/);
  assert.match(listings, /id="edit-selected"/);
  assert.match(listings, /id="delete-selected"/);
  assert.match(listings, /class="job-list"/);
  assert.match(listings, /<option value="post-number">Post number<\/option>/);
  assert.doesNotMatch(listings, /data-filter=|class="job-grid"/);
  assert.match(adminJs, /groupJobsByCircular\(jobs\)/);
  assert.match(adminJs, /comparePostNumbers\(a\.postNo, b\.postNo\)/);
  assert.match(adminJs, /selectedJobIds\.add\(job\.id\)/);
  assert.match(adminJs, /Remove all \$\{selectedJobs\.length\} selected/);
});

test("published list rows show normalized titles and post numbers without employment or salary tags", () => {
  const renderer = adminJs.slice(adminJs.indexOf("function renderJobs()"), adminJs.indexOf("function setImportStatus("));

  assert.match(renderer, /displayVacancyTitle\(job\.title\)/);
  assert.match(renderer, /`Post \$\{job\.postNo \|\| "number not stated"\}`/);
  assert.doesNotMatch(renderer, /job-tags|Remote-friendly|salaryText|job\.posted/);
});

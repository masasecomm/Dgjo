import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { jobPagePath } from "../vacancy-url.js";

const adminHtml = await readFile(new URL("./admin.html", import.meta.url), "utf8");
const adminCss = await readFile(new URL("./admin.css", import.meta.url), "utf8");
const adminJs = await readFile(new URL("./admin.js", import.meta.url), "utf8");
const pagesWorkflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
const autoPublishWorkflow = await readFile(new URL("../.github/workflows/dpsa-auto-publish.yml", import.meta.url), "utf8");

test("Friday auto-publishing runs inside the existing scheduled Pages build", () => {
  assert.match(pagesWorkflow, /- cron: "0 7-10 \* \* 5"/);
  assert.match(pagesWorkflow, /if: github\.event_name == 'schedule' && github\.event\.schedule == '0 7-10 \* \* 5'/);
  assert.match(pagesWorkflow, /WORKER_ADMIN_TOKEN: \$\{\{ secrets\.WORKER_ADMIN_TOKEN \}\}[\s\S]*run: node scripts\/auto-publish-dpsa\.mjs/);
  assert.match(autoPublishWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(autoPublishWorkflow, /schedule:/);
});

test("the extension retries transient Worker failures and retains a minimal offline vacancy list", () => {
  assert.match(adminJs, /for \(let attempt = 0; attempt < 3; attempt\+\+\)/);
  assert.match(adminJs, /\[502, 503, 504\]\.includes\(response\.status\)/);
  assert.match(adminJs, /const CACHED_JOBS_KEY = "goodworkAdminCachedJobs"/);
  assert.match(adminJs, /Saved copy \(offline; reconnect to make changes\)/);
  assert.match(adminJs, /Unavailable offline/);
  assert.match(adminJs, /current Cloudflare ADMIN_TOKEN/);
});

test("Excel vacancy links use the public site's canonical permalink format", () => {
  const vacancy = {
    title: "ASSISTANT DIRECTOR: SECURITY MANAGEMENT",
    postNo: "41/100",
    refNo: "2026/165/OCJ"
  };
  const permalink = new URL(jobPagePath(vacancy), "https://jobs.dpsagovernmentjobs.co.za").href;

  assert.equal(permalink, "https://jobs.dpsagovernmentjobs.co.za/assistant-director-41-100-2026-165-ocj/");
  assert.match(adminJs, /Link: new URL\(jobPagePath\(vacancy\), PUBLISHED_SITE_ORIGIN\)\.href/);
  assert.match(adminJs, /worksheet\[cellAddress\]\.l = \{ Target: worksheet\[cellAddress\]\.v \}/);
  assert.match(adminJs, /"Official circular URL": vacancy\.sourceUrl,\s*Link:/);
});

test("admin listings use the site font and provide circular-scoped bulk selection", () => {
  const listings = adminHtml.slice(adminHtml.indexOf('<section class="list-section"'), adminHtml.indexOf("</section>", adminHtml.indexOf('<section class="list-section"')));

  assert.match(adminHtml, /family=Jost:wght@400;500;600;700;800/);
  assert.match(adminCss, /font-family: "Jost", Arial, Helvetica, sans-serif/);
  assert.match(listings, /id="circular-filter"/);
  assert.match(listings, /id="indexing-status-filter"/);
  assert.match(listings, /value="indexing-pending">Submitted \/ pending/);
  assert.match(listings, /value="indexing-indexed">Indexed/);
  assert.match(listings, /value="indexing-unsubmitted">Not submitted/);
  assert.match(listings, /value="indexing-failed">Request failed/);
  assert.match(listings, /id="select-all-jobs"/);
  assert.match(listings, /id="edit-selected"/);
  assert.match(listings, /id="index-selected"[^>]*>Index all selected<\/button>/);
  assert.match(listings, /id="delete-selected"/);
  assert.match(listings, /class="job-list"/);
  assert.match(listings, /<option value="post-number">Post number<\/option>/);
  assert.doesNotMatch(listings, /data-filter=|class="job-grid"/);
  assert.match(adminJs, /groupJobsByCircular\(jobs\)/);
  assert.match(adminJs, /comparePostNumbers\(a\.postNo, b\.postNo\)/);
  assert.match(adminHtml, /<option value="date-newest">Date \(newest\)<\/option>/);
  assert.match(adminHtml, /<option value="title-asc">A–Z<\/option>/);
  assert.match(adminHtml, /<option value="title-desc">Z–A<\/option>/);
  assert.match(adminHtml, /<option value="indexing-status">Indexing status<\/option>/);
  assert.match(adminJs, /compareCircularDates\(a\.circularDate, b\.circularDate\)/);
  assert.match(adminJs, /getIndexingStatusSortRank\(a\.id\) - getIndexingStatusSortRank\(b\.id\)/);
  assert.match(adminJs, /"indexing-unsubmitted": 0,[\s\S]*"indexing-indexed": 4/);
  assert.match(adminJs, /getIndexingStatusClass\(job\.id\) === indexingStatusFilter\.value/);
  assert.match(adminJs, /indexingStatusFilter\.addEventListener\("change", \(\) => \{\s*selectedJobIds\.clear\(\);\s*renderJobs\(\);/);
  assert.match(adminJs, /sortJobs\.value === "title-asc" \|\| sortJobs\.value === "title-desc"/);
  assert.match(adminJs, /selectedJobIds\.add\(job\.id\)/);
  assert.match(adminJs, /Remove all \$\{selectedJobs\.length\} selected/);
});

test("published list rows show normalized titles and post numbers without employment or salary tags", () => {
  const renderer = adminJs.slice(adminJs.indexOf("function renderJobs()"), adminJs.indexOf("function setImportStatus("));

  assert.match(renderer, /displayVacancyTitle\(job\.title\)/);
  assert.match(renderer, /`Post \$\{job\.postNo \|\| "number not stated"\}`/);
  assert.match(renderer, /Request indexing/);
  assert.match(renderer, /requestGoogleIndexing\(job\.id\)/);
  assert.doesNotMatch(renderer, /job-tags|Remote-friendly|salaryText|job\.posted/);
});

test("the extension can toggle auto-publishing and shows its saved publication timestamp history", () => {
  assert.match(adminHtml, /id="auto-publish-toggle" type="checkbox" disabled/);
  assert.match(adminHtml, /id="auto-publish-history"/);
  assert.match(adminJs, /requestAutomation\("settings", "PUT", \{ enabled \}\)/);
  assert.match(adminJs, /requestAutomation\("publications"\)/);
  assert.match(adminJs, /Auto-published \$\{publication\.circularName\}/);
  assert.match(adminJs, /timeZone: "Africa\/Johannesburg"/);
  assert.match(adminJs, /SAST/);
  assert.match(adminCss, /\.automation-switch input:checked \+ span/);
});

test("the extension shows submitted Google URLs and checks their actual Search Console index status", () => {
  const indexingPanel = adminHtml.match(/<details class="automation-card indexing-history-card collapsible-card" id="indexing-history-panel">([\s\S]*?)<\/details>/)?.[0];
  const connectionPanel = adminHtml.match(/<details class="settings-card collapsible-card" id="connection-panel">([\s\S]*?)<\/details>/)?.[0];
  const autoPublishPanel = adminHtml.match(/<details class="automation-card collapsible-card" id="auto-publish-panel">([\s\S]*?)<\/details>/)?.[0];

  assert.ok(indexingPanel);
  assert.ok(connectionPanel);
  assert.ok(autoPublishPanel);
  assert.doesNotMatch(indexingPanel, /<details[^>]*\bopen\b/);
  assert.doesNotMatch(connectionPanel, /<details[^>]*\bopen\b/);
  assert.doesNotMatch(autoPublishPanel, /<details[^>]*\bopen\b/);
  assert.match(adminHtml, /id="indexing-history-title">Google indexing activity/);
  assert.match(adminHtml, /id="refresh-indexing-history"/);
  assert.match(adminHtml, /id="indexing-history-body"/);
  assert.match(adminHtml, /id="connection-badge"/);
  assert.match(adminHtml, /id="auto-publish-summary-status"/);
  assert.match(adminHtml, /Google acceptance does not mean a page is indexed/);
  assert.match(adminJs, /async function requestIndexingHistory\(\)/);
  assert.match(adminJs, /async function inspectIndexingUrl\(url\)/);
  assert.match(adminJs, /refreshIndexingHistory\(\{ inspectAll = false \} = \{\}\)/);
  assert.match(adminJs, /refreshIndexingHistory\(\{ inspectAll: true \}\)/);
  assert.match(adminJs, /for \(const \[index, submission\] of submissions\.entries\(\)\)/);
  assert.match(adminJs, /await inspectIndexingUrl\(submission\.url\)/);
  assert.match(adminJs, /Checked the status of all \$\{submissions\.length\} submitted URLs\./);
  assert.doesNotMatch(adminJs.slice(adminJs.indexOf("function renderIndexingHistory("), adminJs.indexOf("async function refreshIndexingHistory(")), /indexingStatusFilter/);
  assert.match(adminJs, /indexSelectedButton\.addEventListener\("click"/);
  assert.match(adminJs, /indexingSubmissionsByJobId/);
  assert.match(adminJs, /Submitted · Pending indexing/);
  assert.match(adminJs, /Submitted · Not indexed/);
  assert.match(adminJs, /Check status/);
  assert.match(adminJs, /verdict === "PASS" \? "Indexed"/);
  assert.match(adminCss, /\.collapsible-card\[open\] > \.panel-summary::after/);
  assert.match(adminCss, /\.job-indexing-status\.indexing-indexed/);
  assert.match(adminJs, /Successful requests made after this feature is deployed will appear here/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  renderCircularArchiveLinks,
  renderCircularArchivePage,
  renderHomeJobListings,
  renderJobListings,
  renderSitemapWithCircularArchives
} from "./build-site.mjs";
import { groupJobsByCircular } from "../circulars.js";
import { isNationalTreasuryScalesReference } from "../salary-scales.js";

test("renders crawlable vacancy cards with safe text and root-level job links", () => {
  const html = renderJobListings([{
    id: "job-id",
    slug: "provisioning-officer-41-30-ref",
    title: "PROVISIONING ADMINISTRATION OFFICER",
    company: "Western Cape Community Education and Training College",
    circularName: "Circular 41 of 2026",
    sourceUrl: "https://www.dpsa.gov.za/circular.pdf",
    centre: "Bellville",
    province: "Western Cape",
    salaryText: "R338 106 per annum",
    type: "Contract",
    closingDate: "2099-12-31 @16:00 (Online)"
  }]);

  assert.match(html, /<h3><a href="https:\/\/jobs\.dpsagovernmentjobs\.co\.za\/provisioning-officer-41-30-ref\/">Provisioning Administration Officer<\/a><\/h3>/);
  assert.match(html, /Western Cape Community Education and Training College/);
  assert.match(html, /R338 106 per annum/);
  assert.match(html, /Expires in \d+ days/);
  assert.match(html, /listing-card-scope-provincial">Provincial/);
  assert.match(html, /<a class="listing-card-type listing-card-circular" href="\/dpsa-vacancy-circulars\/circular-41-of-2026\/">Circular 41 of 2026<\/a>/);
  assert.ok(html.includes('aria-label="Closing: 31 December 2099">'));
  assert.match(html, /M5\.5 4\.5 3 7/);
  assert.match(html, />Closing: 31 December 2099<\/span>/);
  assert.doesNotMatch(html, /16:00 \(Online\)/);
  assert.match(html, /href="https:\/\/jobs\.dpsagovernmentjobs\.co\.za\/provisioning-officer-41-30-ref\/#how-to-apply"/);
});

test("limits the homepage's initial crawlable cards while keeping every vacancy available elsewhere", () => {
  const jobs = Array.from({ length: 15 }, (_, index) => ({
    id: `job-${index + 1}`,
    title: `Vacancy ${index + 1}`,
    company: "Department",
    circularName: "Circular 1 of 2026"
  }));
  const html = renderHomeJobListings(jobs);

  assert.equal((html.match(/class="listing-card"/g) ?? []).length, 12);
  assert.match(html, /Vacancy 12/);
  assert.doesNotMatch(html, /Vacancy 13/);
  assert.match(renderCircularArchivePage("Circular 1 of 2026", jobs), /Vacancy 15/);
});

test("escapes vacancy content and renders an empty state without listings", () => {
  const html = renderJobListings([{
    id: "unsafe-job",
    title: "<SCRIPT> ALERT",
    company: "Department <img src=x>",
    type: "Permanent"
  }]);

  assert.match(html, /&lt;Script&gt; Alert/);
  assert.match(html, /Department &lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /aria-label="Closing date:/);
  assert.match(renderJobListings([]), /There are no current job listings/);
});

test("cleans invitation copy from titles and suppresses requirement text mistaken for a location", () => {
  const html = renderJobListings([{
    id: "risk-chair",
    title: "RISK MANAGEMENT COMMITTEE (CHAIRPERSON) The Department of Social Development invites applications from suitably qualified and experienced individuals to serve a",
    company: "Department of Social Development",
    centre: "An appropriate qualification and experience. Competencies: knowledge and skills required.",
    location: "work under pressure."
  }]);

  assert.match(html, /<h3><a href="https:\/\/jobs\.dpsagovernmentjobs\.co\.za\/risk-chair\/">Risk Management Committee \(Chairperson\)<\/a><\/h3>/);
  assert.doesNotMatch(html, /suitably qualified|work under pressure|An appropriate qualification/);
});

test("renders provincial and national crests on the correct vacancy cards", () => {
  const html = renderJobListings([
    {
      id: "provincial-role",
      title: "Provincial role",
      company: "Department",
      circularName: "Circular 1",
      province: "gauteng"
    },
    {
      id: "national-role",
      title: "National role",
      company: "Department",
      circularName: "Circular 1",
      province: "",
      centre: "National Head Office"
    }
  ]);

  assert.match(html, /src="\/province-gauteng\.png" alt="Gauteng provincial coat of arms"/);
  assert.match(html, /loading="lazy" decoding="async"/);
  assert.match(html, /listing-card-scope-provincial">Provincial/);
  assert.match(html, /src="south-african-coat-of-arms\.png" alt="South African national coat of arms"/);
  assert.match(html, /listing-card-scope-national">National/);
});

test("links numberless National Treasury salary text to the salary guide", () => {
  const html = renderJobListings([
    { id: "treasury-scale", title: "Treasury role", company: "Department", salaryText: "National Treasury salary scales" },
    { id: "numeric-salary", title: "Numbered role", company: "Department", salaryText: "National Treasury Level 4" }
  ]);

  assert.equal(isNationalTreasuryScalesReference("National Treasury"), true);
  assert.equal(isNationalTreasuryScalesReference("National Treasury Level 4"), false);
  assert.match(html, /<a class="listing-salary-link" href="\/national-treasury-salary-scales\/">National Treasury Scales<\/a>/);
  assert.match(html, /National Treasury Level 4/);
});

test("builds a circular archive with canonical metadata, linked jobs and a collection list", () => {
  const html = renderCircularArchivePage("Circular 1 / 2026", [{
    id: "job-id",
    slug: "example-vacancy",
    title: "Example vacancy",
    company: "Department",
    circularName: "Circular 1 of 2026",
    salaryText: "National Treasury"
  }]);

  assert.match(html, /<link rel="canonical" href="https:\/\/dpsagovernmentjobs\.co\.za\/dpsa-vacancy-circulars\/circular-1-of-2026\/">/);
  assert.match(html, /<h1>Circular 1 of 2026 Jobs and Vacancies<\/h1>/);
  assert.match(html, /href="https:\/\/jobs\.dpsagovernmentjobs\.co\.za\/example-vacancy\/"/);
  assert.match(html, /href="\/national-treasury-salary-scales\/">National Treasury Scales/);
  assert.match(html, /"@type":"CollectionPage"/);
  assert.match(html, /"@type":"ItemList"/);
  assert.doesNotMatch(html, /listing-card-circular/);
});

test("renders circular archive links and adds their routes to the sitemap", () => {
  const groups = [{
    name: "Circular 1 of 2026",
    path: "/dpsa-vacancy-circulars/circular-1-of-2026/",
    jobs: [{}, {}]
  }];
  const links = renderCircularArchiveLinks(groups);
  const sitemap = renderSitemapWithCircularArchives("<urlset>\n</urlset>", groups, "2026-11-17");

  assert.match(links, /href="\/dpsa-vacancy-circulars\/circular-1-of-2026\/">Circular 1 of 2026<\/a><span>2 current jobs/);
  assert.match(sitemap, /<loc>https:\/\/dpsagovernmentjobs\.co\.za\/dpsa-vacancy-circulars\/circular-1-of-2026\/<\/loc>/);
  assert.match(sitemap, /<lastmod>2026-11-17<\/lastmod>/);
});

test("groups formatting variants of a circular into one archive", () => {
  const groups = groupJobsByCircular([
    { id: "first", circularName: "CIRCULAR 1 / 2026" },
    { id: "second", circularName: "Circular 1 of 2026" },
    { id: "third", circularName: "Circular 2 of 2026" }
  ]);
  const circularOne = groups.find(group => group.name === "Circular 1 of 2026");

  assert.equal(groups.length, 2);
  assert.equal(circularOne.jobs.length, 2);
  assert.equal(circularOne.path, "/dpsa-vacancy-circulars/circular-1-of-2026/");
});

test("publishes the supplied salary table with a readable level guide and PDF actions", async () => {
  const page = await readFile(new URL("../national-treasury-salary-scales/index.html", import.meta.url), "utf8");
  const levels = [...page.matchAll(/<summary>Level \d+/g)];

  assert.equal(levels.length, 12);
  assert.match(page, /potential gains, not guaranteed take-home pay/i);
  assert.match(page, /href="\.\/salary-adjustment-table\.pdf" download/);
  assert.match(page, /<iframe src="\.\/salary-adjustment-table\.pdf#view=FitH"/);
});

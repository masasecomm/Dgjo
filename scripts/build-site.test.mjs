import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  renderCircularArchiveLinks,
  renderCircularArchivePage,
  renderHomeJobListings,
  renderJobListings,
  renderPastCircularArchiveLinks,
  renderProvinceGuideLinks,
  renderProvinceLandingPage,
  renderSitemapWithCircularArchives,
  groupJobsByProvince
} from "./build-site.mjs";
import { groupJobsByCircular } from "../circulars.js";
import { isFeedRequest, legacyCircularRedirectTarget } from "../redirects.js";
import {
  estimateAnnualIncomeTax,
  extractJobLevel,
  isNationalTreasuryScalesReference,
  salaryLevelHref,
  salaryLevelMonthlyNotch
} from "../salary-scales.js";

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
  assert.match(html, /src="\/south-african-coat-of-arms\.png" alt="South African national coat of arms"/);
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

test("extracts salary levels without mistaking NQF levels and links cards to the matching guide section", () => {
  const html = renderJobListings([
    { id: "level-from-salary", title: "Known level", company: "Department", salaryText: "R338 106 per annum (Level 07)" },
    { id: "level-from-field", title: "Explicit level", company: "Department", level: "Level 09" },
    { id: "nqf-level", title: "NQF qualification", company: "Department", salaryText: "National Diploma (NQF Level 6)" },
    { id: "invalid-level", title: "Unclear level", company: "Department", level: "A valid driver’s license and Grade A" }
  ]);

  assert.equal(extractJobLevel({ level: "A valid driver’s license and Grade A" }), "");
  assert.equal(extractJobLevel({ salaryText: "National Diploma (NQF Level 6)" }), "");
  assert.equal(extractJobLevel({ salaryText: "R338 106 per annum (Level 07)" }), "Level 7");
  assert.equal(salaryLevelHref("Level 9"), "/national-treasury-salary-scales/#level-9");
  assert.match(html, /Job level: <a class="listing-salary-link" href="\/national-treasury-salary-scales\/#level-7">Level 7<\/a>/);
  assert.match(html, /href="\/national-treasury-salary-scales\/#level-9">Level 9<\/a>/);
  assert.doesNotMatch(html, /Job level: <a[^>]*>Level 6<\/a>/);
});

test("estimates PAYE with the official 2027 primary rebate and supplied salary levels", () => {
  assert.equal(estimateAnnualIncomeTax(300000), 40572);
  assert.equal(estimateAnnualIncomeTax(0), 0);
  assert.equal(estimateAnnualIncomeTax(-1), null);
  assert.equal(salaryLevelMonthlyNotch("Level 5"), 13237);
  assert.equal(salaryLevelMonthlyNotch("Level 13"), null);
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
  assert.match(html, /<script async src="https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-3860151941190347"/);
  assert.match(html, /<div class="site-post">/);
  assert.match(html, /<a class="brand home-brand" href="\/" aria-label="DPSA Government Jobs home"><img src="\/south-african-flag\.png"/);
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

test("keeps historical circular references available and maps old URLs to their section", () => {
  const links = renderPastCircularArchiveLinks();

  assert.match(links, /id="circular-1-of-2026"><strong>Circular 1 of 2026<\/strong>/);
  assert.match(links, /id="circular-18-of-2026"/);
  assert.match(links, /href="https:\/\/www\.dpsa\.gov\.za\/newsroom\/psvc\/"/);
  assert.equal(
    legacyCircularRedirectTarget("https://dpsagovernmentjobs.co.za/category/dpsa-circular-18-of-2026/"),
    "/dpsa-vacancy-circulars/#circular-18-of-2026"
  );
  assert.equal(
    legacyCircularRedirectTarget("https://dpsagovernmentjobs.co.za/civic-clerk-dpsa-circular-17-of-2026-dpsa-vacancies/"),
    "/dpsa-vacancy-circulars/#circular-17-of-2026"
  );
  assert.equal(legacyCircularRedirectTarget("https://dpsagovernmentjobs.co.za/admin/"), null);
});

test("builds province vacancy guides from canonicalized locations", () => {
  const jobs = [
    { id: "gauteng-one", slug: "gauteng-one", title: "Gauteng role", company: "Department", province: "gauteng" },
    { id: "gauteng-two", slug: "gauteng-two", title: "Another role", company: "Department", province: "GAUTENG" },
    { id: "western-cape", slug: "western-cape", title: "Cape role", company: "Department", province: "Western Cape" },
    { id: "unmapped", slug: "unmapped", title: "Unknown location", company: "Department", province: "Unknown" }
  ];
  const groups = groupJobsByProvince(jobs);
  const gauteng = groups.find(group => group.name === "Gauteng");
  const gautengPage = renderProvinceLandingPage("gauteng", gauteng.jobs);
  const links = renderProvinceGuideLinks(groups);
  const sitemap = renderSitemapWithCircularArchives("<urlset>\n</urlset>", [], "2026-11-17", groups);

  assert.deepEqual(groups.map(group => group.name), ["Gauteng", "Western Cape"]);
  assert.equal(gauteng.jobs.length, 2);
  assert.match(links, /href="\/government-vacancies\/gauteng\/">Gauteng government vacancies<\/a><span>2 current vacancies/);
  assert.match(gautengPage, /<title>Government Vacancies in Gauteng \| Current DPSA Jobs<\/title>/);
  assert.match(gautengPage, /Looking for GPG vacancies\?/);
  assert.match(gautengPage, /not a complete list of all Gauteng Provincial Government or municipal recruitment/);
  assert.match(gautengPage, /Gauteng role/);
  assert.match(gautengPage, /"@type":"CollectionPage"/);
  assert.match(gautengPage, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/);
  assert.match(sitemap, /<loc>https:\/\/dpsagovernmentjobs\.co\.za\/government-vacancies\/gauteng\/<\/loc>/);
  assert.throws(() => renderProvinceLandingPage("Unknown", []), /recognized South African province/);
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
  assert.deepEqual(groups.map(group => group.name), ["Circular 1 of 2026", "Circular 2 of 2026"]);
});

test("shows vacancies from earlier circulars first while preserving order within each circular", () => {
  const html = renderHomeJobListings([
    { id: "circ-2-a", slug: "circular-2-a", title: "Circular 2 A", company: "Department", circularName: "Circular 2 of 2026" },
    { id: "circ-1-a", slug: "circular-1-a", title: "Circular 1 A", company: "Department", circularName: "Circular 1 of 2026" },
    { id: "circ-1-b", slug: "circular-1-b", title: "Circular 1 B", company: "Department", circularName: "Circular 1 of 2026" },
    { id: "circ-1-last-year", slug: "circular-1-last-year", title: "Circular 1 Last Year", company: "Department", circularName: "Circular 1 of 2025" }
  ]);
  const titleOrder = [...html.matchAll(/<h3><a [^>]+>([^<]+)<\/a><\/h3>/g)].map(match => match[1]);

  assert.deepEqual(titleOrder, ["Circular 1 Last Year", "Circular 1 A", "Circular 1 B", "Circular 2 A"]);
});

test("publishes the supplied salary table with a readable level guide and PDF actions", async () => {
  const page = await readFile(new URL("../national-treasury-salary-scales/index.html", import.meta.url), "utf8");
  const levels = [...page.matchAll(/<summary>Level \d+/g)];

  assert.equal(levels.length, 12);
  assert.equal((page.match(/id="level-\d+"/g) ?? []).length, 12);
  assert.match(page, /potential gains, not guaranteed take-home pay/i);
  assert.match(page, /href="\.\/salary-adjustment-table\.pdf" download/);
  assert.match(page, /<iframe src="\.\/salary-adjustment-table\.pdf#view=FitH"/);
});

test("loads the AdSense script on every public static HTML page", async () => {
  const pages = [
    "../index.html",
    "../404.html",
    "../dpsa-vacancy-circulars/index.html",
    "../how-to-apply/index.html",
    "../national-treasury-salary-scales/index.html"
  ];
  const loaderUrl = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3860151941190347";

  for (const pagePath of pages) {
    const html = await readFile(new URL(pagePath, import.meta.url), "utf8");
    assert.equal(html.split(loaderUrl).length - 1, 1, `${pagePath} must load AdSense exactly once`);
    assert.match(html, /<body class="post-theme(?: home-page)?"(?: [^>]*)?>/, `${pagePath} must use the shared post theme`);
    assert.match(html, /<script type="module" src="\/redirects\.js"><\/script>/, `${pagePath} must include URL redirects`);
  }
});

test("redirects common feed URLs and query forms without treating the sitemap as a feed", () => {
  for (const url of [
    "https://dpsagovernmentjobs.co.za/feed/",
    "https://dpsagovernmentjobs.co.za/comments/feed/",
    "https://dpsagovernmentjobs.co.za/feed.xml",
    "https://dpsagovernmentjobs.co.za/index.xml",
    "https://dpsagovernmentjobs.co.za/rss.xml",
    "https://dpsagovernmentjobs.co.za/atom.xml",
    "https://dpsagovernmentjobs.co.za/legacy.rdf",
    "https://dpsagovernmentjobs.co.za/?feed=rss2",
    "https://dpsagovernmentjobs.co.za/index.php?format=feed&type=rss",
    "https://dpsagovernmentjobs.co.za/index.php?format=atom"
  ]) {
    assert.equal(isFeedRequest(url), true, `${url} should be treated as a feed`);
  }
  assert.equal(isFeedRequest("https://dpsagovernmentjobs.co.za/sitemap.xml"), false);
  assert.equal(isFeedRequest("https://dpsagovernmentjobs.co.za/robots.txt"), false);
});

test("redirects unknown static 404 pages home and legacy circulars to their relevant hub section", async () => {
  const page = await readFile(new URL("../404.html", import.meta.url), "utf8");
  assert.match(page, /<meta http-equiv="refresh" content="3;url=\/">/);
  assert.match(page, /data-redirect-not-found="true"/);
  assert.doesNotMatch(page, /window\.location\.replace\("\/"\)/);
});

import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildSite,
  renderCircularArchiveLinks,
  renderCircularArchivePage,
  renderCircularNavigationItems,
  renderHomeJobContinuation,
  renderHomeJobListings,
  renderJobListings,
  renderPastCircularArchiveLinks,
  renderProvinceGuideLinks,
  renderProvinceLandingPage,
  renderSitemapWithCircularArchives,
  groupJobsByProvince
} from "./build-site.mjs";
import { groupJobsByCircular, MAX_ACTIVE_CIRCULARS, retainLatestCircularJobs, sortJobsByCircular } from "../circulars.js";
import { isFeedRequest, legacyCircularRedirectTarget } from "../redirects.js";
import { displayEmploymentType, employmentTypeCategory } from "../employment-type.js";
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
    level: "Level 7",
    type: "Contract",
    closingDate: "2099-12-31 @16:00 (Online)"
  }]);

  assert.match(html, /<h3><a href="https:\/\/jobs\.dpsagovernmentjobs\.co\.za\/provisioning-officer-41-30-ref\/">Provisioning Administration Officer<\/a><\/h3>/);
  assert.match(html, /Western Cape Community Education and Training College/);
  assert.match(html, /R338 106 per annum/);
  assert.match(html, /Expires in \d+ days/);
  assert.match(html, /listing-card-scope-provincial">Provincial/);
  assert.match(html, /<a class="listing-card-type listing-card-circular" href="\/dpsa-vacancy-circulars\/circular-41-of-2026\/">Circular 41 of 2026<\/a>/);
  assert.match(html, /<button class="bookmark-button"[^>]+data-bookmark-url="https:\/\/jobs\.dpsagovernmentjobs\.co\.za\/provisioning-officer-41-30-ref\/"[^>]+aria-pressed="false"/);
  assert.match(html, /data-bookmark-company="Western Cape Community Education and Training College"/);
  assert.match(html, /data-bookmark-circular="Circular 41 of 2026"/);
  assert.ok(html.includes('aria-label="Closing: 31 December 2099">'));
  assert.match(html, /M5\.5 4\.5 3 7/);
  assert.match(html, /M4 20h16 M6 20v-5h4v5 M14 20V9h4v11/);
  assert.match(html, /Job level: <a class="listing-salary-link" href="\/national-treasury-salary-scales\/#level-7">Level 7<\/a>/);
  assert.match(html, />Closing: 31 December 2099<\/span>/);
  assert.doesNotMatch(html, /16:00 \(Online\)/);
  assert.match(html, /href="https:\/\/jobs\.dpsagovernmentjobs\.co\.za\/provisioning-officer-41-30-ref\/#how-to-apply"/);
});

test("classifies internships by post title and makes employment categories filterable", () => {
  const internship = {
    id: "internship-post",
    title: "INTERNSHIP PROGRAMME: INFORMATION TECHNOLOGY",
    company: "Department",
    type: "Contract",
    natureOfAppointment: "Permanent"
  };
  assert.equal(employmentTypeCategory(internship), "Internship");
  assert.equal(displayEmploymentType(internship), "Internship");
  const html = renderJobListings([internship]);
  assert.match(html, /<a class="listing-card-type" href="\/\?employmentType=Internship#listings">Internship<\/a>/);
  assert.doesNotMatch(html, />Contract<\/a>|>Permanent<\/a>/);
  assert.equal(employmentTypeCategory({ title: "Farm worker", type: "Seasonal" }), "Contract");
  assert.equal(employmentTypeCategory({ title: "Analyst", type: "Permanent" }), "Permanent");
  assert.equal(employmentTypeCategory({ title: "Clerk", type: "Sessional" }), "Sessional");
});

test("places the CV matcher after four initial crawlable cards and keeps every vacancy available elsewhere", () => {
  const jobs = Array.from({ length: 15 }, (_, index) => ({
    id: `job-${index + 1}`,
    title: `Vacancy ${index + 1}`,
    company: "Department",
    circularName: "Circular 1 of 2026"
  }));
  const html = renderHomeJobListings(jobs);

  assert.equal((html.match(/class="listing-card"/g) ?? []).length, 4);
  assert.match(html, /Vacancy 4/);
  assert.doesNotMatch(html, /Vacancy 5/);
  const continuation = renderHomeJobContinuation(jobs);
  assert.equal((continuation.match(/class="listing-card"/g) ?? []).length, 6);
  assert.match(continuation, /Vacancy 5/);
  assert.match(continuation, /Vacancy 10/);
  assert.doesNotMatch(continuation, /Vacancy 11/);
  const archive = renderCircularArchivePage("Circular 1 of 2026", jobs);
  assert.match(archive, /Vacancy 15/);
  assert.equal((archive.match(/data-ad-slot="3081508385"/g) ?? []).length, 1);
});

test("keeps circulars and application guidance on their own pages", async () => {
  const homepage = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const circulars = await readFile(new URL("../dpsa-vacancy-circulars/index.html", import.meta.url), "utf8");
  const applicationGuide = await readFile(new URL("../how-to-apply/index.html", import.meta.url), "utf8");
  const provinceHub = await readFile(new URL("../government-vacancies/index.html", import.meta.url), "utf8");
  const cvSectionIndex = homepage.indexOf('<section class="section cv-matcher-section"');
  const initialListingsIndex = homepage.indexOf('id="job-list"');
  const continuationIndex = homepage.indexOf('id="job-list-continuation"');
  const homepageNavStart = homepage.indexOf('<nav class="nav shell"');
  const homepageNav = homepage.slice(homepageNavStart, homepage.indexOf("</nav>", homepageNavStart));
  const homepageNavItems = [
    homepageNav.indexOf('aria-current="page">Home</a>'),
    homepageNav.indexOf('<summary>Circulars</summary>'),
    homepageNav.indexOf('href="/saved-vacancies/">Saved vacancies</a>'),
    homepageNav.indexOf('href="#cv-job-matcher">CV job match</a>')
  ];

  assert.ok(cvSectionIndex > initialListingsIndex && cvSectionIndex < continuationIndex, "the CV matcher initially follows the first four jobs");
  assert.ok(homepage.indexOf('<section class="home-section home-featured"') < cvSectionIndex);
  assert.ok(homepage.indexOf('<div class="home-job-continuation"') > cvSectionIndex);
  assert.match(homepage, /const listingsSection = document\.querySelector\("\.home-featured"\)/);
  assert.ok(homepageNavItems.every((position, index) => position >= 0 && (index === 0 || position > homepageNavItems[index - 1])), "main navigation is ordered Home, Circulars, Saved vacancies, CV job match");
  assert.match(homepage, /id="load-more-jobs"[^>]*>Show 10 more vacancies/);
  assert.match(homepage, /const JOBS_PER_PAGE = 10/);
  assert.match(homepage, /const INITIAL_JOB_COUNT = 4/);
  assert.match(homepage, /<h2 id="listings-heading">GOVERNMENT VACANCIES<\/h2>/);
  assert.match(homepage, /level: "M4 20h16/);
  assert.match(homepage, /levelItem\.append\(metadataIcon\("level"\)/);
  assert.match(homepage, /property="og:image" content="https:\/\/dpsagovernmentjobs\.co\.za\/south-african-coat-of-arms\.png"/);
  assert.match(homepage, /params\.get\("employmentType"\)/);
  assert.match(homepage, /employmentTypeCategory\(job\) !== selectedEmploymentType/);
  assert.match(homepage, /filteredJobs = sortJobsByCircular\(allJobs\.filter\(job => \{/);
  assert.match(homepage, /id="listing-breadcrumb" class="breadcrumb" aria-label="Breadcrumb" hidden/);
  assert.match(homepage, /id="employment-type-filters" class="province-filters employment-type-filters"/);
  assert.match(homepage, /EMPLOYMENT_TYPE_CATEGORIES\.map\(category => \[category, 0\]\)/);
  assert.match(homepage, /link\.textContent = `\$\{category\} \(\$\{employmentTypeCounts\.get\(category\)\}\)`/);
  assert.match(homepage, /const headingCategories = \[selectedEmploymentType, departmentName, province\]/);
  assert.match(homepage, /headingCategories\.join\(" · "\).*GOVERNMENT VACANCIES/);
  assert.match(homepage, /function updateCvMatcherPosition\(\) \{\s*if \(jobProvince\.value \|\| jobDepartment\.value \|\| selectedEmploymentType\) \{\s*listingsSection\.after\(cvMatcherSection\);\s*\} else \{\s*continuationSection\.before\(cvMatcherSection\);/);
  assert.match(homepage, /updateCvMatcherPosition\(\);\s*const departmentName/);
  assert.match(homepage, /jobQuery\.value = "";\s*jobDepartment\.value = "";\s*jobProvince\.value = link\.dataset\.province/);
  assert.match(homepage, /const params = new URLSearchParams\(\);\s*if \(jobProvince\.value\) params\.set\("province", jobProvince\.value\)/);
  assert.match(homepage, /provinceFilters\.scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(homepage, /history\.replaceState\(null, "", `\$\{location\.pathname\}\$\{params\.size \? `\?\$\{params\}` : ""\}#listings`\)/);
  assert.match(homepage, /id="back-to-top" class="back-to-top"[^>]+aria-label="Back to top"/);
  assert.match(homepage, /window\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  assert.doesNotMatch(homepage, /id="circulars-heading"|id="steps-heading"|A clear application process/);
  assert.match(homepage, /href="\/dpsa-vacancy-circulars\/"/);
  assert.match(homepage, /href="\/how-to-apply\/">How to apply<\/a>/);
  assert.doesNotMatch(homepageNav, /href="\/#questions-heading">Contact<\/a>|href="\/how-to-apply\/"|href="\/government-vacancies\/">Province/);
  assert.match(homepage, /Find government jobs that matches your CV/);
  assert.match(homepage, /Upload your CV to find vacancies that match your skills and experience\./);
  assert.doesNotMatch(homepage, /Find government jobs that fit your CV|Upload a CV to compare its job-related skills and experience with current vacancies across all provinces and departments/);
  assert.doesNotMatch(homepage, /id="province-guides-heading"|Government vacancies by province or national category/);
  assert.match(circulars, /<h1>Find current DPSA vacancy circulars<\/h1>/);
  assert.match(applicationGuide, /A clear application process/);
  assert.match(applicationGuide, /<h1>How to apply for a DPSA vacancy<\/h1>/);
  assert.match(provinceHub, /<h1>Government vacancies by province or national category<\/h1>/);
  assert.match(provinceHub, /PROVINCE_GUIDES_START/);
});

test("renders a consistent footer with the verified address, grouped links and social icons", async () => {
  const homepage = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const homepageFooter = homepage.slice(homepage.indexOf('<footer class="site-footer">'));
  assert.match(homepageFooter, /<p><span>Get notified when new public service vacancies are published\.<\/span> <span>Confirm your email to activate alerts\.<\/span><\/p>/);
  const pages = [
    "../index.html",
    "../404.html",
    "../dpsa-vacancy-circulars/index.html",
    "../government-vacancies/index.html",
    "../how-to-apply/index.html",
    "../job-alert-terms.html",
    "../national-treasury-salary-scales/index.html"
  ];
  const generatedPages = [
    renderProvinceLandingPage("Gauteng", []),
    renderCircularArchivePage("Circular 1 of 2026", [])
  ];
  for (const pagePath of pages) {
    const source = await readFile(new URL(pagePath, import.meta.url), "utf8");
    const footer = source.slice(source.indexOf('<footer class="site-footer">'));
    const navStart = source.indexOf('<nav class="nav shell"');
    const nav = source.slice(navStart, source.indexOf("</nav>", navStart));
    assert.match(footer, /Office 531, 5th Floor, Barend van Erkom Building, 217 Pretorius Street, Pretoria Central, Pretoria, 0002/);
    assert.match(footer, /aria-label="Vacancies"[\s\S]*>Vacancies<\/h2>[\s\S]*href="\/government-vacancies\/"/);
    assert.match(footer, /href="\/saved-vacancies\/">Saved vacancies<\/a>/);
    assert.match(footer, /aria-label="Job seeker resources"[\s\S]*>Job seeker resources<\/h2>[\s\S]*href="\/how-to-apply\/"/);
    assert.match(footer, /href="https:\/\/www\.dpsa\.gov\.za\/newsroom\/psvc\/"/);
    assert.match(footer, /href="https:\/\/www\.dpsa\.gov\.za\/newsroom\/psvc\/" target="_blank" rel="noopener noreferrer"/);
    assert.doesNotMatch(footer, /Contact/);
    assert.doesNotMatch(footer, /Independent guide to South African public service vacancies\. Verify details with the official advert and hiring department\./);
    assert.doesNotMatch(nav, /href="\/how-to-apply\/"|href="\/government-vacancies\/"[^>]*>Province/);
    assert.doesNotMatch(nav, /Contact/);
    assert.match(nav, /href="\/saved-vacancies\/">Saved vacancies<\/a>|href="\/saved-vacancies\/" aria-current="page">Saved vacancies<\/a>/);
    assert.match(footer, /<img src="\/footer-facebook\.svg" alt="">/);
    assert.match(footer, /<img src="\/footer-x\.svg" alt="">/);
    assert.match(footer, /<img src="\/footer-pinterest\.svg" alt="">/);
    assert.match(footer, /aria-label="Follow DPSA Government Jobs on Facebook"/);
    assert.doesNotMatch(footer, /<span aria-hidden="true">[fP𝕏]<\/span>/);
  }

  for (const page of generatedPages) {
    const navStart = page.indexOf('<nav class="nav shell"');
    const nav = page.slice(navStart, page.indexOf("</nav>", navStart));
    assert.match(page, /Office 531, 5th Floor, Barend van Erkom Building, 217 Pretorius Street, Pretoria Central, Pretoria, 0002/);
    assert.match(page, /<img src="\/footer-facebook\.svg" alt="">/);
    assert.match(page, /<img src="\/footer-x\.svg" alt="">/);
    assert.match(page, /<img src="\/footer-pinterest\.svg" alt="">/);
    assert.doesNotMatch(page, /Contact/);
    assert.doesNotMatch(nav, /href="\/how-to-apply\/"|href="\/government-vacancies\/"[^>]*>Province/);
    assert.match(nav, /href="\/saved-vacancies\/">Saved vacancies<\/a>/);
  }

  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.footer-column h2 \{[^}]*font-family: var\(--sans\)/);
  assert.match(styles, /@media \(max-width: 680px\) \{[\s\S]*?\.footer-newsletter > p span \+ span \{ display: block; \}/);
  assert.match(styles, /@media \(max-width: 680px\) \{[\s\S]*?\.cv-match-contact-row \{ display: grid/);
  assert.match(styles, /@media \(max-width: 680px\) \{[\s\S]*?\.footer-newsletter \.footer-subscribe-row \{ display: grid/);
  assert.match(styles, /\.cv-match-contact-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 4px; min-height: 0; padding: 8px; border-radius: 20px; \}/);
  assert.match(styles, /\.footer-newsletter \.footer-subscribe-row \{ display: grid; grid-template-columns: minmax\(0, 1fr\); gap: 4px; min-height: 0; padding: 8px; border-radius: 20px; \}/);
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
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /property="og:image" content="https:\/\/dpsagovernmentjobs\.co\.za\/south-african-coat-of-arms\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /DPSA circulars<\/a> › Circular 1 of 2026/);
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

test("rebuilds the sitemap without stale circular or province archive routes", () => {
  const source = `<urlset>
  <url>
    <loc>https://dpsagovernmentjobs.co.za/</loc>
    <lastmod>2026-11-16</lastmod>
  </url>
  <url>
    <loc>https://dpsagovernmentjobs.co.za/dpsa-vacancy-circulars/circular-1-of-2026/</loc>
    <lastmod>2026-11-16</lastmod>
  </url>
  <url>
    <loc>https://dpsagovernmentjobs.co.za/government-vacancies/gauteng/</loc>
    <lastmod>2026-11-16</lastmod>
  </url>
</urlset>`;
  const sitemap = renderSitemapWithCircularArchives(source, [{
    name: "Circular 5 of 2026",
    path: "/dpsa-vacancy-circulars/circular-5-of-2026/",
    jobs: [{}]
  }], "2026-11-17");

  assert.match(sitemap, /<loc>https:\/\/dpsagovernmentjobs\.co\.za\/<\/loc>/);
  assert.doesNotMatch(sitemap, /circular-1-of-2026|government-vacancies\/gauteng/);
  assert.equal((sitemap.match(/circular-5-of-2026/g) ?? []).length, 1);
});

test("removes stale generated circular and province pages on rebuild", async () => {
  const output = await mkdtemp(path.join(process.cwd(), ".build-test-"));
  const previousOutput = process.env.SITE_OUTPUT_DIR;
  const previousFetch = globalThis.fetch;
  const staleCircular = path.join(output, "dpsa-vacancy-circulars", "circular-41-of-2026");
  const staleProvince = path.join(output, "government-vacancies", "north-west");
  await mkdir(staleCircular, { recursive: true });
  await mkdir(staleProvince, { recursive: true });
  await writeFile(path.join(staleCircular, "index.html"), "stale");
  await writeFile(path.join(staleProvince, "index.html"), "stale");
  process.env.SITE_OUTPUT_DIR = output;
  globalThis.fetch = async () => new Response(JSON.stringify([{
    id: "current-job",
    slug: "current-job",
    title: "Current vacancy",
    company: "Department",
    circularName: "Circular 42 of 2026",
    province: "Gauteng"
  }]), { headers: { "Content-Type": "application/json" } });

  try {
    await buildSite();
    await assert.rejects(access(staleCircular), error => error.code === "ENOENT");
    await assert.rejects(access(staleProvince), error => error.code === "ENOENT");
    await Promise.all([
      access(path.join(output, "cv-pdf-reader.js")),
      access(path.join(output, "cv-docx-reader.js")),
      access(path.join(output, "pdf.worker.min.mjs")),
      access(path.join(output, "scripts", "cv-matcher.js")),
      access(path.join(output, "bookmark.js")),
      access(path.join(output, "employment-type.js")),
      access(path.join(output, "favicon.ico")),
      access(path.join(output, "apple-touch-icon.png")),
      access(path.join(output, "footer-facebook.svg")),
      access(path.join(output, "footer-location.svg")),
      access(path.join(output, "footer-pinterest.svg")),
      access(path.join(output, "footer-x.svg"))
    ]);
    const homepage = await readFile(path.join(output, "index.html"), "utf8");
    const termsPage = await readFile(path.join(output, "job-alert-terms.html"), "utf8");
    const circularPage = await readFile(path.join(output, "dpsa-vacancy-circulars", "circular-42-of-2026", "index.html"), "utf8");
    const savedVacancies = await readFile(path.join(output, "saved-vacancies", "index.html"), "utf8");
    const howToPage = await readFile(path.join(output, "how-to-apply", "index.html"), "utf8");
    assert.match(homepage, /id="cv-job-matcher"/);
    assert.match(homepage, /rel="icon" type="image\/x-icon" sizes="16x16 32x32 48x48" href="\/favicon\.ico"/);
    assert.match(termsPage, /rel="icon" type="image\/x-icon" sizes="16x16 32x32 48x48" href="\/favicon\.ico"/);
    assert.match(homepage, /rel="shortcut icon" href="\/favicon\.ico"/);
    assert.match(homepage, /rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/);
    assert.match(homepage, /"@type"\s*:\s*"WebSite"/);
    assert.match(termsPage, /"@type"\s*:\s*"WebSite"/);
    assert.match(circularPage, /"@type"\s*:\s*"WebSite"/);
    assert.match(circularPage, /rel="icon" type="image\/x-icon" sizes="16x16 32x32 48x48" href="\/favicon\.ico"/);
    assert.match(savedVacancies, /rel="icon" type="image\/x-icon" sizes="16x16 32x32 48x48" href="\/favicon\.ico"/);
    const howToSchema = [...howToPage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map(([, schema]) => JSON.parse(schema))
      .find(schema => schema["@type"] === "HowTo");
    assert.equal(howToSchema.step.length, 4);
    assert.equal(howToSchema.step[0].name, "Read the complete advert");
    assert.match(homepage, /href="https:\/\/www\.dpsa\.gov\.za\/newsroom\/psvc\/" target="_blank" rel="noopener noreferrer"/);
    assert.match(homepage, /id="job-alert-form"/);
    assert.match(homepage, /src="\/bookmark\.js\?v=20261117-saved-card-layout" defer/);
    assert.doesNotMatch(homepage, /id="province-guides-heading"/);
    await access(path.join(output, "job-alert-terms.html"));
    assert.match(savedVacancies, /data-saved-vacancies-list/);
    assert.match(savedVacancies, /src="\/bookmark\.js\?v=20261117-saved-card-layout" defer/);
    const provinceHub = await readFile(path.join(output, "government-vacancies", "index.html"), "utf8");
    assert.match(provinceHub, /href="\/government-vacancies\/gauteng\/">Gauteng government vacancies<\/a><span>1 current vacancy/);
    const sitemap = await readFile(path.join(output, "sitemap.xml"), "utf8");
    assert.doesNotMatch(sitemap, /circular-41-of-2026|government-vacancies\/north-west/);
    assert.match(sitemap, /job-alert-terms\.html/);
    assert.match(sitemap, /<loc>https:\/\/dpsagovernmentjobs\.co\.za\/government-vacancies\/<\/loc>/);
    assert.match(sitemap, /circular-42-of-2026/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOutput === undefined) delete process.env.SITE_OUTPUT_DIR;
    else process.env.SITE_OUTPUT_DIR = previousOutput;
    await rm(output, { recursive: true, force: true });
  }
});

test("renders navigation links only for circulars that have published jobs", () => {
  const links = renderCircularNavigationItems([
    { name: "Circular 1 of 2026", path: "/dpsa-vacancy-circulars/circular-1-of-2026/", jobs: [{}] },
    { name: "Circular 2 of 2026", path: "/dpsa-vacancy-circulars/circular-2-of-2026/", jobs: [{}, {}] },
    { name: "Circular 3 of 2026", path: "/dpsa-vacancy-circulars/circular-3-of-2026/", jobs: [{}] },
    { name: "Circular 4 of 2026", path: "/dpsa-vacancy-circulars/circular-4-of-2026/", jobs: [{}] },
    { name: "Circular 5 of 2026", path: "/dpsa-vacancy-circulars/circular-5-of-2026/", jobs: [{}] },
    { name: "Circular 6 of 2026", path: "/dpsa-vacancy-circulars/circular-6-of-2026/", jobs: [] }
  ]);

  assert.deepEqual([...links.matchAll(/>(Circular \d+ of 2026)<span/g)].map(match => match[1]), [
    "Circular 5 of 2026",
    "Circular 4 of 2026",
    "Circular 3 of 2026",
    "Circular 2 of 2026"
  ]);
  assert.match(links, /Circular 2 of 2026<span class="nav-dropdown-count">2 jobs<\/span>/);
  assert.doesNotMatch(links, /Circular 1 of 2026|Circular 6 of 2026/);
});

test("keeps historical circular references available and maps old URLs to their section", () => {
  const links = renderPastCircularArchiveLinks();

  assert.doesNotMatch(links, /2025/);
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
  const national = groups.find(group => group.name === "National");
  const gautengPage = renderProvinceLandingPage("gauteng", gauteng.jobs);
  const nationalPage = renderProvinceLandingPage("National", national.jobs);
  const links = renderProvinceGuideLinks(groups);
  const sitemap = renderSitemapWithCircularArchives("<urlset>\n</urlset>", [], "2026-11-17", groups);

  assert.deepEqual(groups.map(group => group.name), ["Gauteng", "Western Cape", "National"]);
  assert.equal(gauteng.jobs.length, 2);
  assert.equal(national.jobs.length, 1);
  assert.match(links, /href="\/government-vacancies\/gauteng\/">Gauteng government vacancies<\/a><span>2 current vacancies/);
  assert.match(links, /href="\/government-vacancies\/national\/">National government vacancies<\/a><span>1 current vacancy/);
  assert.match(gautengPage, /<title>Government Vacancies in Gauteng \| Current DPSA Jobs<\/title>/);
  assert.match(gautengPage, /Looking for GPG vacancies\?/);
  assert.match(gautengPage, /not a complete list of all Gauteng Provincial Government or municipal recruitment/);
  assert.match(gautengPage, /Gauteng role/);
  assert.match(gautengPage, /"@type":"CollectionPage"/);
  assert.match(gautengPage, /"@type":"BreadcrumbList"/);
  assert.match(gautengPage, /Government vacancies by province<\/a> › Gauteng/);
  assert.match(gautengPage, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/);
  assert.equal((gautengPage.match(/data-ad-slot="3081508385"/g) ?? []).length, 1);
  assert.match(nationalPage, /<title>National Government Vacancies \| Current DPSA Jobs<\/title>/);
  assert.match(nationalPage, /not assigned to a specific province/i);
  assert.match(nationalPage, /Unknown location/);
  assert.match(sitemap, /<loc>https:\/\/dpsagovernmentjobs\.co\.za\/government-vacancies\/gauteng\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/dpsagovernmentjobs\.co\.za\/government-vacancies\/national\/<\/loc>/);
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

test("retains only the four newest circulars and keeps uncategorized jobs", () => {
  const jobs = [
    { id: "uncategorized" },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `circular-${index + 1}`,
      circularName: `Circular ${index + 1} of 2026`
    }))
  ];
  const result = retainLatestCircularJobs(jobs);

  assert.equal(MAX_ACTIVE_CIRCULARS, 4);
  assert.deepEqual(result.removedCircularNames, ["Circular 1 of 2026"]);
  assert.deepEqual(result.removedJobIds, ["circular-1"]);
  assert.deepEqual(result.jobs.map(job => job.id), ["uncategorized", "circular-2", "circular-3", "circular-4", "circular-5"]);
});

test("shows vacancies from the latest circular first while preserving order within each circular", () => {
  const jobs = [
    { id: "circ-2-a", slug: "circular-2-a", title: "Circular 2 A", company: "Department", category: "Health", circularName: "Circular 2 of 2026" },
    { id: "circ-1-a", slug: "circular-1-a", title: "Circular 1 A", company: "Department", category: "Health", circularName: "Circular 1 of 2026" },
    { id: "circ-1-b", slug: "circular-1-b", title: "Circular 1 B", company: "Department", category: "Health", circularName: "Circular 1 of 2026" },
    { id: "circ-1-last-year", slug: "circular-1-last-year", title: "Circular 1 Last Year", company: "Department", category: "Health", circularName: "Circular 1 of 2025" },
    { id: "other-category", slug: "other-category", title: "Other Category", company: "Department", category: "Education", circularName: "Circular 1 of 2026" },
    { id: "uncategorized", slug: "uncategorized", title: "Uncategorized", company: "Department", category: "Health" }
  ];
  const html = renderJobListings(jobs.filter(job => job.category === "Health"));
  const titleOrder = [...html.matchAll(/<h3><a [^>]+>([^<]+)<\/a><\/h3>/g)].map(match => match[1]);

  assert.deepEqual(titleOrder, ["Circular 2 A", "Circular 1 A", "Circular 1 B", "Circular 1 Last Year", "Uncategorized"]);
});

test("publishes the supplied salary table with a readable level guide and PDF actions", async () => {
  const page = await readFile(new URL("../national-treasury-salary-scales/index.html", import.meta.url), "utf8");
  const levels = [...page.matchAll(/<summary>Level \d+/g)];
  const monthlySalaries = [...page.matchAll(/<dt>Overall monthly salary<\/dt><dd>R([\d ]+)<\/dd>/g)]
    .map(([, amount]) => Number(amount.replace(/\s/g, "")));
  const monthlyAfterPaye = [...page.matchAll(/<dt>Estimated monthly salary after PAYE<\/dt><dd>R([\d ]+)<\/dd>/g)]
    .map(([, amount]) => Number(amount.replace(/\s/g, "")));

  assert.equal(levels.length, 12);
  assert.equal((page.match(/id="level-\d+"/g) ?? []).length, 12);
  assert.equal(monthlySalaries.length, 12);
  assert.equal(monthlyAfterPaye.length, 12);
  assert.doesNotMatch(page, /Overall monthly gain/);
  assert.deepEqual(monthlyAfterPaye, monthlySalaries.map(amount =>
    Math.round((amount * 12 - estimateAnnualIncomeTax(amount * 12)) / 12)
  ));
  assert.match(page, /2027 SARS rates for an under-65 taxpayer with the primary rebate/i);
  assert.match(page, /href="\.\/salary-adjustment-table\.pdf" download/);
  assert.match(page, /<iframe src="\.\/salary-adjustment-table\.pdf#view=FitH"/);
});

test("keeps hero employment filters visibly separated from the search form", async () => {
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(page, /<link rel="stylesheet" href="styles\.css\?v=20261117-search-highlight">/);
  const stylesheet = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(stylesheet, /\.employment-type-filters \{ margin: 36px 0 18px; \}/);
  assert.match(stylesheet, /-webkit-text-size-adjust: 100%; text-size-adjust: 100%;/);
  assert.match(stylesheet, /button, input, select, textarea \{ font: inherit; \}/);
});

test("highlights every visible vacancy-card match while typing a search", async () => {
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const stylesheet = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(page, /function appendSearchHighlight\(container, value, query\)/);
  assert.match(page, /jobQuery\.addEventListener\("input", filterJobListings\)/);
  assert.match(page, /job\.title, job\.company, job\.location, job\.centre, job\.province, job\.refNo,[\s\S]*job\.closingDate, job\.circularName, job\.requirements, job\.duties/);
  assert.match(page, /jobLink\.href = `\$\{jobPath\}\$\{searchTerm \? `\?q=/);
  assert.match(page, /bookmark\.dataset\.bookmarkUrl = jobPath/);
  for (const target of [
    "jobLink, displayTitle",
    "departmentLink, job.company",
    "locationText, locationLabel",
    "salaryText, job.salaryText",
    "levelLink, jobLevel",
    "closingDateText, `Closing: ${closingDate}`",
    "badge, label"
  ]) {
    assert.ok(page.includes(`appendSearchHighlight(${target}, searchTerm)`), `expected search highlighting for ${target}`);
  }
  assert.match(stylesheet, /\.search-highlight \{[^}]*background: rgba\(56,189,248,.3\)/);
});

test("discloses and gates CV and alert data sharing to the Google Sheet", async () => {
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const cvForm = page.slice(page.indexOf('<form id="cv-match-form"'), page.indexOf("</form>", page.indexOf('<form id="cv-match-form"')));
  const footer = page.slice(page.indexOf('<footer class="site-footer">'));
  assert.match(page, /id="cv-match-sheet-consent"[^>]*type="checkbox" required/);
  assert.doesNotMatch(cvForm, /Preferred province|Preferred department|cv-match-province|cv-match-department/);
  assert.match(cvForm, /class="cv-match-contact-row"[\s\S]*class="cv-match-file-field"[\s\S]*id="cv-match-file"[^>]*type="file"[\s\S]*class="cv-match-name-label"[\s\S]*placeholder="Your name"[\s\S]*class="cv-match-email-label"[\s\S]*placeholder="Your e-mail"[\s\S]*class="cv-match-terms-consent"[\s\S]*id="cv-match-sheet-consent"[^>]*type="checkbox" required[\s\S]*<a href="\/job-alert-terms\.html">Terms<\/a>[\s\S]*>Match my CV/);
  assert.match(cvForm, /PDF, Word \(\.docx\) or text file, up to 10 MB/);
  assert.match(cvForm, /placeholder="Your e-mail"/);
  assert.doesNotMatch(cvForm, /Your CV is read in this browser and is never uploaded or saved by this site/);
  assert.match(footer, /id="job-alert-consent"[^>]*type="checkbox" required/);
  assert.match(footer, /<a href="\/job-alert-terms\.html">Terms<\/a>/);
  assert.match(footer, /Get new government job alerts by email/);
  assert.match(footer, /id="job-alert-form" class="job-alert-form"/);
  assert.match(footer, /class="footer-subscribe-row"/);
  assert.match(footer, /id="job-alert-name"[^>]*placeholder="Your name"/);
  assert.match(footer, /id="job-alert-email"[^>]*placeholder="Your e-mail"/);
  assert.match(footer, /class="footer-field-divider"/);
  assert.match(footer, /class="job-alert-consent footer-terms-consent".*?<a href="\/job-alert-terms\.html">Terms<\/a><\/label>\s*<button class="button" type="submit">Subscribe/s);
  assert.match(footer, />Terms<\/a><\/label>/);
  assert.doesNotMatch(footer, /Preferred province|Preferred department|job-alert-province|job-alert-department|job-alert-sheet-consent/);
  assert.doesNotMatch(footer, /I agree to receive job-alert emails for these preferences|Alert details are recorded in the DPSAWebsite Google Sheet/);
  assert.doesNotMatch(cvForm, /job-alert-form|Get new government job alerts by email/);
  const terms = await readFile(new URL("../job-alert-terms.html", import.meta.url), "utf8");
  assert.match(terms, /the original CV file is not uploaded to or stored by this website/);
  assert.match(terms, /your name, email address and extracted CV text are sent to our CV matching service and retained/);
  assert.match(terms, /Uploading a CV does not subscribe you to job alerts/);
  assert.match(terms, /confirm your email address/);
  assert.match(terms, /Unsubscribing stops future alerts but does not automatically delete the associated record/);
  assert.match(terms, /official advert and hiring department’s instructions take precedence/);
  assert.match(terms, /except where liability cannot lawfully be excluded/);
  assert.doesNotMatch(terms, /Google Sheets|Google Sheet|DPSAWebsite/);
  assert.match(terms, /does not automatically delete the associated record/);
  assert.match(page, /province: "all",\s+department: "all"/);
  assert.match(page, /api\/cv-matches/);
});

test("loads AdSense once and provides a responsive ad unit on monetizable static pages", async () => {
  const pages = [
    "../index.html",
    "../404.html",
    "../job-alert-terms.html",
    "../government-vacancies/index.html",
    "../dpsa-vacancy-circulars/index.html",
    "../how-to-apply/index.html",
    "../national-treasury-salary-scales/index.html"
  ];
  const loaderUrl = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3860151941190347";

  for (const pagePath of pages) {
    const html = await readFile(new URL(pagePath, import.meta.url), "utf8");
    assert.equal(html.split(loaderUrl).length - 1, 1, `${pagePath} must load AdSense exactly once`);
    const expectedAdUnits = pagePath === "../404.html" ? 0 : 1;
    assert.equal(html.split('data-ad-slot="3081508385"').length - 1, expectedAdUnits, `${pagePath} must have the intended number of manual ad units`);
    if (expectedAdUnits) {
      assert.match(html, /data-ad-format="auto" data-full-width-responsive="true"/, `${pagePath} must use a responsive ad unit`);
    }
    assert.match(html, /<body class="post-theme(?: home-page)?"(?: [^>]*)?>/, `${pagePath} must use the shared post theme`);
    assert.match(html, /<script type="module" src="\/redirects\.js"><\/script>/, `${pagePath} must include URL redirects`);
  }
});

test("provides a noindex saved-vacancies page connected to the existing bookmark store", async () => {
  const page = await readFile(new URL("../saved-vacancies/index.html", import.meta.url), "utf8");
  const bookmarks = await readFile(new URL("../bookmark.js", import.meta.url), "utf8");

  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /href="\/saved-vacancies\/">Saved vacancies<\/a>/);
  assert.match(page, /data-saved-vacancies-list/);
  assert.match(page, /data-saved-vacancies-status/);
  assert.match(page, /src="\/bookmark\.js\?v=20261117-saved-card-layout" defer/);
  assert.match(bookmarks, /localStorage\.getItem\(STORAGE_KEY\)/);
  assert.match(bookmarks, /renderSavedVacancies\(\);/);
  assert.match(bookmarks, /link\.textContent = vacancy\.title/);
  assert.match(bookmarks, /card\.className = "listing-card saved-vacancy-card"/);
  assert.match(bookmarks, /button\.dataset\.bookmarkImage/);
  assert.match(bookmarks, /listing-card-bottom/);
  assert.match(bookmarks, /textContent = "View vacancy"/);
  assert.match(bookmarks, /button\.dataset\.bookmarkCompany/);
  assert.match(bookmarks, /new URL\(parsedUrl\.pathname, "https:\/\/dpsagovernmentjobs\.co\.za"\)\.href/);
  assert.match(bookmarks, /SAVED_VACANCY_HOSTS\.has\(parsedUrl\.hostname\)/);
  assert.match(bookmarks, /SAVED_VACANCY_HOSTS\.has\(parsedUrl\.hostname\)/);
});

test("adds the circular navigation slot to every static page and embeds the application video", async () => {
  const pages = [
    "../index.html",
    "../404.html",
    "../dpsa-vacancy-circulars/index.html",
    "../how-to-apply/index.html",
    "../national-treasury-salary-scales/index.html"
  ];

  for (const pagePath of pages) {
    const html = await readFile(new URL(pagePath, import.meta.url), "utf8");
    assert.match(html, /<details class="nav-dropdown"><summary>Circulars<\/summary>/, `${pagePath} must use the circular dropdown`);
    assert.equal(html.split("<!-- CIRCULAR_NAV_ITEMS -->").length - 1, 1, `${pagePath} must have one build-time circular list`);
  }

  const guide = await readFile(new URL("../how-to-apply/index.html", import.meta.url), "utf8");
  assert.match(guide, /youtube-nocookie\.com\/embed\/8oNXApid12s/);
  assert.match(guide, /title="How to apply for a government vacancy" loading="lazy"/);
  assert.match(guide, /https:\/\/www\.youtube\.com\/watch\?v=8oNXApid12s/);
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

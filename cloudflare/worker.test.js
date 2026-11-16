import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.js";

function makeJob(overrides = {}) {
  const now = new Date();
  const circularDate = `${now.getUTCDate()} ${now.toLocaleString("en-ZA", { month: "long", timeZone: "UTC" })} ${now.getUTCFullYear()}`;
  return {
    id: "assistant-director-example",
    title: "ASSISTANT DIRECTOR: EXAMPLE",
    company: "Department of Health",
    location: "Limpopo",
    category: "Health",
    type: "Contract",
    salary: 300000,
    salaryText: "R300 000 per annum",
    posted: "Closing date: 31 December 2099 @16:00",
    logo: "d",
    color: "#eaf1e2",
    logoColor: "#64803f",
    sourceUrl: "https://www.dpsa.gov.za/example.pdf",
    centre: "Polokwane",
    circularName: "Circular 1 of 2099",
    circularDate,
    circularPage: "3",
    postNo: "1/1",
    refNo: "EXAMPLE/1",
    province: "Limpopo",
    closingDate: "31 December 2099 @16:00",
    requirements: "A relevant qualification and experience working in the public health sector.",
    duties: "Manage the service, support staff, prepare reports and ensure that operational requirements are met.",
    applications: "Submit the completed application form using the official department instructions.",
    ...overrides
  };
}

function createEnv(jobs, token = "test-token") {
  return {
    ADMIN_TOKEN: token,
    JOBS: {
      async get() {
        return structuredClone(jobs);
      },
      async put() {
        return undefined;
      }
    }
  };
}

test("vacancy route renders unique metadata, full details and valid structured data", async () => {
  const job = makeJob({
    requirements: "- A relevant qualification.\n- At least three years of experience.",
    duties: "- Manage the service.\n- Support staff and prepare reports."
  });
  const slug = "assistant-director-example-1-1-example-1";
  const response = await worker.fetch(new Request(`https://jobs.example/${slug}/`), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<title>Assistant Director: Example at Department of Health \| DPSA Government Jobs<\/title>/);
  assert.equal(html.split("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3860151941190347").length - 1, 1);
  const adLoaderIndex = html.indexOf('<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js');
  assert.ok(html.indexOf('<link rel="preconnect" href="https://pagead2.googlesyndication.com"') < adLoaderIndex);
  assert.ok(adLoaderIndex < html.indexOf("https://fonts.googleapis.com/css2?family=Jost"));
  assert.ok(html.includes(`<link rel="canonical" href="https://jobs.example/${slug}/">`));
  assert.match(html, /<strong>Reference:<\/strong> EXAMPLE\/1/);
  assert.match(html, /<strong>Post number:<\/strong> 1\/1/);
  assert.match(html, /<strong>Published:<\/strong> Circular 1 of 2099/);
  assert.match(html, /<strong>Date:<\/strong> \d{1,2} [A-Za-z]+ \d{4}/);
  assert.match(html, /<strong>Page on Circular:<\/strong> Page 3/);
  assert.match(html, /Read\/Download the official vacancy advert on <a href="https:\/\/www\.dpsa\.gov\.za\/example\.pdf"[^>]*>Circular 1 of 2099<\/a>/);
  assert.doesNotMatch(html, /Read the official vacancy advert or circular|View official advert|Published in Circular/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/DPSAGovernmentJobs"/);
  assert.match(html, /href="https:\/\/x\.com\/dpsajobs"/);
  assert.match(html, /href="https:\/\/za\.pinterest\.com\/dpsavacancies\/"/);
  assert.match(html, /<h2 id="share-post-title">Share this post<\/h2>/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=https%3A%2F%2Fjobs\.example%2Fassistant-director-example-1-1-example-1%2F"/);
  assert.match(html, /href="https:\/\/twitter\.com\/intent\/tweet\?url=https%3A%2F%2Fjobs\.example%2Fassistant-director-example-1-1-example-1%2F&amp;text=Assistant\+Director%3A\+Example"/);
  assert.match(html, /href="https:\/\/pinterest\.com\/pin\/create\/button\/\?url=https%3A%2F%2Fjobs\.example%2Fassistant-director-example-1-1-example-1%2F&amp;media=https%3A%2F%2Fdpsagovernmentjobs\.co\.za%2Fsouth-african-coat-of-arms\.png&amp;description=Assistant\+Director%3A\+Example"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/dpsagovernmentjobs\.co\.za\/south-african-coat-of-arms\.png">/);
  assert.match(html, /font-family:"Jost",Arial,Helvetica,sans-serif/);
  assert.match(html, /\.job-title\{[^}]*font-size:20px/);
  assert.match(html, /\.meta\{[^}]*font-size:16px/);
  assert.match(html, /src="https:\/\/dpsagovernmentjobs\.co\.za\/south-african-coat-of-arms\.png" alt="South African coat of arms" width="58" height="58"/);
  assert.match(html, /class="site-header"/);
  assert.doesNotMatch(html, /<link rel="stylesheet"/);
  assert.match(html, /Requirements/);
  const adIndex = html.indexOf('<aside class="content-ad" aria-label="Advertisement">');
  const requirementsIndex = html.indexOf("<h2>Requirements</h2>");
  assert.ok(adIndex >= 0 && adIndex < requirementsIndex);
  assert.equal(html.split('data-ad-slot="3081508385"').length - 1, 1);
  assert.match(html, /data-ad-client="ca-pub-3860151941190347" data-ad-slot="3081508385"><\/ins><script>\(adsbygoogle = window\.adsbygoogle \|\| \[\]\)\.push\(\{\}\);<\/script>/);
  assert.match(html, /<ul><li>A relevant qualification\.<\/li><li>At least three years of experience\.<\/li><\/ul>/);
  assert.match(html, /id="how-to-apply"/);
  assert.match(html, /<ul><li>Manage the service\.<\/li><li>Support staff and prepare reports\.<\/li><\/ul>/);
  assert.match(html, /Hiring department:<\/strong> Department of Health/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(jsonLd);
  const structuredData = JSON.parse(jsonLd[1]);
  assert.equal(structuredData["@type"], "JobPosting");
  assert.equal(structuredData.hiringOrganization.name, job.company);
  assert.equal(structuredData.jobLocation.address.addressLocality, "Polokwane");
  assert.equal(structuredData.jobLocation.address.addressRegion, "Limpopo");
  assert.equal(structuredData.validThrough, "2099-12-31T16:00:00+02:00");
  assert.match(structuredData.description, /<ul><li>A relevant qualification/);
});

test("legacy salary descriptions exclude unrelated prose after the salary and level", async () => {
  const job = makeJob({
    salaryText: "R487 197 – R573 897 per annum (Level 09). The successful candidate will be required to sign a performance agreement."
  });
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-example-1-1-example-1/"), createEnv([job]));
  const html = await response.text();
  const apiResponse = await worker.fetch(new Request("https://jobs.example/api/jobs"), createEnv([job]));
  const [publicJob] = await apiResponse.json();

  assert.match(html, /R487 197 – R573 897 per annum \(Level 09\)/);
  assert.doesNotMatch(html, /Salary:<\/strong>[^<]*performance agreement/);
  assert.equal(publicJob.salaryText, "R487 197 – R573 897 per annum (Level 09)");
});

test("vacancy URLs combine the normalized title, post number and reference number", async () => {
  const job = makeJob({
    title: "ASSISTANT DIRECTOR: SECURITY MANAGEMENT",
    postNo: "41/100",
    refNo: "2026/165/OCJ"
  });
  const env = createEnv([job]);
  const canonicalPath = "/assistant-director-security-management-41-100-2026-165-ocj/";
  const canonicalResponse = await worker.fetch(new Request(`https://jobs.example${canonicalPath}`), env);
  const html = await canonicalResponse.text();

  assert.equal(canonicalResponse.status, 200);
  assert.ok(html.includes(`<link rel="canonical" href="https://jobs.example${canonicalPath}">`));

  const legacyResponse = await worker.fetch(new Request(`https://jobs.example/jobs/${job.id}/`), env);
  assert.equal(legacyResponse.status, 301);
  assert.equal(legacyResponse.headers.get("Location"), `https://jobs.example${canonicalPath}`);
  const oldSlugResponse = await worker.fetch(new Request(`https://jobs.example/jobs/${canonicalPath.slice(1, -1)}/`), env);
  assert.equal(oldSlugResponse.status, 301);
  assert.equal(oldSlugResponse.headers.get("Location"), `https://jobs.example${canonicalPath}`);
});

test("generic employer data is not presented as the hiring department or marked up as a JobPosting", async () => {
  const job = makeJob({ company: "South African Public Service", centre: "Labour", location: "Labour" });
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-example-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Hiring department:<\/strong> Check the official advert/);
  assert.doesNotMatch(html, /The South African Public Service/);
  assert.doesNotMatch(html, /application\/ld\+json/);
  assert.match(html, /Location\/centre in advert:<\/strong> Limpopo/);
  assert.doesNotMatch(html, /based in Labour/);
});

test("legacy DPSA records use verified facts and emit JobPosting markup when the expiry date is absent", async () => {
  const job = makeJob({
    id: "dpsa-dpsa-circular-41-of-2026-41-20-hr4-4-11-26-client-service-officer-employer-services",
    title: "CLIENT SERVICE OFFICER: EMPLOYER SERVICES",
    company: "South African Public Service",
    location: "Labour",
    centre: "Labour",
    type: "Permanent",
    salary: 280278,
    salaryText: "R280 278 per annum",
    sourceUrl: "https://www.dpsa.gov.za/dpsa2g/documents/vacancies/2026/PSV%20CIRCULAR%2041%20of%202026.pdf",
    circularName: "Circular 41 of 2026",
    circularDate: "13 November 2026",
    circularPage: "17",
    postNo: "41/20",
    refNo: "HR4/4/11/26",
    province: "",
    closingDate: "",
    posted: "Closing date: check official advert",
    requirements: "Grade 12 / Senior Certificate. No experience required. Knowledge of Unemployment Insurance laws, public finance, privacy requirements and departmental policies. Strong communication and customer service skills are required.",
    duties: "Provide screening services, process applications for UIF benefits, register payment continuation forms and perform administrative functions.",
    applications: "Deputy Director: Labour Centre Operations, IG Building, Ensuco House, NR Hill and Church Streets, East London, 5201. Email: Jobs-ECELN@labour.gov.za",
    enquiries: "Mr M Njamela, telephone (043) 702 7500."
  });
  const env = createEnv([job]);
  const pageResponse = await worker.fetch(new Request("https://jobs.example/client-service-officer-employer-services-41-20-hr4-4-11-26/"), env);
  const html = await pageResponse.text();
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);

  assert.equal(pageResponse.status, 200);
  assert.match(html, /The Department of Employment and Labour invites applications/);
  assert.match(html, /<strong>Published:<\/strong> Circular 41 of 2026/);
  assert.match(html, /<strong>Date:<\/strong> 13 November 2026/);
  assert.match(html, /<strong>Page on Circular:<\/strong> Page 17/);
  assert.match(html, /Read\/Download the official vacancy advert on <a href="https:\/\/www\.dpsa\.gov\.za\/dpsa2g\/documents\/vacancies\/2026\/PSV%20CIRCULAR%2041%20of%202026\.pdf"[^>]*>Circular 41 of 2026<\/a>/);
  assert.equal(html.split("https://www.dpsa.gov.za/dpsa2g/documents/vacancies/2026/PSV%20CIRCULAR%2041%20of%202026.pdf").length - 1, 1);
  assert.doesNotMatch(html, /Read the official vacancy advert or circular|View official advert|Published in Circular/);
  assert.match(html, /Location\/centre in advert:<\/strong> KuGompo City/);
  assert.ok(jsonLd);
  const structuredData = JSON.parse(jsonLd[1]);
  assert.equal(structuredData["@type"], "JobPosting");
  assert.equal(structuredData.hiringOrganization.name, "Department of Employment and Labour");
  assert.equal(structuredData.jobLocation.address.addressLocality, "KuGompo City");
  assert.equal(structuredData.jobLocation.address.addressRegion, "Eastern Cape");
  assert.equal(structuredData.jobLocation.address.addressCountry, "ZA");
  assert.equal(structuredData.validThrough, undefined);
  assert.equal(structuredData.directApply, true);

  const apiResponse = await worker.fetch(new Request("https://jobs.example/api/jobs"), env);
  const [publicJob] = await apiResponse.json();
  assert.equal(publicJob.company, "Department of Employment and Labour");
  assert.equal(publicJob.location, "KuGompo City");
});

test("untrusted vacancy text is escaped in the page and structured data", async () => {
  const job = makeJob({ duties: "</script><script>alert('x')</script>" });
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-example-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;alert/);
});

test("sitemap excludes expired jobs and unknown job IDs return 404", async () => {
  const active = makeJob();
  const expired = makeJob({
    id: "closed-post",
    title: "CLOSED POST",
    closingDate: "1 January 2020",
    posted: "Closing date: 1 January 2020"
  });
  const env = createEnv([active, expired]);
  const sitemapResponse = await worker.fetch(new Request("https://jobs.example/sitemap.xml"), env);
  const sitemap = await sitemapResponse.text();

  assert.equal(sitemapResponse.status, 200);
  assert.match(sitemap, /\/assistant-director-example-1-1-example-1\//);
  assert.doesNotMatch(sitemap, /closed-post/);

  const closedResponse = await worker.fetch(new Request("https://jobs.example/closed-post-1-1-example-1/"), env);
  assert.equal(closedResponse.status, 410);
  assert.equal(closedResponse.headers.get("X-Robots-Tag"), "noindex");
  const missingResponse = await worker.fetch(new Request("https://jobs.example/missing-title-and-reference/"), env);
  assert.equal(missingResponse.status, 404);

  const indexResponse = await worker.fetch(new Request("https://jobs.example/jobs/"), env);
  assert.equal(indexResponse.status, 301);
  assert.equal(indexResponse.headers.get("Location"), "https://dpsagovernmentjobs.co.za/#listings");
});

test("public API hides expired jobs while authenticated admin reads retain them", async () => {
  const active = makeJob();
  const expired = makeJob({ id: "closed-post", closingDate: "1 January 2020" });
  const env = createEnv([active, expired]);

  const publicResponse = await worker.fetch(new Request("https://jobs.example/api/jobs"), env);
  assert.deepEqual((await publicResponse.json()).map(job => job.id), [active.id]);

  const adminResponse = await worker.fetch(new Request("https://jobs.example/api/jobs", {
    headers: { Authorization: "Bearer test-token" }
  }), env);
  assert.deepEqual((await adminResponse.json()).map(job => job.id), [active.id, expired.id]);
});

test("robots endpoint advertises the live Worker sitemap", async () => {
  const response = await worker.fetch(new Request("https://jobs.example/robots.txt"), createEnv([]));
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /Allow: \/\nSitemap: https:\/\/jobs\.example\/sitemap\.xml/);
});

test("ads.txt authorizes the configured AdSense publisher", async () => {
  const response = await worker.fetch(new Request("https://jobs.example/ads.txt"), createEnv([]));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal(await response.text(), "google.com, pub-3860151941190347, DIRECT, f08c47fec0942fa0\n");
});

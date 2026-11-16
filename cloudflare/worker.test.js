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
  const job = makeJob();
  const response = await worker.fetch(new Request(`https://jobs.example/jobs/${job.id}/`), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<title>Assistant Director: Example at Department of Health \| DPSA Government Jobs<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/jobs\.example\/jobs\/assistant-director-example\/">/);
  assert.match(html, /Read the official vacancy advert or circular/);
  assert.match(html, /Requirements/);
  assert.match(html, /Hiring department:<\/strong> Department of Health/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(jsonLd);
  const structuredData = JSON.parse(jsonLd[1]);
  assert.equal(structuredData["@type"], "JobPosting");
  assert.equal(structuredData.hiringOrganization.name, job.company);
  assert.equal(structuredData.jobLocation.address.addressLocality, "Polokwane");
  assert.equal(structuredData.jobLocation.address.addressRegion, "Limpopo");
  assert.equal(structuredData.validThrough, "2099-12-31T16:00:00+02:00");
});

test("generic employer data is not presented as the hiring department or marked up as a JobPosting", async () => {
  const job = makeJob({ company: "South African Public Service", centre: "Labour", location: "Labour" });
  const response = await worker.fetch(new Request(`https://jobs.example/jobs/${job.id}/`), createEnv([job]));
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
  const pageResponse = await worker.fetch(new Request(`https://jobs.example/jobs/${job.id}/`), env);
  const html = await pageResponse.text();
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);

  assert.equal(pageResponse.status, 200);
  assert.match(html, /The Department of Employment and Labour invites applications/);
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
  const response = await worker.fetch(new Request(`https://jobs.example/jobs/${job.id}/`), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;alert/);
});

test("sitemap excludes expired jobs and unknown job IDs return 404", async () => {
  const active = makeJob();
  const expired = makeJob({
    id: "closed-post",
    closingDate: "1 January 2020",
    posted: "Closing date: 1 January 2020"
  });
  const env = createEnv([active, expired]);
  const sitemapResponse = await worker.fetch(new Request("https://jobs.example/sitemap.xml"), env);
  const sitemap = await sitemapResponse.text();

  assert.equal(sitemapResponse.status, 200);
  assert.match(sitemap, /\/jobs\/assistant-director-example\//);
  assert.doesNotMatch(sitemap, /closed-post/);

  const closedResponse = await worker.fetch(new Request("https://jobs.example/jobs/closed-post/"), env);
  assert.equal(closedResponse.status, 410);
  assert.equal(closedResponse.headers.get("X-Robots-Tag"), "noindex");
  const missingResponse = await worker.fetch(new Request("https://jobs.example/jobs/missing/"), env);
  assert.equal(missingResponse.status, 404);
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
  assert.match(body, /Sitemap: https:\/\/jobs\.example\/sitemap\.xml/);
});

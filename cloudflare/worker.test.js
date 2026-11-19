import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import worker from "./worker.js";
import { jobPagePath } from "../vacancy-url.js";

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
  const values = new Map([["published-jobs", JSON.stringify(jobs)]]);
  return {
    ADMIN_TOKEN: token,
    JOBS: {
      async get(key = "published-jobs", type) {
        const value = values.get(key);
        if (value === undefined) return null;
        if (type === "json" || key === "published-jobs") return structuredClone(JSON.parse(value));
        return value;
      },
      async put(key, value) {
        values.set(key, String(value));
        return undefined;
      },
      async delete(key) {
        values.delete(key);
      },
      async list({ prefix }) {
        return {
          keys: [...values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })),
          list_complete: true
        };
      }
    }
  };
}

function alertSignupRequest(overrides = {}) {
  return new Request("https://jobs.example/api/alerts/subscribe", {
    method: "POST",
    headers: {
      Origin: "https://dpsagovernmentjobs.co.za",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: "Test Applicant",
      email: "applicant@example.com",
      province: "Limpopo",
      department: "Department of Health",
      consent: true,
      sheetConsent: true,
      ...overrides
    })
  });
}

function cvMatchRequest(overrides = {}) {
  return new Request("https://jobs.example/api/cv-matches", {
    method: "POST",
    headers: {
      Origin: "https://dpsagovernmentjobs.co.za",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: "Test Applicant",
      email: "applicant@example.com",
      province: "Limpopo",
      department: "Department of Health",
      cvText: "Registered nurse with clinical experience and patient care skills. Nursing practice, assessment, hospital work and health records.",
      sheetConsent: true,
      ...overrides
    })
  });
}

test("auto-publish settings are authenticated, default off and persist when changed", async () => {
  const env = createEnv([]);
  const endpoint = "https://jobs.example/api/automation/settings";
  const unauthenticated = await worker.fetch(new Request(endpoint), env);
  assert.equal(unauthenticated.status, 401);

  const initial = await worker.fetch(new Request(endpoint, {
    headers: { Authorization: "Bearer test-token" }
  }), env);
  assert.deepEqual(await initial.json(), { enabled: false });

  const enabled = await worker.fetch(new Request(endpoint, {
    method: "PUT",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true })
  }), env);
  assert.deepEqual(await enabled.json(), { success: true, enabled: true });

  const persisted = await worker.fetch(new Request(endpoint, {
    headers: { Authorization: "Bearer test-token" }
  }), env);
  assert.deepEqual(await persisted.json(), { enabled: true });
});

test("Google indexing requests require admin auth, a published vacancy, and service-account credentials", async () => {
  const env = createEnv([makeJob()]);
  const endpoint = "https://jobs.example/api/indexing/request";
  const body = JSON.stringify({ jobId: "assistant-director-example" });
  const unauthenticated = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  }), env);
  assert.equal(unauthenticated.status, 401);

  const missingCredentials = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body
  }), env);
  assert.equal(missingCredentials.status, 503);
  assert.match((await missingCredentials.json()).error, /GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON/);

  env.GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON = "{}";
  const unpublished = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: "not-published" })
  }), env);
  assert.equal(unpublished.status, 404);
});

test("Google indexing requests sign in with the configured service account and notify Google of the vacancy URL", async t => {
  const env = createEnv([makeJob()]);
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  env.GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: "service_account",
    client_email: "dsgjo-google-indexing@dsgjo-website-indexing.iam.gserviceaccount.com",
    private_key: privateKey,
    token_uri: "https://oauth2.googleapis.com/token"
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const requestUrl = String(input);
    requests.push({ url: requestUrl, init });
    if (requestUrl === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      assert.equal(form.get("assertion").split(".").length, 3);
      return Response.json({ access_token: "google-access-token" });
    }
    assert.equal(init.headers.Authorization, "Bearer google-access-token");
    if (requestUrl === "https://indexing.googleapis.com/v3/urlNotifications:publish") {
      return Response.json({
        urlNotificationMetadata: {
          url: "https://jobs.dpsagovernmentjobs.co.za/assistant-director-1-1-example-1/",
          latestUpdate: { notifyTime: "2026-11-19T07:00:00Z" }
        }
      });
    }
    assert.equal(requestUrl, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect");
    assert.deepEqual(JSON.parse(init.body), {
      inspectionUrl: "https://jobs.dpsagovernmentjobs.co.za/assistant-director-1-1-example-1/",
      siteUrl: "sc-domain:dpsagovernmentjobs.co.za",
      languageCode: "en-US"
    });
    return Response.json({
      inspectionResult: {
        indexStatusResult: {
          verdict: "PASS",
          coverageState: "Submitted and indexed",
          indexingState: "INDEXING_ALLOWED",
          lastCrawlTime: "2026-11-19T07:15:00Z",
          googleCanonical: "https://jobs.dpsagovernmentjobs.co.za/assistant-director-1-1-example-1/"
        }
      }
    });
  });

  const response = await worker.fetch(new Request("https://jobs.example/api/indexing/request", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: "assistant-director-example" })
  }), env);
  const responseBody = await response.json();
  assert.equal(response.status, 200, JSON.stringify(responseBody));
  assert.equal(requests[1].url, "https://indexing.googleapis.com/v3/urlNotifications:publish");
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    url: "https://jobs.dpsagovernmentjobs.co.za/assistant-director-1-1-example-1/",
    type: "URL_UPDATED"
  });
  assert.deepEqual(responseBody, {
    success: true,
    url: "https://jobs.dpsagovernmentjobs.co.za/assistant-director-1-1-example-1/",
    notificationTime: "2026-11-19T07:00:00Z",
    historySaved: true
  });
  assert.equal(requests.length, 2);

  const historyResponse = await worker.fetch(new Request("https://jobs.example/api/indexing/history", {
    headers: { Authorization: "Bearer test-token" }
  }), env);
  const history = await historyResponse.json();
  assert.equal(history.submissions.length, 1);
  assert.equal(history.submissions[0].title, "Assistant Director: Example");
  assert.equal(history.submissions[0].submissionCount, 1);

  const inspectionResponse = await worker.fetch(new Request("https://jobs.example/api/indexing/inspect", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ url: history.submissions[0].url })
  }), env);
  const inspection = await inspectionResponse.json();
  assert.equal(inspectionResponse.status, 200);
  assert.equal(inspection.submission.indexStatus.verdict, "PASS");
  assert.equal((await env.JOBS.get("google-indexing:history", "json"))[0].inspectedAt.length > 0, true);
  assert.equal(requests.length, 4);
});

test("Google indexing history and inspection require admin authorization and only inspect tracked URLs", async () => {
  const env = createEnv([]);
  const history = await worker.fetch(new Request("https://jobs.example/api/indexing/history"), env);
  assert.equal(history.status, 401);
  env.GOOGLE_INDEXING_SERVICE_ACCOUNT_JSON = "{}";
  const inspection = await worker.fetch(new Request("https://jobs.example/api/indexing/inspect", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://jobs.dpsagovernmentjobs.co.za/example/" })
  }), env);
  assert.equal(inspection.status, 404);
});

test("auto-publish history validates and returns successful circular publication timestamps", async () => {
  const env = createEnv([]);
  const endpoint = "https://jobs.example/api/automation/publications";
  const publishedAt = "2026-11-18T18:00:00.000Z";
  const record = {
    circularName: "Circular 42 of 2026",
    publishedAt,
    jobCount: 123
  };
  const invalid = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ publications: [{ ...record, jobCount: 0 }] })
  }), env);
  assert.equal(invalid.status, 400);

  const recorded = await worker.fetch(new Request(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ publications: [record] })
  }), env);
  assert.deepEqual(await recorded.json(), { success: true, publications: [record] });

  const history = await worker.fetch(new Request(endpoint, {
    headers: { Authorization: "Bearer test-token" }
  }), env);
  assert.deepEqual(await history.json(), { publications: [record] });
});

test("job alert subscriptions require explicit consent and a permitted site origin", async () => {
  const unconfigured = createEnv([makeJob()]);
  const unavailable = await worker.fetch(alertSignupRequest(), unconfigured);
  assert.equal(unavailable.status, 503);

  const configured = createEnv([makeJob()]);
  configured.RESEND_API_KEY = "test-resend-key";
  configured.ALERTS_FROM_EMAIL = "alerts@example.com";
  configured.SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/test/exec";
  configured.SHEETS_WEBHOOK_SECRET = "test-sheet-secret";
  const missingConsent = await worker.fetch(alertSignupRequest({ consent: false }), configured);
  assert.equal(missingConsent.status, 400);
  for (let attempt = 0; attempt < 5; attempt++) {
    const limitedRequest = new Request("https://jobs.example/api/alerts/subscribe", {
      method: "POST",
      headers: {
        Origin: "https://dpsagovernmentjobs.co.za",
        "CF-Connecting-IP": "192.0.2.10",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name: "Test Applicant", email: `applicant${attempt}@example.com`, consent: false })
    });
    assert.equal((await worker.fetch(limitedRequest, configured)).status, 400);
  }
  const rateLimited = await worker.fetch(new Request("https://jobs.example/api/alerts/subscribe", {
    method: "POST",
    headers: {
      Origin: "https://dpsagovernmentjobs.co.za",
      "CF-Connecting-IP": "192.0.2.10",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: "Test Applicant", email: "sixth@example.com", consent: true })
  }), configured);
  assert.equal(rateLimited.status, 429);

  const preflight = await worker.fetch(new Request("https://jobs.example/api/alerts/subscribe", {
    method: "OPTIONS",
    headers: { Origin: "https://dpsagovernmentjobs.co.za" }
  }), configured);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://dpsagovernmentjobs.co.za");

  const forbiddenOrigin = await worker.fetch(new Request("https://jobs.example/api/alerts/subscribe", {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test Applicant", email: "applicant@example.com", consent: true })
  }), configured);
  assert.equal(forbiddenOrigin.status, 403);
});

test("confirmed alert subscribers receive only new jobs matching their preferences and can unsubscribe", async t => {
  const sentEmails = [];
  const sheetRecords = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "https://api.resend.com/emails") {
      sentEmails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: `email-${sentEmails.length}` }), { status: 200 });
    }
    assert.equal(url, "https://script.google.com/macros/s/test/exec");
    const record = JSON.parse(init.body);
    assert.equal(record.secret, "test-sheet-secret");
    sheetRecords.push(record);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
  const env = createEnv([makeJob()]);
  env.RESEND_API_KEY = "test-resend-key";
  env.ALERTS_FROM_EMAIL = "DPSA Alerts <alerts@example.com>";
  env.SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/test/exec";
  env.SHEETS_WEBHOOK_SECRET = "test-sheet-secret";

  const signup = await worker.fetch(alertSignupRequest(), env);
  assert.equal(signup.status, 202);
  assert.equal(sentEmails.length, 1);
  assert.equal(sheetRecords[0].recordType, "email_alert");
  assert.equal(sheetRecords[0].status, "pending");
  const confirmationToken = sentEmails[0].text.match(/api\/alerts\/confirm\?token=([a-f0-9]{64})/)[1];
  const confirmation = await worker.fetch(new Request(
    `https://jobs.example/api/alerts/confirm?token=${confirmationToken}`
  ), env);
  assert.equal(confirmation.status, 200);
  assert.match(await confirmation.text(), /Confirm email address/);
  const pendingSubscriberKey = [...(await env.JOBS.list({ prefix: "job-alerts:subscriber:" })).keys][0].name;
  assert.equal((await env.JOBS.get(pendingSubscriberKey, "json")).status, "pending");
  const confirmedResponse = await worker.fetch(new Request("https://jobs.example/api/alerts/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: confirmationToken })
  }), env);
  assert.equal(confirmedResponse.status, 200);
  assert.match(await confirmedResponse.text(), /Your email is confirmed/);

  const subscriberKey = [...(await env.JOBS.list({ prefix: "job-alerts:subscriber:" })).keys][0].name;
  const subscriber = await env.JOBS.get(subscriberKey, "json");
  assert.equal(subscriber.status, "confirmed");
  assert.equal(subscriber.province, "Limpopo");
  assert.equal(subscriber.department, "Department of Health");
  assert.ok(subscriber.consentedAt);
  assert.equal(sheetRecords[1].status, "confirmed");

  const matchingJob = makeJob({
    id: "new-health-post",
    title: "Professional Nurse",
    company: "Department of Health",
    province: "Limpopo"
  });
  const otherJob = makeJob({
    id: "new-gauteng-post",
    title: "Professional Nurse",
    company: "Department of Health",
    province: "Gauteng"
  });
  const pendingTasks = [];
  const publish = await worker.fetch(new Request("https://jobs.example/api/jobs", {
    method: "PUT",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify([makeJob(), matchingJob, otherJob])
  }), env, { waitUntil(task) { pendingTasks.push(task); } });
  assert.equal(publish.status, 200);
  await Promise.all(pendingTasks);
  assert.equal(sentEmails.length, 2);
  assert.match(sentEmails[1].html, /new-health-post|Professional Nurse/);
  assert.doesNotMatch(sentEmails[1].html, /new-gauteng-post/);
  assert.match(sentEmails[1].headers["List-Unsubscribe"], /api\/alerts\/unsubscribe\?token=/);

  const unsubscribeToken = subscriber.unsubscribeToken;
  const unsubscribePage = await worker.fetch(new Request(
    `https://jobs.example/api/alerts/unsubscribe?token=${unsubscribeToken}`
  ), env);
  assert.match(await unsubscribePage.text(), /Select unsubscribe/);
  assert.equal((await env.JOBS.get(subscriberKey, "json")).status, "confirmed");
  const unsubscribed = await worker.fetch(new Request(
    `https://jobs.example/api/alerts/unsubscribe?token=${unsubscribeToken}`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }
  ), env);
  assert.equal(unsubscribed.status, 200);
  assert.equal(await env.JOBS.get(subscriberKey, "json"), null);
  assert.equal(sheetRecords[2].status, "unsubscribed");
});

test("CV match records require consent and send CV text only to the configured sheet webhook", async t => {
  const sentRecords = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://script.google.com/macros/s/test/exec");
    sentRecords.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  });
  const env = createEnv([makeJob()]);
  env.SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/test/exec";
  env.SHEETS_WEBHOOK_SECRET = "test-sheet-secret";

  const missingConsent = await worker.fetch(cvMatchRequest({ sheetConsent: false }), env);
  assert.equal(missingConsent.status, 400);
  assert.equal(sentRecords.length, 0);

  const response = await worker.fetch(cvMatchRequest(), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(sentRecords.length, 1);
  assert.equal(sentRecords[0].recordType, "cv_match");
  assert.match(sentRecords[0].cvText, /Registered nurse/);
  assert.equal(sentRecords[0].email, "applicant@example.com");
  assert.equal(sentRecords[0].secret, "test-sheet-secret");
  assert.deepEqual((await env.JOBS.list({ prefix: "cv-matches:" })).keys, []);
});

test("vacancy route renders unique metadata, full details and valid structured data", async () => {
  const job = makeJob({
    requirements: "- A relevant qualification.\n- At least three years of experience.",
    duties: "- Manage the service.\n- Support staff and prepare reports.",
    links: [
      { label: "Online application portal", url: "https://department.gov.za/apply" },
      { label: "Download application form", url: "https://department.gov.za/form.pdf" }
    ]
  });
  const slug = "assistant-director-1-1-example-1";
  const response = await worker.fetch(new Request(`https://jobs.example/${slug}/`), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<title>Assistant Director: Example at Department of Health \| DPSA Government Jobs<\/title>/);
  assert.match(html, /<details class="mobile-navigation" open><summary class="mobile-menu-toggle"[^>]+aria-controls="main-nav-links"[^>]+aria-expanded="true"><span><\/span><span><\/span><span><\/span><\/summary>/);
  assert.match(html, /class="nav-links" id="main-nav-links"/);
  assert.match(html, /navigation\.js\?v=20261118-circular-order1/);
  assert.match(html, /\.nav-links \.nav-dropdown\[open\]\>\.nav-dropdown-menu\{position:static;display:grid/);
  assert.match(html, /\.content-ad iframe\{max-width:100%!important\}/);
  assert.match(html, /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-69H0HQGRT9"><\/script>/);
  assert.match(html, /gtag\('config','G-69H0HQGRT9',\{page_location:"https:\/\/jobs\.example\/assistant-director-1-1-example-1\/"\}\)/);
  assert.match(html, /<link rel="icon" type="image\/x-icon" sizes="16x16 32x32 48x48" href="https:\/\/dpsagovernmentjobs\.co\.za\/favicon\.ico">/);
  assert.match(html, /<link rel="shortcut icon" href="https:\/\/dpsagovernmentjobs\.co\.za\/favicon\.ico">/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="https:\/\/dpsagovernmentjobs\.co\.za\/apple-touch-icon\.png">/);
  assert.match(html, /<nav class="breadcrumb" aria-label="Breadcrumb"><a href="https:\/\/dpsagovernmentjobs\.co\.za\/">Home<\/a> › <a href="https:\/\/dpsagovernmentjobs\.co\.za\/dpsa-vacancy-circulars\/circular-1-of-2099\/">Circular 1 of 2099<\/a> › <a href="https:\/\/dpsagovernmentjobs\.co\.za\/\?employmentType=Contract#listings">Contract<\/a> › <a href="https:\/\/dpsagovernmentjobs\.co\.za\/\?department=Department%20of%20Health#listings">Department of Health<\/a> › Assistant Director: Example<\/nav>/);
  assert.equal(html.split("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3860151941190347").length - 1, 1);
  const adLoaderIndex = html.indexOf('<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js');
  assert.ok(html.indexOf('<link rel="preconnect" href="https://pagead2.googlesyndication.com"') < adLoaderIndex);
  assert.ok(adLoaderIndex < html.indexOf("https://fonts.googleapis.com/css2?family=Jost"));
  assert.match(html, /<script src="https:\/\/dpsagovernmentjobs\.co\.za\/bookmark\.js\?v=20261117-saved-card-layout" defer><\/script>/);
  assert.match(html, /<button class="bookmark-button"[^>]+data-bookmark-url="https:\/\/jobs\.example\/assistant-director-1-1-example-1\/"/);
  assert.match(html, /data-bookmark-company="Department of Health"/);
  assert.match(html, /data-bookmark-employment-type="Contract"/);
  assert.match(html, /data-bookmark-image="https:\/\/dpsagovernmentjobs\.co\.za\/province-limpopo\.png"/);
  assert.ok(html.includes(`<link rel="canonical" href="https://jobs.example/${slug}/">`));
  assert.match(html, /<strong>Reference:<\/strong> EXAMPLE\/1/);
  assert.match(html, /<strong>Post number:<\/strong> 1\/1/);
  assert.match(html, /<strong>Published:<\/strong> <a class="circular-pill" href="https:\/\/dpsagovernmentjobs\.co\.za\/dpsa-vacancy-circulars\/circular-1-of-2099\/">Circular 1 of 2099<\/a>/);
  assert.match(html, /<strong>Date:<\/strong> \d{1,2} [A-Za-z]+ \d{4}/);
  assert.match(html, /<strong>Page on Circular:<\/strong> Page 3/);
  assert.match(html, /Read\/Download the official vacancy advert on <a href="https:\/\/www\.dpsa\.gov\.za\/example\.pdf"[^>]*>Circular 1 of 2099<\/a>/);
  assert.doesNotMatch(html, /Read the official vacancy advert or circular|View official advert|Published in Circular/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/DPSAGovernmentJobs"/);
  assert.match(html, /href="https:\/\/x\.com\/dpsajobs"/);
  assert.match(html, /href="https:\/\/za\.pinterest\.com\/dpsavacancies\/"/);
  assert.match(html, /Office 531, 5th Floor, Barend van Erkom Building, 217 Pretorius Street, Pretoria Central, Pretoria, 0002/);
  assert.match(html, /href="https:\/\/dpsagovernmentjobs\.co\.za\/government-vacancies\/">Vacancies by province/);
  assert.match(html, /href="https:\/\/jobs\.example\/saved-vacancies\/"[^>]*>Saved vacancies/);
  assert.match(html, /href="https:\/\/dpsagovernmentjobs\.co\.za\/how-to-apply\/">How to apply/);
  assert.match(html, /<img src="https:\/\/dpsagovernmentjobs\.co\.za\/footer-facebook\.svg" alt="Facebook">/);
  assert.match(html, /<img src="https:\/\/dpsagovernmentjobs\.co\.za\/footer-x\.svg" alt="X">/);
  assert.match(html, /<img src="https:\/\/dpsagovernmentjobs\.co\.za\/footer-pinterest\.svg" alt="Pinterest">/);
  assert.match(html, /<a href="https:\/\/www\.tiktok\.com\/@dpsa_vacancies_" target="_blank" rel="noopener noreferrer" aria-label="Follow DPSA Government Jobs on TikTok"><img src="https:\/\/dpsagovernmentjobs\.co\.za\/footer-tiktok\.svg" alt="TikTok"><\/a>/);
  assert.match(html, /<h2 id="share-post-title">Share this post<\/h2>/);
  assert.match(html, /<img class="post-share-icon" src="https:\/\/dpsagovernmentjobs\.co\.za\/footer-facebook\.svg" alt="Facebook">Facebook/);
  assert.match(html, /<img class="post-share-icon" src="https:\/\/dpsagovernmentjobs\.co\.za\/footer-x\.svg" alt="X">X/);
  assert.match(html, /<img class="post-share-icon" src="https:\/\/dpsagovernmentjobs\.co\.za\/footer-pinterest\.svg" alt="Pinterest">Pinterest/);
  assert.doesNotMatch(html, /class="post-share-icon"[^>]*>[^<]+<\/span>/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=https%3A%2F%2Fjobs\.example%2Fassistant-director-1-1-example-1%2F"/);
  assert.match(html, /href="https:\/\/twitter\.com\/intent\/tweet\?url=https%3A%2F%2Fjobs\.example%2Fassistant-director-1-1-example-1%2F&amp;text=Assistant\+Director%3A\+Example"/);
  assert.match(html, /href="https:\/\/pinterest\.com\/pin\/create\/button\/\?url=https%3A%2F%2Fjobs\.example%2Fassistant-director-1-1-example-1%2F&amp;media=https%3A%2F%2Fdpsagovernmentjobs\.co\.za%2Fprovince-limpopo\.png&amp;description=Assistant\+Director%3A\+Example"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/dpsagovernmentjobs\.co\.za\/province-limpopo\.png">/);
  assert.match(html, /<li>Online application portal: <a href="https:\/\/department\.gov\.za\/apply"[^>]*target="_blank"[^>]*>https:\/\/department\.gov\.za\/apply<\/a><\/li>/);
  assert.doesNotMatch(html, /<li><a href="https:\/\/department\.gov\.za\/apply"[^>]*>Online application portal<\/a><\/li>/);
  assert.match(html, /font-family:"Jost",Arial,Helvetica,sans-serif/);
  assert.match(html, /\.job-title\{[^}]*font-size:20px/);
  assert.match(html, /\.meta\{[^}]*font-size:16px/);
  assert.match(html, /src="https:\/\/dpsagovernmentjobs\.co\.za\/province-limpopo\.png" alt="Limpopo provincial coat of arms" width="58" height="58"/);
  assert.match(html, /class="site-header"/);
  assert.match(html, /<details class="nav-dropdown"><summary>Circulars<\/summary><div class="nav-dropdown-menu"><a href="https:\/\/dpsagovernmentjobs\.co\.za\/dpsa-vacancy-circulars\/">All circulars<\/a><a href="https:\/\/dpsagovernmentjobs\.co\.za\/dpsa-vacancy-circulars\/circular-1-of-2099\/">Circular 1 of 2099<span>1 job<\/span><\/a>/);
  assert.doesNotMatch(html, /<link rel="stylesheet"/);
  assert.match(html, /Requirements/);
  const adIndex = html.indexOf('<aside class="content-ad" aria-label="Advertisement">');
  const requirementsIndex = html.indexOf("<h2>Requirements</h2>");
  assert.ok(adIndex >= 0 && adIndex < requirementsIndex);
  assert.equal(html.split('data-ad-slot="3081508385"').length - 1, 1);
  assert.match(html, /data-ad-client="ca-pub-3860151941190347" data-ad-slot="3081508385" data-ad-format="auto" data-full-width-responsive="true"><\/ins><script>\(adsbygoogle = window\.adsbygoogle \|\| \[\]\)\.push\(\{\}\);<\/script>/);
  assert.match(html, /<ul><li>A relevant qualification\.<\/li><li>At least three years of experience\.<\/li><\/ul>/);
  assert.match(html, /id="how-to-apply"/);
  assert.match(html, /<ul><li>Manage the service\.<\/li><li>Support staff and prepare reports\.<\/li><\/ul>/);
  assert.match(html, /<h2>Links in the official circular<\/h2><ul><li>Online application portal: <a href="https:\/\/department\.gov\.za\/apply"[^>]*target="_blank"[^>]*>https:\/\/department\.gov\.za\/apply<\/a><\/li><li>Download application form: <a href="https:\/\/department\.gov\.za\/form\.pdf"[^>]*target="_blank"[^>]*>https:\/\/department\.gov\.za\/form\.pdf<\/a><\/li><\/ul>/);
  assert.match(html, /Hiring department:<\/strong> Department of Health/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
  assert.ok(jsonLd);
  const structuredData = JSON.parse(jsonLd[1]);
  assert.equal(structuredData["@type"], "JobPosting");
  const jsonLdValues = [...html.matchAll(/<script(?: id="website-structured-data")? type="application\/ld\+json">([^<]+)<\/script>/g)]
    .map(([, data]) => JSON.parse(data))
  const breadcrumbData = jsonLdValues.find(data => data["@type"] === "BreadcrumbList");
  const articleData = jsonLdValues.find(data => data["@type"] === "Article");
  const websiteData = jsonLdValues.find(data => data["@type"] === "WebSite");
  assert.equal(articleData.headline, "Assistant Director: Example");
  assert.equal(articleData.mainEntityOfPage, `https://jobs.example/${slug}/`);
  assert.equal(websiteData.name, "DPSA Government Jobs");
  assert.deepEqual(breadcrumbData.itemListElement.map(item => item.name), [
    "Home", "Circular 1 of 2099", "Contract", "Department of Health", "Assistant Director: Example"
  ]);
  assert.equal(breadcrumbData.itemListElement[1].item, "https://dpsagovernmentjobs.co.za/dpsa-vacancy-circulars/circular-1-of-2099/");
  assert.equal(breadcrumbData.itemListElement[2].item, "https://dpsagovernmentjobs.co.za/?employmentType=Contract#listings");
  assert.equal(breadcrumbData.itemListElement[3].item, "https://dpsagovernmentjobs.co.za/?department=Department%20of%20Health#listings");
  assert.equal(breadcrumbData.itemListElement[4].item, `https://jobs.example/${slug}/`);
  assert.equal(structuredData.hiringOrganization.name, job.company);
  assert.equal(structuredData.jobLocation.address.addressLocality, "Polokwane");
  assert.equal(structuredData.jobLocation.address.addressRegion, "Limpopo");
  assert.equal(structuredData.validThrough, "2099-12-31T16:00:00+02:00");
  assert.match(structuredData.description, /<ul><li>A relevant qualification/);
});

test("highlights the search term in vacancy fields on detail pages", async () => {
  const job = makeJob({
    title: "HEALTH SERVICE CLERK",
    company: "Department of Health Services",
    centre: "Health District",
    location: "Health District",
    requirements: "Experience in health services.",
    duties: "Provide health services to the public."
  });
  const response = await worker.fetch(new Request(
    "https://jobs.example/health-service-clerk-1-1-example-1/?q=health"
  ), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<h1 class="job-title"><mark class="search-highlight">Health<\/mark> Service Clerk<\/h1>/);
  assert.match(html, /<strong>Hiring department:<\/strong> Department of <mark class="search-highlight">Health<\/mark> Services/);
  assert.match(html, /<strong>Location\/centre in advert:<\/strong> <mark class="search-highlight">Health<\/mark> District/);
  assert.match(html, /Experience in <mark class="search-highlight">health<\/mark> services/);
  assert.match(html, /Provide <mark class="search-highlight">health<\/mark> services to the public/);
  assert.match(html, /\.search-highlight\{[^}]*background:rgba\(236,72,153,\.3\)/);
});

test("removes trailing annexure content from previously published vacancy details", async () => {
  const job = makeJob({
    enquiries: "Contact the listed office.\n6\nANNEXURE B\nDEPARTMENT OF ELECTRICITY AND ENERGY"
  });
  const env = createEnv([job]);
  const pageResponse = await worker.fetch(
    new Request("https://jobs.example/assistant-director-1-1-example-1/"),
    env
  );
  const html = await pageResponse.text();
  assert.match(html, /Contact the listed office\./);
  assert.doesNotMatch(html, /ANNEXURE B|DEPARTMENT OF ELECTRICITY AND ENERGY/);

  const [storedJob] = await env.JOBS.get("published-jobs", "json");
  assert.equal(storedJob.enquiries, "Contact the listed office.");
  const apiResponse = await worker.fetch(new Request("https://jobs.example/api/jobs"), env);
  const [publicJob] = await apiResponse.json();
  assert.equal(publicJob.enquiries, "Contact the listed office.");
});

test("keeps the responsive ad unit when a vacancy has no requirements section", async () => {
  const job = makeJob({ requirements: "" });
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.equal(html.split('data-ad-slot="3081508385"').length - 1, 1);
  assert.match(html, /data-ad-format="auto" data-full-width-responsive="true"/);
  const adIndex = html.indexOf('<aside class="content-ad"');
  assert.ok(adIndex > html.indexOf("<h2>Duties</h2>") && adIndex < html.indexOf('<section id="how-to-apply">'));
});

test("How to apply URLs and email addresses render as active links", async () => {
  const job = makeJob({
    applications: "Apply online at https://department.gov.za/apply. Email applications@example.gov.za."
  });
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.match(html, /<a href="https:\/\/department\.gov\.za\/apply"[^>]*target="_blank"[^>]*>https:\/\/department\.gov\.za\/apply<\/a>/);
  assert.match(html, /<a href="mailto:applications@example\.gov\.za"[^>]*>applications@example\.gov\.za<\/a>/);
  assert.match(html, /<section id="how-to-apply"><h2>How to apply<\/h2><ul><li>Apply online at <a href="https:\/\/department\.gov\.za\/apply"[^>]*target="_blank"[^>]*>https:\/\/department\.gov\.za\/apply<\/a>\.<\/li><li>Email <a href="mailto:applications@example\.gov\.za"[^>]*>applications@example\.gov\.za<\/a>\.<\/li><\/ul><\/section>/);
});

test("internship wording in a vacancy title overrides its recorded appointment type", async () => {
  const job = makeJob({
    title: "INTERNSHIP PROGRAMME: DATA CAPTURING",
    type: "Contract",
    natureOfAppointment: "Permanent"
  });

  test("external links open in a new tab while internal links remain in the current tab", async () => {
    const response = await worker.fetch(new Request("https://jobs.example/assistant-director-1-1-example-1/"), createEnv([makeJob()]));
    const html = await response.text();

    assert.match(html, /href="https:\/\/www\.dpsa\.gov\.za\/example\.pdf"[^>]*target="_blank"/);
    assert.match(html, /href="https:\/\/dpsagovernmentjobs\.co\.za\/how-to-apply\/">How to apply/);
    assert.match(html, /id="website-structured-data" type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"WebSite"/);
  });
  const response = await worker.fetch(new Request(
    "https://jobs.example/internship-programme-1-1-example-1/"
  ), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /<strong>Employment type:<\/strong> <a href="https:\/\/dpsagovernmentjobs\.co\.za\/\?employmentType=Internship#listings">Internship<\/a>/);
  assert.match(html, /<a href="https:\/\/dpsagovernmentjobs\.co\.za\/dpsa-vacancy-circulars\/circular-1-of-2099\/">Circular 1 of 2099<\/a> › <a href="https:\/\/dpsagovernmentjobs\.co\.za\/\?employmentType=Internship#listings">Internship<\/a> › <a href="https:\/\/dpsagovernmentjobs\.co\.za\/\?department=Department%20of%20Health#listings">Department of Health<\/a> › Internship Programme: Data Capturing/);
  assert.match(html, /"employmentType":"INTERN"/);
  assert.doesNotMatch(html, /<strong>Employment type:<\/strong> (?:Contract|Permanent)/);
});

test("trims invitation copy from a job title without changing its existing URL", async () => {
  const job = makeJob({
    title: "RISK MANAGEMENT COMMITTEE (CHAIRPERSON) The Department of Social Development invites applications from suitably qualified and experienced individuals to serve a",
    circularName: "Circular 40 of 2026",
    postNo: "40/177",
    refNo: ""
  });
  const oldSlug = "risk-management-committee-chairperson-the-department-of-social-development-invites-applications-from-suitably-qualified-and-experienced-individuals-to-serve-a-40-177";
  const canonicalSlug = "risk-management-committee-department-social-40-177";
  const response = await worker.fetch(new Request(`https://jobs.example/${canonicalSlug}/`), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.ok(html.includes(`<link rel="canonical" href="https://jobs.example/${canonicalSlug}/">`));
  assert.match(html, /<h1 class="job-title">Risk Management Committee \(Chairperson\)<\/h1>/);
  assert.doesNotMatch(html, /suitably qualified and experienced individuals to serve a/);
  const legacyResponse = await worker.fetch(new Request(`https://jobs.example/${oldSlug}/`), createEnv([job]));
  assert.equal(legacyResponse.status, 301);
  assert.equal(legacyResponse.headers.get("Location"), `https://jobs.example/${canonicalSlug}/`);
});

test("recovers requirements and clean locations from misparsed circular fields", async () => {
  const labelledRequirements = makeJob({
    id: "misparsed-labelled-requirements",
    circularName: "Circular 40 of 2026",
    postNo: "40/217",
    refNo: "",
    centre: "Stellenbosch Hospital, Stellenbosch Sub-district\nREQUIRMENTS : Minimum educational qualification: An appropriate National Diploma (NQF 6) or equivalent.",
    location: "Stellenbosch Hospital, Stellenbosch Sub-district\nREQUIRMENTS : Minimum educational qualification: An appropriate National Diploma (NQF 6) or equivalent.",
    requirements: ""
  });
  const misplacedRequirements = makeJob({
    id: "misparsed-centre-requirements",
    circularName: "Circular 40 of 2026",
    postNo: "40/262",
    refNo: "",
    centre: "An appropriate 3-year qualification (National Diploma/B-Degree or higher qualification); a minimum of 1-year relevant experience. Competencies: knowledge of public finance, policy, management and governance. Skills: planning, communication, flexibility, teamwork and ability to work under pressure.",
    location: "work under pressure.",
    requirements: "",
    province: "Western Cape"
  });
  const env = createEnv([labelledRequirements, misplacedRequirements]);
  const apiResponse = await worker.fetch(new Request("https://jobs.example/api/jobs"), env);
  const jobs = await apiResponse.json();
  const recoveredLocationJob = jobs.find(job => job.id === "misparsed-labelled-requirements");
  const recoveredRequirementsJob = jobs.find(job => job.id === "misparsed-centre-requirements");

  assert.equal(recoveredLocationJob.centre, "Stellenbosch Hospital, Stellenbosch Sub-district");
  assert.match(recoveredLocationJob.requirements, /^Minimum educational qualification:/);
  assert.match(recoveredRequirementsJob.requirements, /^An appropriate 3-year qualification/);
  assert.equal(recoveredRequirementsJob.centre, "");
  assert.equal(recoveredRequirementsJob.location, "");

  const pageResponse = await worker.fetch(new Request(`https://jobs.example/${recoveredLocationJob.slug}/`), env);
  const html = await pageResponse.text();
  assert.match(html, /<h2>Requirements<\/h2>/);
  assert.match(html, /Location\/centre in advert:<\/strong> Stellenbosch Sub-district/);
  assert.doesNotMatch(html, /REQUIRMENTS\s*:/);
});

test("national DPSA vacancies use the South African national coat of arms", async () => {
  const job = makeJob({
    province: "",
    centre: "National Head Office",
    location: "National Head Office"
  });
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.match(html, /src="https:\/\/dpsagovernmentjobs\.co\.za\/south-african-coat-of-arms\.png" alt="South African national coat of arms"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/dpsagovernmentjobs\.co\.za\/south-african-coat-of-arms\.png">/);
});

test("legacy salary descriptions exclude unrelated prose after the salary and level", async () => {
  const job = makeJob({
    salaryText: "R487 197 – R573 897 per annum (Level 09). The successful candidate will be required to sign a performance agreement."
  });
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-1-1-example-1/"), createEnv([job]));
  const html = await response.text();
  const apiResponse = await worker.fetch(new Request("https://jobs.example/api/jobs"), createEnv([job]));
  const [publicJob] = await apiResponse.json();

  assert.match(html, /R487 197 – R573 897 per annum \(Level 09\)/);
  assert.doesNotMatch(html, /Salary:<\/strong>[^<]*performance agreement/);
  assert.equal(publicJob.salaryText, "R487 197 – R573 897 per annum (Level 09)");
});

test("numberless National Treasury salary text links to the readable salary scales page", async () => {
  const job = makeJob({ salaryText: "As per National Treasury scales" });
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.match(html, /<strong>Salary:<\/strong> <a class="salary-scales-link" href="https:\/\/dpsagovernmentjobs\.co\.za\/national-treasury-salary-scales\/">National Treasury Scales<\/a>/);
});

test("renders vacancy-specific FAQs and matching FAQ schema with gross and estimated net pay", async () => {
  const job = makeJob({
    title: "ADMINISTRATION CLERK",
    salary: 300000,
    salaryText: "R300 000 per annum (Level 05)",
    level: "Level 05",
    requirements: "A Grade 12 certificate. At least two years of experience in administrative work.",
    duties: "Provide administrative support and maintain the office records."
  });
  const response = await worker.fetch(new Request("https://jobs.example/administration-clerk-1-1-example-1/"), createEnv([job]));
  const html = await response.text();
  const jsonLdBlocks = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)]
    .map(match => JSON.parse(match[1]));
  const faqSchema = jsonLdBlocks.find(schema => schema["@type"] === "FAQPage");

  assert.ok(faqSchema);
  assert.equal(faqSchema.mainEntity.length, 5);
  assert.match(html, /Questions about this vacancy/);
  assert.match(html, /How much does the South African public service pay for the Administration Clerk post at Department of Health\?/);
  assert.match(html, /R300 000 per year \(R25 000 per month\)/);
  assert.match(html, /R259 428 per year \(R21 619 per month\)/);
  assert.match(html, /SARS 2027 rates for an individual under 65 with the primary rebate/);
  assert.match(html, /It excludes UIF, pension\/GEPF contributions, medical aid credits/);
  assert.match(html, /At least two years of experience in administrative work/);
  assert.match(html, /A Grade 12 certificate/);
  assert.match(html, /What does the Administration Clerk do while at work in Limpopo\?/);
  assert.match(html, /Provide administrative support and maintain the office records/);
  assert.match(html, /href="#requirements">Requirements section in this post<\/a>/);
  assert.match(html, /href="https:\/\/www\.sars\.gov\.za\/tax-rates\/income-tax\/rates-of-tax-for-individuals\/"/);
  assert.ok(faqSchema.mainEntity.some(question => question.name.startsWith("How much is the estimated monthly pay after South African tax")));
  assert.ok(faqSchema.mainEntity.some(question => question.acceptedAnswer.text.includes("R21 619 per month")));
});

test("serves a browser-local saved-vacancies page on the jobs origin", async () => {
  const response = await worker.fetch(new Request("https://jobs.example/saved-vacancies/"), createEnv([]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.match(html, /<title>Saved Vacancies \| DPSA Government Jobs<\/title>/);
  assert.match(html, /<details class="mobile-navigation" open><summary class="mobile-menu-toggle"[^>]+aria-controls="main-nav-links"/);
  assert.match(html, /navigation\.js\?v=20261118-circular-order1/);
  assert.match(html, /styles\.css\?v=20261118-mobile-nav9/);
  assert.match(html, /data-saved-vacancies-list/);
  assert.match(html, /rel="icon" type="image\/x-icon" sizes="16x16 32x32 48x48" href="https:\/\/dpsagovernmentjobs\.co\.za\/favicon\.ico"/);
  assert.match(html, /src="https:\/\/dpsagovernmentjobs\.co\.za\/bookmark\.js\?v=20261117-saved-card-layout" defer/);
  assert.match(html, /This list is separate from bookmarks saved on the main DPSA Government Jobs website/);
});

test("does not invent salary or qualification answers when vacancy data is absent", async () => {
  const job = makeJob({
    title: "ADMINISTRATION CLERK",
    salary: 0,
    salaryText: "Not stated in advert",
    level: "",
    requirements: "",
    duties: ""
  });
  const response = await worker.fetch(new Request("https://jobs.example/administration-clerk-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.match(html, /do not provide a numeric salary or a usable salary level/);
  assert.match(html, /Qualification requirements were not included in this vacancy's published details/);
});

test("uses the supplied salary-level table only as a labeled estimate when advertised pay is missing", async () => {
  const job = makeJob({
    title: "ADMINISTRATION CLERK",
    salary: 0,
    salaryText: "As per National Treasury scales",
    level: "Level 05"
  });
  const response = await worker.fetch(new Request("https://jobs.example/administration-clerk-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.match(html, /The advert does not give a numeric salary but identifies Level 5/);
  assert.match(html, /proposed monthly notch of R13 237, or R158 844 per year \(R13 237 per month\)/);
  assert.match(html, /not a confirmed salary for this specific vacancy/);
});

test("links the job level to its salary guide section and shows three similar current vacancies", async () => {
  const job = makeJob({ level: "Level 09" });
  const relatedJobs = [
    makeJob({
      id: "same-title-same-province",
      title: "ASSISTANT DIRECTOR: EXAMPLE OPERATIONS",
      postNo: "1/2",
      province: "Limpopo",
      circularName: "Circular 2 of 2099"
    }),
    makeJob({
      id: "same-title-other-province",
      title: "ASSISTANT DIRECTOR: EXAMPLE SERVICES",
      postNo: "1/3",
      province: "Gauteng",
      circularName: "Circular 3 of 2099"
    }),
    makeJob({
      id: "same-department",
      title: "PROGRAMME COORDINATOR",
      postNo: "1/4",
      province: "Limpopo",
      circularName: "Circular 4 of 2099"
    }),
    makeJob({
      id: "expired-related",
      title: "ASSISTANT DIRECTOR: EXAMPLE CLOSED",
      postNo: "1/5",
      closingDate: "1 January 2000"
    })
  ];
  const response = await worker.fetch(
    new Request("https://jobs.example/assistant-director-1-1-example-1/"),
    createEnv([job, ...relatedJobs])
  );
  const html = await response.text();

  assert.match(html, /<strong>Job level:<\/strong> <a class="salary-scales-link" href="https:\/\/dpsagovernmentjobs\.co\.za\/national-treasury-salary-scales\/#level-9">Level 9<\/a>/);
  assert.match(html, /<h2 id="related-jobs-heading">Similar current vacancies<\/h2>/);
  assert.equal((html.match(/class="related-job-card"/g) ?? []).length, 3);
  assert.equal((html.match(/class="bookmark-button"/g) ?? []).length, 4);
  assert.equal((html.match(/class="related-job-link"/g) ?? []).length, 3);
  assert.match(html, /Assistant Director: Example Operations/);
  assert.match(html, /Province: Limpopo/);
  assert.doesNotMatch(html, /EXAMPLE CLOSED/);
});

test("vacancy URLs use a short title slug and preserve the full post and reference numbers", async () => {
  const job = makeJob({
    title: "ASSISTANT DIRECTOR: SECURITY MANAGEMENT",
    postNo: "41/100",
    refNo: "2026/165/OCJ"
  });
  const env = createEnv([job]);
  const canonicalPath = "/assistant-director-41-100-2026-165-ocj/";
  assert.equal(jobPagePath(job), canonicalPath);
  const canonicalResponse = await worker.fetch(new Request(`https://jobs.example${canonicalPath}`), env);
  const html = await canonicalResponse.text();

  assert.equal(canonicalResponse.status, 200);
  assert.ok(html.includes(`<link rel="canonical" href="https://jobs.example${canonicalPath}">`));

  const legacyResponse = await worker.fetch(new Request(`https://jobs.example/jobs/${job.id}/`), env);
  assert.equal(legacyResponse.status, 301);
  assert.equal(legacyResponse.headers.get("Location"), `https://jobs.example${canonicalPath}`);
  const oldSlug = "/assistant-director-security-management-41-100-2026-165-ocj/";
  const oldSlugResponse = await worker.fetch(new Request(`https://jobs.example${oldSlug}`), env);
  assert.equal(oldSlugResponse.status, 301);
  assert.equal(oldSlugResponse.headers.get("Location"), `https://jobs.example${canonicalPath}`);
});

test("vacancy title slugs omit colon suffixes, bracketed text, stop words and years", async () => {
  const job = makeJob({
    title: "SENIOR MANAGER (Finance and Operations) for the 2026 Service Delivery: Corporate Support",
    postNo: "41/007",
    refNo: "DPSA 2026/11/113/08"
  });
  const response = await worker.fetch(
    new Request("https://jobs.example/senior-manager-service-delivery-41-007-dpsa-2026-11-113-08/"),
    createEnv([job])
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.ok(html.includes("https://jobs.example/senior-manager-service-delivery-41-007-dpsa-2026-11-113-08/"));
});

test("vacancy title slug keeps no more than five meaningful words", async () => {
  const job = makeJob({
    title: "ASSISTANT DIRECTOR OF PUBLIC SERVICE ADMINISTRATION OPERATIONS",
    postNo: "41/009",
    refNo: "REF 2026/12345678901234567890"
  });
  const response = await worker.fetch(
    new Request("https://jobs.example/assistant-director-public-service-administration-41-009-ref-2026-12345678901234567890/"),
    createEnv([job])
  );

  assert.equal(response.status, 200);
});

test("verified Security Management listing excludes the trailing circular page number from its centre", async () => {
  const job = makeJob({
    title: "ASSISTANT DIRECTOR: SECURITY MANAGEMENT",
    postNo: "41/100",
    refNo: "2026/165/OCJ",
    circularName: "Circular 41 of 2026",
    centre: "Mpumalanga Provincial Service Centre\n58",
    location: "Mpumalanga Provincial Service Centre\n58",
    province: "Mpumalanga"
  });
  const env = createEnv([job]);
  const apiResponse = await worker.fetch(new Request("https://jobs.example/api/jobs"), env);
  const [publicJob] = await apiResponse.json();
  const pageResponse = await worker.fetch(
    new Request("https://jobs.example/assistant-director-41-100-2026-165-ocj/"),
    env
  );
  const html = await pageResponse.text();

  assert.equal(publicJob.centre, "Mpumalanga Provincial Service Centre");
  assert.equal(publicJob.location, "Mpumalanga Provincial Service Centre");
  assert.match(html, /Location\/centre in advert:<\/strong> Mpumalanga/);
  assert.doesNotMatch(html, /Mpumalanga Provincial Service Centre\s*58/);
});

test("generic employer data is not presented as the hiring department or marked up as a JobPosting", async () => {
  const job = makeJob({ company: "South African Public Service", centre: "Labour", location: "Labour" });
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Hiring department:<\/strong> Check the official advert/);
  assert.doesNotMatch(html, /The South African Public Service/);
  assert.doesNotMatch(html, /"@type":"JobPosting"/);
  assert.match(html, /"@type":"FAQPage"/);
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
  const pageResponse = await worker.fetch(new Request("https://jobs.example/client-service-officer-41-20-hr4-4-11-26/"), env);
  const html = await pageResponse.text();
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);

  assert.equal(pageResponse.status, 200);
  assert.match(html, /The Department of Employment and Labour invites applications/);
  assert.match(html, /<strong>Published:<\/strong> <a class="circular-pill" href="https:\/\/dpsagovernmentjobs\.co\.za\/dpsa-vacancy-circulars\/circular-41-of-2026\/">Circular 41 of 2026<\/a>/);
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
  const response = await worker.fetch(new Request("https://jobs.example/assistant-director-1-1-example-1/"), createEnv([job]));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;alert/);
});

test("sitemap and storage exclude expired jobs and removed or unknown job IDs redirect home", async () => {
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
  assert.match(sitemap, /\/assistant-director-1-1-example-1\//);
  assert.doesNotMatch(sitemap, /closed-post/);
  assert.deepEqual((await env.JOBS.get()).map(job => job.id), [active.id]);

  const closedResponse = await worker.fetch(new Request("https://jobs.example/closed-post-1-1-example-1/"), env);
  assert.equal(closedResponse.status, 302);
  assert.equal(closedResponse.headers.get("Location"), "https://dpsagovernmentjobs.co.za/");
  const missingResponse = await worker.fetch(new Request("https://jobs.example/missing-title-and-reference/"), env);
  assert.equal(missingResponse.status, 302);
  assert.equal(missingResponse.headers.get("Location"), "https://dpsagovernmentjobs.co.za/");

  const indexResponse = await worker.fetch(new Request("https://jobs.example/jobs/"), env);
  assert.equal(indexResponse.status, 301);
  assert.equal(indexResponse.headers.get("Location"), "https://dpsagovernmentjobs.co.za/#listings");
});

test("redirects missing pages, admin paths and feed URLs to the homepage", async () => {
  const paths = [
    "/missing/nested/page",
    "/admin/",
    "/wp-admin/index.php",
    "/wp-login.php",
    "/extension/admin.html",
    "/feed/",
    "/comments/feed/",
    "/feed/rss.xml",
    "/index.xml",
    "/rss.xml",
    "/atom.xml",
    "/old-post.rdf",
    "/?feed=rss2",
    "/index.php?format=feed&type=rss",
    "/jobs/missing-id?type=atom"
  ];

  for (const path of paths) {
    const response = await worker.fetch(new Request(`https://jobs.example${path}`), createEnv([]));
    assert.equal(response.status, 302, `${path} should redirect`);
    assert.equal(response.headers.get("Location"), "https://dpsagovernmentjobs.co.za/", `${path} should redirect home`);
  }

  const legacyCircular = await worker.fetch(new Request(
    "https://jobs.example/civic-services-clerk-dpsa-circular-18-of-2026-dpsa-vacancies/"
  ), createEnv([]));
  assert.equal(legacyCircular.status, 302);
  assert.equal(
    legacyCircular.headers.get("Location"),
    "https://dpsagovernmentjobs.co.za/dpsa-vacancy-circulars/#circular-18-of-2026"
  );
});

test("keeps sitemap and API error responses out of page redirects", async () => {
  const env = createEnv([]);
  const sitemap = await worker.fetch(new Request("https://jobs.example/sitemap.xml"), env);
  const missingApiRoute = await worker.fetch(new Request("https://jobs.example/api/missing"), env);

  assert.equal(sitemap.status, 200);
  assert.equal(missingApiRoute.status, 404);
  assert.equal(missingApiRoute.headers.get("Content-Type"), "application/json; charset=utf-8");
});

test("expired jobs are deleted from storage and hidden from public and admin APIs", async () => {
  const active = makeJob();
  const expired = makeJob({ id: "closed-post", closingDate: "1 January 2020" });
  const env = createEnv([active, expired]);

  const publicResponse = await worker.fetch(new Request("https://jobs.example/api/jobs"), env);
  assert.deepEqual((await publicResponse.json()).map(job => job.id), [active.id]);

  assert.deepEqual((await env.JOBS.get()).map(job => job.id), [active.id]);
  const adminResponse = await worker.fetch(new Request("https://jobs.example/api/jobs", {
    headers: { Authorization: "Bearer test-token" }
  }), env);
  assert.deepEqual((await adminResponse.json()).map(job => job.id), [active.id]);
});

test("scheduled cleanup deletes expired posts without waiting for a visitor", async () => {
  const active = makeJob();
  const expired = makeJob({ id: "expired-scheduled", closingDate: "1 January 2020" });
  const env = createEnv([active, expired]);

  await worker.scheduled({ scheduledTime: Date.now() }, env);

  assert.deepEqual((await env.JOBS.get()).map(job => job.id), [active.id]);
});

test("publishing a fifth circular permanently removes the oldest circular and its jobs", async () => {
  const jobs = Array.from({ length: 5 }, (_, index) => makeJob({
    id: `circular-${index + 1}`,
    title: `Circular ${index + 1} vacancy`,
    circularName: `Circular ${index + 1} of 2026`
  }));
  const env = createEnv([]);
  const response = await worker.fetch(new Request("https://jobs.example/api/jobs", {
    method: "PUT",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(jobs)
  }), env);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.count, 4);
  assert.deepEqual(result.removedCircularNames, ["Circular 1 of 2026"]);
  assert.deepEqual(result.removedJobIds, ["circular-1"]);
  assert.deepEqual((await env.JOBS.get()).map(job => job.circularName), jobs.slice(1).map(job => job.circularName));

  const pageResponse = await worker.fetch(new Request("https://jobs.example/circular-5-vacancy-1-1-example-1/"), env);
  assert.equal(pageResponse.status, 200);
  const html = await pageResponse.text();
  const menu = html.match(/<div class="nav-dropdown-menu">([\s\S]*?)<\/div>/)?.[1] ?? "";
  const menuCirculars = [...menu.matchAll(/>(Circular \d+ of 2026)<span/g)].map(match => match[1]);
  assert.deepEqual(menuCirculars, [
    "Circular 5 of 2026",
    "Circular 4 of 2026",
    "Circular 3 of 2026",
    "Circular 2 of 2026"
  ]);
});

test("accepts a published list containing up to 6000 jobs", async () => {
  const jobs = Array.from({ length: 6000 }, (_, index) => makeJob({
    id: `job-${index + 1}`,
    title: `Job ${index + 1}`,
    circularName: "Circular 1 of 2099"
  }));
  const response = await worker.fetch(new Request("https://jobs.example/api/jobs", {
    method: "PUT",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(jobs)
  }), createEnv([]));
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.count, 6000);
});

test("explains which job field caused publication validation to fail", async () => {
  const response = await worker.fetch(new Request("https://jobs.example/api/jobs", {
    method: "PUT",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify([makeJob({ category: "Invalid category" })])
  }), createEnv([]));
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.error, "Job 1 has an unsupported category.");
});

test("repairs legacy invalid salaries during publication using the advertised amount", async () => {
  const jobs = Array.from({ length: 593 }, (_, index) => makeJob({
    id: `job-${index + 1}`,
    title: `Job ${index + 1}`,
    salary: 300000
  }));
  jobs[592] = makeJob({
    id: "job-593",
    title: "Job 593",
    salary: 150_000_000,
    salaryText: "R338 106 per annum (Level 07)"
  });
  const env = createEnv([]);
  const response = await worker.fetch(new Request("https://jobs.example/api/jobs", {
    method: "PUT",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(jobs)
  }), env);
  const result = await response.json();
  const storedJobs = await env.JOBS.get("published-jobs", "json");

  assert.equal(response.status, 200);
  assert.equal(result.count, 593);
  assert.equal(storedJobs[592].salary, 338106);
  assert.equal(storedJobs[592].salaryText, jobs[592].salaryText);
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

test("automation failure notifications require admin authorization and send through Resend", async () => {
  const env = {
    ...createEnv([]),
    RESEND_API_KEY: "test-resend-key",
    ALERTS_FROM_EMAIL: "alerts@example.com"
  };
  const unauthorized = await worker.fetch(new Request("https://jobs.example/api/automation/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: "admin@example.com",
      runUrl: "https://github.com/masasecomm/Dgjo/actions/runs/123",
      message: "Workflow failed."
    })
  }), env);
  assert.equal(unauthorized.status, 401);

  const originalFetch = globalThis.fetch;
  let sentMessage;
  globalThis.fetch = async (url, options) => {
    sentMessage = { url: String(url), options };
    return new Response("{}", { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://jobs.example/api/automation/notify", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: "admin@example.com",
        runUrl: "https://github.com/masasecomm/Dgjo/actions/runs/123",
        message: "Workflow failed."
      })
    }), env);
    assert.equal(response.status, 202);
    assert.equal((await response.json()).success, true);
    assert.equal(sentMessage.url, "https://api.resend.com/emails");
    const body = JSON.parse(sentMessage.options.body);
    assert.deepEqual(body.to, ["admin@example.com"]);
    assert.match(body.text, /Workflow run: https:\/\/github\.com\/masasecomm\/Dgjo\/actions\/runs\/123/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("automation success notifications use the publication-success subject", async () => {
  const env = {
    ...createEnv([]),
    RESEND_API_KEY: "test-resend-key",
    ALERTS_FROM_EMAIL: "alerts@example.com"
  };
  const originalFetch = globalThis.fetch;
  let sentMessage;
  globalThis.fetch = async (url, options) => {
    sentMessage = { url: String(url), options };
    return new Response("{}", { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request("https://jobs.example/api/automation/notify", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "success",
        to: ["admin@example.com", "dpsajobs@gmail.com"],
        runUrl: "https://github.com/masasecomm/Dgjo/actions/runs/124",
        message: "Circular 42 of 2026 was published at 20:00 SAST (123 vacancies)."
      })
    }), env);

    assert.equal(response.status, 202);
    const body = JSON.parse(sentMessage.options.body);
    assert.deepEqual(body.to, ["admin@example.com", "dpsajobs@gmail.com"]);
    assert.equal(body.subject, "DPSA circular auto-published successfully");
    assert.match(body.text, /Circular 42 of 2026 was published at 20:00 SAST \(123 vacancies\)/);
    assert.match(body.text, /Workflow run: https:\/\/github\.com\/masasecomm\/Dgjo\/actions\/runs\/124/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("automation notifications reject an invalid recipient in a recipient list", async () => {
  const response = await worker.fetch(new Request("https://jobs.example/api/automation/notify", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to: ["admin@example.com", "not-an-email"],
      message: "Workflow failed."
    })
  }), createEnv([]));

  assert.equal(response.status, 400);
});

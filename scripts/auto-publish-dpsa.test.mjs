import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractCircularPages,
  countPublishedEmploymentTypes,
  readAutomationEnabled,
  recordAutoPublishedCirculars,
  selectNewerCirculars
} from "./auto-publish-dpsa.mjs";

test("circular archive discovery accepts DPSA pages and orders newest first", () => {
  const html = `
    <a href="/newsroom/psvc/circular-4-of-2026/">Circular 4</a>
    <a href="https://www.dpsa.gov.za/newsroom/psvc/circular-12-of-2026/">Circular 12</a>
    <a href="https://example.com/newsroom/psvc/circular-99-of-2026/">Untrusted</a>
    <a href="/newsroom/psvc/circular-3-of-2025/">Circular 3 of 2025</a>
    <a href="/newsroom/psvc/not-a-circular/">Other page</a>`;

  assert.deepEqual(
    extractCircularPages(html).map(({ circularName }) => circularName),
    ["Circular 12 of 2026", "Circular 4 of 2026", "Circular 3 of 2025"]
  );
});

test("circular archive discovery limits the scan to the five latest pages", () => {
  const html = Array.from({ length: 8 }, (_, index) =>
    `<a href="/newsroom/psvc/circular-${index + 1}-of-2026/">Circular ${index + 1}</a>`
  ).join("");

  assert.deepEqual(
    extractCircularPages(html).map(({ circularName }) => circularName),
    [
      "Circular 8 of 2026",
      "Circular 7 of 2026",
      "Circular 6 of 2026",
      "Circular 5 of 2026",
      "Circular 4 of 2026"
    ]
  );
});

test("counts published posts in the four email employment categories", () => {
  assert.deepEqual(countPublishedEmploymentTypes([
    { type: "Permanent" },
    { type: "Contract" },
    { type: "Temporary" },
    { type: "Fixed-term" },
    { type: "Sessional" },
    { type: "Internship" },
    { type: "Seasonal" },
    { type: "Unspecified" }
  ]), {
    Permanent: 1,
    Contract: 4,
    Sessional: 1,
    Internship: 1
  });
});

test("publishing selection ignores missing historical circulars below the latest published issue", () => {
  const candidates = [42, 41, 40, 39, 38].map(number => ({
    circularName: `Circular ${number} of 2026`
  }));
  const publishedJobs = [
    { circularName: "Circular 41 of 2026" },
    { circularName: "Circular 40 of 2026" },
    { circularName: "Circular 39 of 2026" }
  ];

  assert.deepEqual(
    selectNewerCirculars(candidates, publishedJobs).map(circular => circular.circularName),
    ["Circular 42 of 2026"]
  );
});

test("an empty Worker receives only the newest available circular during bootstrap", () => {
  const candidates = [42, 41, 40].map(number => ({
    circularName: `Circular ${number} of 2026`
  }));

  assert.deepEqual(
    selectNewerCirculars(candidates, []).map(circular => circular.circularName),
    ["Circular 42 of 2026"]
  );
});

test("automation reads the extension's enabled setting from the Worker", async () => {
  const enabled = await readAutomationEnabled(
    "https://jobs.example/api/jobs",
    "secret",
    async (url, options) => {
      assert.equal(new URL(url).pathname, "/api/automation/settings");
      assert.equal(options.headers.Authorization, "Bearer secret");
      return Response.json({ enabled: true });
    }
  );

  assert.equal(enabled, true);
});

test("automation respects an off setting returned by the extension control", async () => {
  const enabled = await readAutomationEnabled(
    "https://jobs.example/api/jobs",
    "secret",
    async () => Response.json({ enabled: false })
  );

  assert.equal(enabled, false);
});

test("automation records a successful circular and timestamp in Worker history", async () => {
  const publications = [{
    circularName: "Circular 42 of 2026",
    publishedAt: "2026-11-18T18:00:00.000Z",
    jobCount: 123
  }];
  const result = await recordAutoPublishedCirculars(
    "https://jobs.example/api/jobs",
    "secret",
    publications,
    async (url, options) => {
      assert.equal(new URL(url).pathname, "/api/automation/publications");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { publications });
      return Response.json({ success: true, publications });
    }
  );

  assert.deepEqual(result, publications);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { extractCircularPages } from "./auto-publish-dpsa.mjs";

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

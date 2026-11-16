import assert from "node:assert/strict";
import test from "node:test";
import { renderJobListings } from "./build-site.mjs";

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
    closingDate: "2099-12-31"
  }]);

  assert.match(html, /<h3><a href="https:\/\/jobs\.dpsagovernmentjobs\.co\.za\/provisioning-officer-41-30-ref\/">Provisioning Administration Officer<\/a><\/h3>/);
  assert.match(html, /Western Cape Community Education and Training College/);
  assert.match(html, /R338 106 per annum/);
  assert.match(html, /Expires in \d+ days/);
  assert.match(html, /href="https:\/\/jobs\.dpsagovernmentjobs\.co\.za\/provisioning-officer-41-30-ref\/#how-to-apply"/);
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
  assert.match(renderJobListings([]), /There are no current job listings/);
});

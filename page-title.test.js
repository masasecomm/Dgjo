import assert from "node:assert/strict";
import { test } from "node:test";
import { homePageTitle } from "./page-title.js";

test("uses a descriptive default homepage title", () => {
  assert.equal(
    homePageTitle({ year: 2026 }),
    "Government Vacancies | DPSA Vacancies in South Africa 2026"
  );
});

test("reflects search and selected vacancy filters in the title", () => {
  assert.equal(
    homePageTitle({
      query: "nursing",
      province: "Limpopo",
      department: "Department of Health",
      employmentType: "Permanent"
    }),
    'Jobs matching "nursing" | Government Jobs in Limpopo | Department of Health Vacancies | Permanent Jobs | DPSA Government Jobs'
  );
});

test("keeps personal contact information out of search page titles", () => {
  assert.equal(homePageTitle({ query: "person@example.com" }), "Job Search Results | DPSA Government Jobs");
  assert.equal(homePageTitle({ query: "+27 82 123 4567" }), "Job Search Results | DPSA Government Jobs");
});

test("uses a generic title for CV match results", () => {
  assert.equal(homePageTitle({ query: "nursing", cvMatches: true }), "CV Job Matches | DPSA Government Jobs");
});

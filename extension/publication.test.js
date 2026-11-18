import assert from "node:assert/strict";
import { test } from "node:test";
import {
  circularPublicationStatus,
  comparePostNumbers,
  displayVacancyTitle,
  getCircularVacancies,
  mergeVacancyLinks,
  normalizePublishedSalary,
  sanitizePublishedJob
} from "./publication.js";

test("formats uppercase vacancy titles as readable text without changing mixed-case titles", () => {
  assert.equal(displayVacancyTitle("ASSISTANT DIRECTOR: SECURITY MANAGEMENT"), "Assistant Director: Security Management");
  assert.equal(displayVacancyTitle("SAPS HR OFFICER"), "SAPS HR Officer");
  assert.equal(displayVacancyTitle("eThekwini Manager"), "eThekwini Manager");
});

test("sorts post numbers in numeric order", () => {
  const postNumbers = ["41/10", "41/02", "41/01", "42/01"];
  assert.deepEqual(postNumbers.sort(comparePostNumbers), ["41/01", "41/02", "41/10", "42/01"]);
  assert.ok(comparePostNumbers("41/02", "41/10") < 0);
  assert.ok(comparePostNumbers("", "41/01") > 0);
});

test("tracks published posts per circular and identifies posts that can be republished", () => {
  const imported = [
    { circularName: "Circular 41 of 2026", postNo: "41/1", refNo: "REF/1", sourceUrl: "https://dpsa.gov.za/41.pdf" },
    { circularName: "Circular 41 of 2026", postNo: "41/2", refNo: "REF/2", sourceUrl: "https://dpsa.gov.za/41.pdf" },
    { circularName: "Circular 41 of 2026", postNo: "41/3", refNo: "REF/3", sourceUrl: "https://dpsa.gov.za/41.pdf" }
  ];
  const published = [
    { ...imported[0] },
    { ...imported[1], title: "Updated post title" },
    { circularName: "Circular 40 of 2026", postNo: "40/1", refNo: "REF/1", sourceUrl: "https://dpsa.gov.za/40.pdf" }
  ];

  assert.deepEqual(circularPublicationStatus(" circular 41 of 2026 ", imported, published), {
    importedCount: 3,
    publishedCount: 2,
    alreadyPublishedCount: 2
  });
  assert.equal(getCircularVacancies(imported, "Circular 40 of 2026").length, 0);
});

test("keeps all existing and imported post links when merging a republished vacancy", () => {
  const existingLinks = [
    { label: "Apply", url: "https://department.gov.za/apply" },
    { label: "Circular", url: "https://dpsa.gov.za/circular.pdf" }
  ];
  const importedLinks = [
    { label: "Apply online", url: "https://department.gov.za/apply" },
    { label: "Application form", url: "https://department.gov.za/form.pdf" }
  ];

  assert.deepEqual(mergeVacancyLinks(existingLinks, importedLinks), [
    { label: "Apply online", url: "https://department.gov.za/apply" },
    { label: "Circular", url: "https://dpsa.gov.za/circular.pdf" },
    { label: "Application form", url: "https://department.gov.za/form.pdf" }
  ]);
});

test("removes unsupported legacy metadata before sending jobs to the Worker", () => {
  const job = sanitizePublishedJob({
    id: "vacancy-1",
    title: "Vacancy",
    circularName: "Circular 1 of 2026",
    links: [{ label: "Apply", url: "https://department.gov.za/apply" }],
    slug: "old-generated-slug",
    createdAt: "2025-01-01"
  });

  assert.deepEqual(job, {
    id: "vacancy-1",
    title: "Vacancy",
    circularName: "Circular 1 of 2026",
    links: [{ label: "Apply", url: "https://department.gov.za/apply" }],
    salary: 0
  });
});

test("repairs invalid stored salaries from advert text and safely defaults when unavailable", () => {
  assert.equal(normalizePublishedSalary(150_000_000, "R338 106 per annum (Level 07)"), 338106);
  assert.equal(normalizePublishedSalary(null, "R12 500 per month"), 12500);
  assert.equal(normalizePublishedSalary(-1, "Salary not stated"), 0);
  assert.equal(normalizePublishedSalary(100_000, "R338 106 per annum"), 100_000);
  assert.equal(sanitizePublishedJob({
    id: "vacancy-1",
    salary: null,
    salaryText: "R338 106 per annum"
  }).salary, 338106);
});

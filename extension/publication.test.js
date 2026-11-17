import assert from "node:assert/strict";
import { test } from "node:test";
import {
  circularPublicationStatus,
  getCircularVacancies,
  mergeVacancyLinks
} from "./publication.js";

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

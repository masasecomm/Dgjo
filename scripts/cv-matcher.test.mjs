import assert from "node:assert/strict";
import test from "node:test";
import { cvTerms, rankJobsForCv } from "./cv-matcher.js";

const jobs = [
  {
    id: "nurse-role",
    title: "Professional Nurse",
    company: "Department of Health",
    province: "Limpopo",
    requirements: "Registered nurse with clinical experience and patient care skills.",
    duties: "Provide nursing services and manage patient records."
  },
  {
    id: "finance-role",
    title: "Financial Accountant",
    company: "National Treasury",
    province: "National",
    requirements: "Accounting qualification and financial reporting experience."
  },
  {
    id: "unrelated-role",
    title: "Roads Maintenance Worker",
    company: "Department of Transport",
    province: "Gauteng",
    requirements: "Maintain roads and operate heavy equipment."
  }
];

test("ranks relevant roles using job-related CV terms, not demographic words", () => {
  const matches = rankJobsForCv(
    "Registered nurse with nursing experience, clinical practice, patient care and health records. Female, age 30.",
    jobs
  );

  assert.equal(matches[0].job.id, "nurse-role");
  assert.ok(matches[0].overlap > 0);
  assert.ok(matches[0].matchedTerms.includes("nurs"));
  assert.ok(!matches[0].matchedTerms.includes("female"));
  assert.ok(!matches[0].matchedTerms.includes("age"));
});

test("applies province and department preferences and returns no unsupported zero-term matches", () => {
  assert.deepEqual(
    rankJobsForCv("accounting financial reporting experience and qualifications", jobs, {
      province: "National",
      department: "National Treasury"
    }).map(match => match.job.id),
    ["finance-role"]
  );
  assert.deepEqual(rankJobsForCv("a CV with no relevant job-specific terms", jobs), []);
});

test("returns every qualifying vacancy instead of silently limiting the matches", () => {
  const vacancies = Array.from({ length: 25 }, (_, index) => ({
    id: `nurse-${index}`,
    title: `Professional Nurse ${index}`,
    requirements: "Registered nurse with clinical experience and patient care skills."
  }));
  const matches = rankJobsForCv("Registered nurse with clinical experience and patient care skills.", vacancies);

  assert.equal(matches.length, 25);
});

test("normalizes common word forms without including generic advert language", () => {
  const terms = cvTerms("Administrative management and requirements must include accounting skills.");

  assert.ok(terms.has("admin"));
  assert.ok(terms.has("manage"));
  assert.ok(terms.has("account"));
  assert.ok(!terms.has("requirements"));
  assert.ok(!terms.has("include"));
});

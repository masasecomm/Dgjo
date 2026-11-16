import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDpsaCircular } from "./importer.js";

test("jobs inherit the nearest circular department heading", () => {
  const { vacancies } = parseDpsaCircular(`DPSA CIRCULAR 41 OF 2026
__PAGE_1__
DEPARTMENT OF HEALTH
POST 1: ASSISTANT DIRECTOR
REQUIREMENTS: A relevant qualification and experience.
POST 2: ADMINISTRATIVE CLERK
REQUIREMENTS: Grade 12 and good communication skills.
DEPARTMENT OF EDUCATION
POST 3: SENIOR EDUCATION SPECIALIST
REQUIREMENTS: A relevant teaching qualification and experience.`, { fileName: "Circular 41 of 2026.pdf" });

  assert.deepEqual(vacancies.map(vacancy => vacancy.company), [
    "Department of Health",
    "Department of Health",
    "Department of Education"
  ]);
});

test("department phrases inside vacancy text do not become employer fields", () => {
  const { vacancies } = parseDpsaCircular(`POST 1: SUPPLY CHAIN OFFICER
REQUIREMENTS: Knowledge of Department of Higher Education mandate and BAS/LOGIS systems.
DUTIES: Provide procurement support and compile reports.`, { fileName: "Circular 41 of 2026.pdf" });

  assert.equal(vacancies[0].company, "Hiring department not identified");
});

test("explicit department labels continue to take precedence over circular context", () => {
  const { vacancies } = parseDpsaCircular(`DEPARTMENT OF HEALTH
POST 1: PROCUREMENT OFFICER
DEPARTMENT: South African Police Service
REQUIREMENTS: Grade 12 and procurement experience.`, { fileName: "Circular 41 of 2026.pdf" });

  assert.equal(vacancies[0].company, "South African Police Service");
});

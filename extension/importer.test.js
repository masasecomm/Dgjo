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

test("recognizes seasonal appointments as their own employment type", () => {
  const { vacancies } = parseDpsaCircular(`DEPARTMENT OF AGRICULTURE
POST 1: SEASONAL FARM WORKER
NATURE OF APPOINTMENT: Seasonal
REQUIREMENTS: Grade 10 and physical fitness.`, { fileName: "Circular 41 of 2026.pdf" });

  assert.equal(vacancies[0].type, "Seasonal");
});

test("keeps sessional appointments separate from contract vacancies", () => {
  const { vacancies } = parseDpsaCircular(`DEPARTMENT OF AGRICULTURE
POST 1: SESSIONAL FARM WORKER
NATURE OF APPOINTMENT: Sessional
REQUIREMENTS: Grade 10 and physical fitness.`, { fileName: "Circular 41 of 2026.pdf" });

  assert.equal(vacancies[0].type, "Sessional");
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

test("centre values containing the word centre are not truncated at that word", () => {
  const { vacancies } = parseDpsaCircular(`DEPARTMENT OF EMPLOYMENT AND LABOUR
POST 41/20: CLIENT SERVICE OFFICER: EMPLOYER SERVICES
CENTRE: Labour Centre: KuGompo City
REQUIREMENTS: Grade 12 and no experience required.
DUTIES: Provide screening services and process applications for UIF benefits.`, {
    fileName: "Circular 41 of 2026.pdf"
  });

  assert.equal(vacancies[0].centre, "Labour Centre: KuGompo City");
});

test("misspelled requirements headings no longer get absorbed into the centre", () => {
  const { vacancies } = parseDpsaCircular(`DEPARTMENT OF HEALTH
POST 40/217: ASSISTANT DIRECTOR
CENTRE: Stellenbosch Hospital, Stellenbosch Sub-district
REQUIRMENTS : Minimum educational qualification: An appropriate National Diploma (NQF 6) or equivalent.
DUTIES: Manage human resource and facility services.`, {
    fileName: "Circular 40 of 2026.pdf"
  });

  assert.equal(vacancies[0].centre, "Stellenbosch Hospital, Stellenbosch Sub-district");
  assert.match(vacancies[0].requirements, /^- Minimum educational qualification:/);
  assert.doesNotMatch(vacancies[0].requirements, /REQUIRMENTS/);
});

test("salary extraction excludes following candidate conditions", () => {
  const { vacancies } = parseDpsaCircular(`POST 1: ASSISTANT DIRECTOR
SALARY: R487 197 – R573 897 per annum (Level 09). The successful candidate will be required to sign a performance agreement.
REQUIREMENTS: A relevant qualification.`, { fileName: "Circular 41 of 2026.pdf" });

  assert.equal(vacancies[0].salaryText, "R487 197 – R573 897 per annum (Level 09)");
  assert.equal(vacancies[0].salary, 573897);
});

test("stops a vacancy at the next annexure heading", () => {
  const { vacancies } = parseDpsaCircular(`DPSA CIRCULAR 40 OF 2026
DEPARTMENT OF DEFENCE
POST 40/01: ADMINISTRATION CLERK: PRODUCTION
REQUIREMENTS: Grade 12 and no experience.
ENQUIRIES: Contact the listed office.
6
ANNEXURE B
DEPARTMENT OF ELECTRICITY AND ENERGY
POST 40/02: ANALYST: ECONOMIC MODELLING AND RESEARCH
REQUIREMENTS: A relevant degree and experience.`, { fileName: "Circular 40 of 2026.pdf" });

  assert.equal(vacancies.length, 2);
  assert.equal(vacancies[0].company, "Department of Defence");
  assert.match(vacancies[0].enquiries, /Contact the listed office/);
  assert.doesNotMatch(vacancies[0].enquiries, /ANNEXURE B|DEPARTMENT OF ELECTRICITY/);
  assert.equal(vacancies[1].company, "Department of Electricity and Energy");
  assert.match(vacancies[1].requirements, /A relevant degree and experience/);
});

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  NATIONAL_REGION,
  normalizeJobRegion,
  normalizeProvince,
  PROVINCE_CRESTS,
  SOUTH_AFRICAN_PROVINCES
} from "./provinces.js";

const root = dirname(fileURLToPath(import.meta.url));

test("provides nine provinces and a national region", () => {
  assert.equal(SOUTH_AFRICAN_PROVINCES.length, 10);
  assert.equal(new Set(SOUTH_AFRICAN_PROVINCES).size, 10);
  assert.equal(SOUTH_AFRICAN_PROVINCES.at(-1), NATIONAL_REGION);
  assert.deepEqual(
    Object.keys(PROVINCE_CRESTS).sort(),
    SOUTH_AFRICAN_PROVINCES.filter(name => name !== NATIONAL_REGION).sort()
  );
  for (const crest of Object.values(PROVINCE_CRESTS)) {
    assert.ok(existsSync(join(root, crest.slice(1))), `Missing province crest: ${crest}`);
  }
});

test("normalizes case and KwaZulu-Natal punctuation variants", () => {
  const variants = [
    "gauteng",
    "Gauteng",
    "GAUTENG",
    "KwaZulu Natal",
    "Kwazulu-Natal",
    "KWAZULU-NATAL"
  ];
  assert.deepEqual(variants.map(normalizeProvince), [
    "Gauteng",
    "Gauteng",
    "Gauteng",
    "KwaZulu-Natal",
    "KwaZulu-Natal",
    "KwaZulu-Natal"
  ]);
  assert.equal(normalizeProvince("Unknown Province"), "");
  assert.equal(normalizeProvince("national"), NATIONAL_REGION);
});

test("assigns posts without a recognized province to the National region", () => {
  assert.equal(normalizeJobRegion("Gauteng"), "Gauteng");
  assert.equal(normalizeJobRegion(""), NATIONAL_REGION);
  assert.equal(normalizeJobRegion("Unknown Province"), NATIONAL_REGION);
});

test("combines counts for differently formatted province values", () => {
  const rawProvinces = ["gauteng", "Gauteng", "GAUTENG", "KwaZulu Natal", "Kwazulu-Natal"];
  const counts = new Map(SOUTH_AFRICAN_PROVINCES.map(name => [name, 0]));
  for (const rawProvince of rawProvinces) {
    const province = normalizeProvince(rawProvince);
    if (province) counts.set(province, counts.get(province) + 1);
  }

  assert.equal(counts.get("Gauteng"), 3);
  assert.equal(counts.get("KwaZulu-Natal"), 2);
});

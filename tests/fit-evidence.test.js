// Fit evidence truthfulness — two primitive-level bugs reproduced 19 Sep 2026
// (the V.2 sizing plan) and the typed evidence result
// the V.2 contract asks for (docs/v2/CONTRACTS.md § Fit).
//
// Law 1: an absent measurement survives normalize -> display -> resave as
//        absent. Number(null) === 0 must never turn "not told" into "zero".
// Law 2: provenance is earned by supplied numbers. A size-chart estimate
//        cannot self-label as merchant-measured, and `exact` follows the
//        evidence, not a string a caller passed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMeasurementProfile,
  measurementProfileForDisplay,
  hasMeasurementProfile,
} from "../lib/brain/measurements.js";
import { sizeRecord, fitAssessment, fitPhrase, MEASURED_SOURCES } from "../lib/brain/sizing.js";

test("law 1: null dimensions display as empty, not zero, in both units", () => {
  for (const unit of ["in", "cm"]) {
    const { ok, storage } = normalizeMeasurementProfile({ usualSize: "M", unit });
    assert.equal(ok, true);
    assert.equal(storage.inches.chest, null, "storage keeps the absence");
    const display = measurementProfileForDisplay(storage);
    assert.equal(display.usualSize, "M");
    assert.equal(display.unit, unit);
    for (const key of ["chest", "waist", "hips", "inseam", "height"]) {
      assert.equal(display[key], "", `${key} must be "" for a null column (${unit})`);
    }
    // A re-save of the displayed profile must not be rejected for a zero
    // the person never typed.
    const again = normalizeMeasurementProfile(display);
    assert.equal(again.ok, true, `resave of the displayed profile (${unit}) is accepted`);
    assert.equal(again.storage.inches.waist, null);
    // usual size alone is still a profile; the blanks are not measurements
    assert.equal(hasMeasurementProfile(display), true);
  }
});

test("law 1: a real value and an absent value sit side by side", () => {
  const { storage } = normalizeMeasurementProfile({ usualSize: "M", unit: "cm", waist: "81.28" });
  const display = measurementProfileForDisplay(storage);
  assert.equal(display.waist, 81.28);
  assert.equal(display.chest, "");
});

test("law 2: a measured source without measurements is demoted to the estimate", () => {
  const rec = sizeRecord("M", { category: "tops", measurementSource: "merchant" });
  assert.equal(rec.measurementSource, "estimated-size-model");
  assert.equal(rec.evidence, "estimated");
  const fit = fitAssessment(rec, { usualSize: "M", measurements: { chest: 38, waist: 36 } });
  assert.equal(fit.exact, false);
  assert.equal(fit.evidence, "estimated");
  assert.match(fitPhrase(rec, { usualSize: "M", measurements: { chest: 38, waist: 36 } }), /estimated/);
});

test("law 2: supplied measurements keep their provenance and report measured", () => {
  const rec = sizeRecord("M", {
    category: "tops", measurementSource: "listing", measurements: { chest: 42, waist: 40 },
  });
  assert.equal(rec.measurementSource, "listing");
  assert.equal(rec.evidence, "measured");
  assert.deepEqual(rec.measurements, { chest: 42, waist: 40 });
  const fit = fitAssessment(rec, { usualSize: "M", measurements: { chest: 38, waist: 36 } });
  assert.equal(fit.exact, true);
  assert.equal(fit.evidence, "measured");
  assert.equal(fit.status, "match");
});

test("law 2: an unknown provenance word is not a measured source", () => {
  const rec = sizeRecord("M", {
    category: "tops", measurementSource: "trust me", measurements: { chest: 42, waist: 40 },
  });
  assert.equal(MEASURED_SOURCES.includes("trust me"), false);
  assert.equal(rec.measurementSource, "listing-unverified");
  assert.equal(rec.evidence, "estimated");
  assert.equal(fitAssessment(rec, { usualSize: "M", measurements: { chest: 38 } }).exact, false);
});

test("typed evidence: unknown when nothing was compared, with the missing dimensions named", () => {
  const rec = sizeRecord("M", { category: "tops" });
  const noProfile = fitAssessment(rec, null);
  assert.equal(noProfile.evidence, "unknown");
  assert.deepEqual(noProfile.missingDimensions, ["chest", "waist"]);
  assert.equal(noProfile.confidenceBand, "none");
  const sizeOnly = fitAssessment(rec, { usualSize: "M", measurements: {} });
  assert.equal(sizeOnly.status, "size-match");
  assert.equal(sizeOnly.evidence, "unknown", "a ladder match is not measurement evidence");
  assert.deepEqual(sizeOnly.missingDimensions, ["chest", "waist"]);
  const partial = fitAssessment(rec, { usualSize: "M", measurements: { chest: 38 } });
  assert.deepEqual(partial.missingDimensions, ["waist"]);
  assert.equal(partial.evidence, "estimated");
  assert.equal(typeof partial.confidenceBand, "string");
});

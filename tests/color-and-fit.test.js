// tests/color-and-fit.test.js — Colour and fit evidence: merchant colour names
// normalize without guessing from copy, images must corroborate a colour
// before it is verified, and sizes resolve through the measurement brain.

import test from "node:test";
import assert from "node:assert/strict";

import sharp from "sharp";
import { canonicalMerchantColors, reconcileColorEvidence, verifyProductColor } from "../lib/ingest/colorEvidence.js";
import { normalizeSourceProduct, typedTagsFrom } from "../lib/ingest/adapters/normalize.js";
import {
  convertMeasurementUnit, hasMeasurementProfile, measurementProfileForBrain,
  normalizeMeasurementProfile,
} from "../lib/brain/measurements.js";
import { fitAssessment, fitPhrase, sizeRecord } from "../lib/brain/sizing.js";

test("merchant color names normalize without guessing from marketing copy", () => {
  assert.deepEqual(canonicalMerchantColors("Ivory / Charcoal & Wine"), ["cream", "grey", "burgundy"]);
  const item = normalizeSourceProduct({ id: "1", title: "Red carpet statement coat", color: "Black" }, "test");
  assert.equal(item.merchantColor, "Black");
  assert.equal(item.color, null, "merchant text alone is not a verified visual color");
  assert.equal(typedTagsFrom(item).some((tag) => tag.tagType === "color"), false);
});

test("multiple images must corroborate the merchant before a color tag is verified", () => {
  const evidence = reconcileColorEvidence("Black / White", [
    ["white", "black"], ["black", "grey"], ["navy", "black"],
  ]);
  assert.equal(evidence.status, "verified");
  assert.deepEqual(evidence.verifiedColors, ["black"]);
  assert.equal(evidence.imagesAnalyzed, 3);
  assert.equal(evidence.confidence, 0.95);

  const disagreement = reconcileColorEvidence("red", [["blue"], ["blue", "white"]]);
  assert.equal(disagreement.status, "unverified");
  assert.deepEqual(disagreement.verifiedColors, []);
});

test("the verifier recomputes untrusted evidence from actual listing images", async (t) => {
  const image = await sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 8, g: 8, b: 10 } },
  }).png().toBuffer();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(image, {
    status: 200, headers: { "content-type": "image/png", "content-length": String(image.length) },
  });
  const verified = await verifyProductColor({
    merchantColor: "Black", source_product_url: "https://merchant.example/product/1",
    images: ["https://merchant.example/1.png", "https://merchant.example/2.png"],
    colorEvidence: {
      status: "verified", merchantColors: ["red"], observedColors: ["red"],
      verifiedColors: ["red"], imagesAnalyzed: 2, imagesRequired: 2, confidence: 0.95,
      method: "merchant-statement+multi-image-palette-v1",
    },
  });
  assert.deepEqual(verified.colors, ["black"]);
  assert.equal(verified.colorEvidence.imagesAnalyzed, 2);
});

test("verified color evidence creates high-confidence typed color tags", () => {
  const item = normalizeSourceProduct({
    id: "2", title: "Coat", color: "Black", colorEvidence: {
      ...reconcileColorEvidence("Black", [["black"], ["black", "grey"]]),
    },
  }, "test");
  const color = typedTagsFrom(item).find((tag) => tag.tagType === "color");
  assert.equal(item.color, "black");
  assert.equal(color.tag, "black");
  assert.ok(color.confidence >= 0.8);
});

test("measurement profiles validate and convert units without changing the body value", () => {
  const normalized = normalizeMeasurementProfile({
    usualSize: "m", unit: "cm", chest: 101.6, waist: 81.28, hips: 101.6, inseam: 78.74, height: 177.8,
  });
  assert.equal(normalized.ok, true, normalized.error);
  assert.deepEqual(normalized.storage.inches, { chest: 40, waist: 32, hips: 40, inseam: 31, height: 70 });
  const converted = convertMeasurementUnit({ unit: "in", chest: 40, waist: 32 }, "cm");
  assert.equal(converted.chest, 101.6);
  assert.deepEqual(measurementProfileForBrain({ ...converted, usualSize: "M" }).measurements,
    { chest: 40, waist: 32 });
  assert.equal(normalizeMeasurementProfile({ unit: "in", chest: 500 }).ok, false);
});

test("usual-size-only profiles count as real fit profiles", () => {
  assert.equal(hasMeasurementProfile({ usualSize: "M" }), true);
  assert.equal(hasMeasurementProfile({ waist: "32" }), true);
  assert.equal(hasMeasurementProfile({ usualSize: "", waist: "" }), false);
});

test("fit copy distinguishes listing measurements from modeled estimates", () => {
  const profile = { usualSize: "M", measurements: { chest: 40, waist: 32, hips: 40, inseam: 31 } };
  const listing = {
    fitsLikeUS: "M", category: "bottoms", measurementSource: "listing",
    measurements: { waist: 33, hips: 43, inseam: 31 }, runsBias: 0,
  };
  assert.deepEqual(fitAssessment(listing, profile).status, "match");
  assert.equal(fitPhrase(listing, profile), "✓ matches your measurements");
  assert.equal(fitPhrase({ ...listing, fitsLikeUS: null, label: null }, profile),
    "✓ matches your measurements", "merchant measurements work even when the size label is absent");

  const estimated = sizeRecord("M", { category: "tops" });
  assert.match(fitPhrase(estimated, profile), /estimated/);
  assert.equal(fitPhrase(null, profile), "fit data not provided");
});

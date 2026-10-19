// tests/research-pipeline.test.js — The ASTERISK research pipeline: validation
// is atomic and names the defect, proposal names are canonicalized before
// lookup, and kinds come from the live catalog.

import test from "node:test";
import assert from "node:assert/strict";

import {
  validateCultureProposal, proposeCultureEntity, reviewResearch,
  researchQueue, approvedCultureProposals, allowedCultureKinds,
  draftProposalsFromSource,
} from "../lib/asterisk/research.js";
import { CULTURE, lookupCulture, validateCompiledResearchRecord } from "../lib/asterisk/culture.js";
import { recordFact } from "../lib/asterisk/facts.js";
import { interpretQuery } from "../lib/asterisk/queryRouter.js";

const proposal = (over = {}) => ({
  kind: "aesthetic",
  name: "test-core",
  aliases: ["testcore wave"],
  note: "a synthetic aesthetic for the pipeline test",
  interpretations: [{
    id: "test-core/core", label: "test-core", type: "aesthetic",
    summary: "deliberately synthetic — exists only to walk the pipeline",
    tags: ["minimal", "tailored"], colors: ["grey"], moods: ["restrained"],
    confidence: 0.6,
  }],
  ...over,
});

const SOURCES = { sourceUrls: ["https://example.com/research"], reliabilityScore: 0.5 };

test("validation is atomic and names the defect", () => {
  assert.equal(validateCultureProposal(proposal()).ok, true);
  assert.match(validateCultureProposal(proposal({ kind: "planet" })).error, /kind must be one of/);
  assert.match(validateCultureProposal(proposal({ name: "opium" })).error, /already exists/);
  assert.match(validateCultureProposal(proposal({ aliases: ["gorpcore"] })).error, /collides/);
  assert.match(validateCultureProposal(proposal({ trend: { phase: "rising" } })).error, /trends\.js/);
  assert.match(validateCultureProposal(proposal({ interpretations: [] })).error, /1-6 interpretations/);
  assert.match(validateCultureProposal(proposal({
    interpretations: [{ ...proposal().interpretations[0], tags: ["cyberpunk"] }],
  })).error, /not in the live brain tag space/);
  assert.match(validateCultureProposal(proposal({
    interpretations: [{ ...proposal().interpretations[0], confidence: 0.95 }],
  })).error, /confidence/);
  assert.match(validateCultureProposal(proposal({
    interpretations: [{ ...proposal().interpretations[0], id: "wrong/core" }],
  })).error, /must be "test-core\//);
  assert.match(validateCultureProposal(proposal({ aliases: Array(9).fill(0).map((_, i) => `alias-${i}`) })).error, /at most 8/);
  assert.match(validateCultureProposal(proposal({
    interpretations: [{ ...proposal().interpretations[0], colors: Array(7).fill(0).map((_, i) => `color-${i}`) }],
  })).error, /colors allows at most 6/);
});

test("proposal names are canonicalized before collision and lookup", () => {
  const result = validateCultureProposal(proposal({
    name: "  test   spacing  ", aliases: ["test   spacing alias"],
    interpretations: [{ ...proposal().interpretations[0], id: "test spacing/core" }],
  }));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.proposal.name, "test spacing");
  assert.deepEqual(result.proposal.aliases, ["test spacing alias"]);
});

test("kinds come from the live catalog", () => {
  const kinds = allowedCultureKinds();
  assert.ok(kinds.includes("aesthetic"));
  assert.ok(kinds.includes("film"));
});

test("unsourced proposals are refused at the door", async () => {
  const r = await proposeCultureEntity(proposal(), { sourceUrls: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /source URL required/);
  const insecure = await proposeCultureEntity(proposal(), { sourceUrls: ["http://example.com/x"] });
  assert.equal(insecure.ok, false);
  const privateSource = await proposeCultureEntity(proposal(), { sourceUrls: ["https://localhost/x"] });
  assert.equal(privateSource.ok, false);
});

test("research review cannot mutate an unrelated learned fact", async () => {
  const unrelated = await recordFact({ entityType: "brand", entityId: "test-brand",
    claim: "unrelated test fact", claimType: "material", sourceUrls: ["https://example.com/fact"] });
  assert.equal(unrelated.ok, true);
  const reviewed = await reviewResearch(unrelated.fact.id, "pending_verification");
  assert.equal(reviewed.ok, false);
  assert.match(reviewed.error, /research proposal not found/);
});

test("payload cap is measured in UTF-8 bytes", async () => {
  const oversized = await recordFact({ entityType: "test", entityId: "utf8", claim: "payload cap",
    claimType: "test", payload: { text: "é".repeat(5000) } });
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /8 KiB/);
});

test("full lifecycle: propose → review → approve → compile shape (memory store)", async () => {
  const staged = await proposeCultureEntity(proposal(), SOURCES);
  assert.equal(staged.ok, true, staged.error);
  assert.equal(staged.fact.verificationStatus, "discovered");
  const id = staged.fact.id;

  // No jumping the queue: discovered → approved is illegal.
  const jump = await reviewResearch(id, "approved", "tester");
  assert.equal(jump.ok, false);

  for (const [status, reviewer] of [
    ["pending_verification", null], ["machine_reviewed", null], ["human_reviewed", "tester"], ["approved", "tester"],
  ]) {
    const r = await reviewResearch(id, status, reviewer);
    assert.equal(r.ok, true, `${status}: ${r.error}`);
  }

  const queue = await researchQueue({ status: "approved" });
  assert.ok(queue.some((f) => f.id === id));

  const { records, skipped } = await approvedCultureProposals();
  const rec = records.find((r) => r.name === "test-core");
  assert.ok(rec, "approved proposal compiles");
  assert.equal(rec.interpretations[0].confidence, 0.6);
  assert.match(rec.provenance, /^research-approved-/);
  assert.deepEqual(rec.sourceUrls, SOURCES.sourceUrls);
  assert.equal(skipped.length, 0);
});

test("reviewer identities compile into safe deterministic provenance", async () => {
  const staged = await proposeCultureEntity(proposal({
    name: "reviewer-test", aliases: [],
    interpretations: [{ ...proposal().interpretations[0], id: "reviewer-test/core" }],
  }), SOURCES);
  for (const [status, reviewer] of [
    ["pending_verification", null], ["machine_reviewed", null], ["approved", "Jane Q. Reviewer"],
  ]) assert.equal((await reviewResearch(staged.fact.id, status, reviewer)).ok, true);
  const { records } = await approvedCultureProposals();
  assert.equal(records.find((record) => record.name === "reviewer-test").provenance,
    "research-approved-jane-q.-reviewer");
});

test("an approved proposal whose name was since curated is skipped, loudly", async () => {
  // "olsen twins" exists in the curated catalog — a stored approved payload
  // for it must be reported as skipped, never merged over curation.
  const staged = await proposeCultureEntity(proposal({ name: "skip-me", aliases: [],
    interpretations: [{ ...proposal().interpretations[0], id: "skip-me/core" }] }), SOURCES);
  assert.equal(staged.ok, true, staged.error);
  const id = staged.fact.id;
  for (const [status, reviewer] of [
    ["pending_verification", null], ["machine_reviewed", null], ["approved", "tester"],
  ]) assert.equal((await reviewResearch(id, status, reviewer)).ok, true);
  // Corrupt the stored payload to simulate drift: rename to a curated entity.
  const { listLearnedFacts } = await import("../lib/asterisk/facts.js");
  const [fact] = await listLearnedFacts({ id });
  const payload = JSON.parse(fact.value);
  payload.name = "olsen twins";
  fact.value = JSON.stringify(payload); // memory-store object is live
  const { records, skipped } = await approvedCultureProposals();
  assert.ok(!records.some((r) => r.name === "olsen twins"));
  assert.ok(skipped.some((s) => s.id === id && /payload name does not match staged entity/.test(s.reason)));
});

test("model drafting is honestly gated off", async () => {
  const r = await draftProposalsFromSource();
  assert.equal(r.implemented, false);
});

test("curated records stay curated after the research merge runs at load", () => {
  // The shipped culture.research.json is empty; the loader's collision guard
  // means a curated name can never resolve to a research record.
  const rec = lookupCulture("olsen twins");
  assert.ok(rec);
  assert.match(rec.interpretations[0].provenance, /^curated/);
});

test("research interpretations retain auditable provenance at read time", () => {
  const rec = lookupCulture("barbie pink");
  assert.equal(rec?.name, "barbiecore");
  assert.match(rec.interpretations[0].provenance, /^research-approved-/);
  assert.ok(rec.sourceUrls.every((url) => url.startsWith("https://")));
  assert.ok(Number.isFinite(rec.approvedAt));
});

test("public interpretation results expose research source provenance", async () => {
  const result = await interpretQuery("barbiecore");
  assert.match(result.entity.knowledge.provenance, /^research-approved-/);
  assert.equal(result.entity.knowledge.sourceUrls.length, 2);
  assert.ok(result.entity.knowledge.approvedAt > 0);
});

test("a compiled fact re-validates against its own record — compile is idempotent", () => {
  // Found in production on the second batch: a fact's earlier compiled record
  // lives in the loaded catalog, so re-validation without self-recognition
  // refused every batch after the first.
  const compiled = CULTURE.find((rec) => typeof rec.factId === "string");
  assert.ok(compiled, "checked-in research records exist");
  const payload = {
    kind: compiled.kind, name: compiled.name, aliases: compiled.aliases, note: compiled.note,
    interpretations: compiled.interpretations.map(({ id, label, type, summary, tags, colors, moods, confidence }) =>
      ({ id, label, type, summary, tags, colors, moods, confidence })),
  };
  assert.equal(validateCultureProposal(payload).ok, false, "foreign view still refuses");
  assert.equal(validateCultureProposal(payload, { selfFactId: compiled.factId }).ok, true, "self view recognizes its own record");
  assert.equal(validateCultureProposal(payload, { selfFactId: "fact-someone-else" }).ok, false, "another fact's id does not unlock it");
});

test("compiled research records fail closed on malformed trusted data", () => {
  const compiled = {
    ...proposal(), factId: "fact-00000000-0000-4000-8000-000000000000",
    provenance: "research-approved-tester", approvedAt: Date.now(),
    sourceUrls: ["https://example.com/research"],
  };
  const options = { allowedKinds: new Set(CULTURE.map((record) => record.kind)), takenNames: new Set() };
  assert.equal(validateCompiledResearchRecord(compiled, options), null);
  assert.match(validateCompiledResearchRecord({ ...compiled,
    interpretations: [{ ...compiled.interpretations[0], tags: ["invented-tag"] }] }, options), /tag/);
  assert.match(validateCompiledResearchRecord({ ...compiled, sourceUrls: ["https://localhost/research"] }, options), /source/);
});

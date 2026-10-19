// tests/passport-onboarding.test.js — THE PASSPORT'S ONBOARDING, IDENTITY
// ANCHORS AND EXPLORATION ACTIVE (V.2 14.2–14.3, 14.8–14.11; A6 (7); slice
// 10c). Held here:
//   * the birthday sets the year you were twelve and suggests ten artists
//     from then; the home town and the background narrow them; a suggestion
//     is never an answer;
//   * seven questions, skip always, "doesn't apply" only where the law allows
//     it, later questions adapt to earlier answers;
//   * an answer becomes an anchor with the tags it carries; the anchors' tags
//     are the profile's explicit class; removal takes them away; nothing is
//     auto-promoted;
//   * exploration: the passenger's OFF beats reactivation; the ramp walks
//     toward about 2:1 unfamiliar to familiar and never past it.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as O from "../lib/passport/onboarding.js";
import { rampedSplit, unfamiliarRatio, activeSplit, RAMP_STEPS } from "../lib/brain/bridges.js";
import { buildFeed } from "../lib/brain/index.js";
import { getProfile } from "../lib/db/index.js";
import { getMemoryPreferences, saveMemoryPreferences } from "../lib/db/production.js";
import { callRoute, loadRoute, newDevice } from "./helpers/route.js";

test("the cohort register: ten from the year you were twelve, the region and the background narrow; the register says what it is", () => {
  assert.equal(O.COHORT_PROVENANCE.entries > 60, true); assert.match(O.COHORT_PROVENANCE.method, /hand-entered/);
  const atlanta = O.cohortArtists({ year: 2008, region: "us-south", background: "Black or African" });
  assert.equal(atlanta.length, 10);
  assert.ok(atlanta.slice(0, 4).some((a) => ["Lil Wayne", "T.I.", "Soulja Boy"].includes(a.name)), "the South in 2008 leads: " + atlanta.map((a) => a.name).join(", "));
  const london = O.cohortArtists({ year: 2008, region: "uk" });
  assert.ok(london.slice(0, 5).some((a) => ["Dizzee Rascal", "Arctic Monkeys", "Amy Winehouse"].includes(a.name)), london.map((a) => a.name).join(", "));
  assert.deepEqual(O.cohortArtists({ year: "x" }), []);
  assert.ok(O.cohortArtists({ year: 1995, region: "global" }).every((a) => a.years[0] - 2 <= 1995 && 1995 <= a.years[1] + 2), "the year rules first");
  assert.equal(O.regionOf({ name: "Bowie, Maryland", country: "United States" }), "us-south");
  assert.equal(O.regionOf({ name: "Prague", country: "Czechia" }), "europe");
  assert.equal(O.regionOf({ name: "Kingston", country: "Jamaica" }), "caribbean");
  assert.equal(O.regionOf(null), "global");
});

test("the questions: seven, filled from the identity, suggestions by kind, adaptive, skip always, doesn't-apply once", () => {
  const qs = O.questionsFor({ birthDate: "1996-04-02", hometown: { name: "Atlanta, Georgia", country: "United States" }, ethnicity: "Black or African" });
  assert.equal(qs.length, 7);
  assert.match(qs[0].prompt, /12-year-old you.*2008/);
  assert.equal(qs[0].suggestions.length, 10); assert.equal(qs[0].suggestionsFrom, "cohort register");
  assert.equal(qs[1].na, true); assert.equal(qs[1].naLabel, "doesn't apply"); assert.ok(qs.slice(2).every((q) => !q.na), "only the breakup question allows doesn't apply");
  assert.ok(qs.every((q) => q.skippable));
  assert.match(qs[4].prompt, /after school in Atlanta/);
  assert.equal(qs[2].suggestions.length, 5); assert.equal(qs[2].suggestionsFrom, "era");
  assert.equal(qs[6].suggestions.length, 0); assert.equal(qs[6].suggestionsFrom, "free text");
  const bare = O.questionsFor({});
  assert.match(bare[0].prompt, /bus ride to school\?$/, "no birthday: no year is assumed"); assert.deepEqual(bare[0].suggestions, []);
  // later questions adapt: a hip-hop bus answer puts hip-hop first on the breakup question
  const adapted = O.questionsFor({ birthDate: "1996-04-02", hometown: { name: "Atlanta", country: "United States" }, answers: { bus: { text: "T.I.", genre: "hip-hop" } } });
  assert.equal(adapted[1].suggestions[0].genre, "hip-hop");
  assert.equal(adapted[0].answer.text, "T.I.");
  const p = O.progress(adapted);
  assert.deepEqual([p.answered, p.skipped, p.remaining, p.done], [1, 0, 6, false]);
});

test("an answer becomes an anchor with the tags it carries; doesn't-apply anchors nothing; the manual class is the anchors' max", () => {
  const sug = O.cohortArtists({ year: 2008, region: "us-south" }).find((a) => a.name === "Lil Wayne");
  const a = O.anchorFromAnswer({ questionId: "bus", text: "Lil Wayne", suggestion: sug, now: 0 });
  assert.equal(a.ok, true); assert.equal(a.anchor.suggested, true); assert.equal(a.anchor.genre, "hip-hop"); assert.equal(a.anchor.tags.STREETWEAR, O.ANCHOR_WEIGHT);
  const own = O.anchorFromAnswer({ questionId: "closet", text: "a black leather jacket" });
  assert.equal(own.ok, true); assert.equal(own.anchor.suggested, false); assert.ok(Object.keys(own.anchor.tags).length > 0, "the lexicon reads the words: " + JSON.stringify(own.anchor.tags));
  assert.equal(O.anchorFromAnswer({ questionId: "bus", text: "   " }).ok, false);
  assert.equal(O.anchorFromAnswer({ questionId: "closet", na: true }).ok, false, "no doesn't-apply outside the breakup question");
  const na = O.anchorFromAnswer({ questionId: "breakup", na: true });
  assert.equal(na.ok, true); assert.deepEqual(na.anchor.tags, {}); assert.equal(na.anchor.na, true);
  assert.equal(O.anchorFromAnswer({ questionId: "nope", text: "x" }).ok, false);
  const manual = O.manualFromAnchors([a.anchor, own.anchor, na.anchor]);
  assert.equal(manual.STREETWEAR, O.ANCHOR_WEIGHT);
  assert.equal(O.anchorFromAnswer({ questionId: "bus", text: "lil wayne" }).anchor.suggested, true, "a register name typed by hand still carries its tags");
});

test("exploration: the passenger's OFF beats the automatic trigger; the ramp walks toward 2:1 and stops", () => {
  const bored = { long: { TAILORED: 0.9 }, session: {}, _meta: { fatigue: 5, recent: [], seen: [] } };
  const auto = buildFeed({ profile: bored, limit: 12 });
  assert.equal(auto.epsilonAuto, true); assert.equal(auto.exploration.active, true); assert.equal(auto.exploration.step, 1);
  const off = buildFeed({ profile: bored, explorationOff: true, epsilonActive: true, limit: 12 });
  assert.equal(off.exploration.active, false); assert.equal(off.epsilonAuto, false, "14.9: off beats reactivation"); assert.deepEqual(off.split, activeSplit(false));
  assert.deepEqual(rampedSplit(0), activeSplit(false));
  const ratios = [0, 1, 2, 3, 9].map((s) => unfamiliarRatio(rampedSplit(s)));
  assert.ok(ratios[1] > ratios[0] && ratios[2] > ratios[1] && ratios[3] > ratios[2], "the ramp rises: " + ratios.join(" → "));
  assert.equal(ratios[4], ratios[3], "and stops at the top");
  assert.ok(ratios[3] >= 2.5 && ratios[3] <= 3.5, `about two unfamiliar per familiar at the top (the three unfamiliar lanes against the two familiar ones): ${ratios[3]}`);
  for (let s = 0; s <= RAMP_STEPS; s++) assert.equal(Object.values(rampedSplit(s)).reduce((a, b) => a + b, 0), 100, "a split sums to 100 at step " + s);
  const stepped = buildFeed({ profile: { ...bored, _meta: { ...bored._meta, explorationStep: 2 } }, limit: 12 });
  assert.equal(stepped.exploration.step, 3, "one step per chunk while active");
});

test("the route: questions for a device without a birthday; an answer anchors and reaches the profile's explicit class; remove takes it back; skip and resume", async () => {
  const route = await loadRoute("app/api/passport/onboarding/route.js");
  const memory = await loadRoute("app/api/asterisk/memory/route.js");
  const me = newDevice();
  assert.equal((await callRoute(route.GET, { path: "/api/passport/onboarding" })).status, 401);
  const first = await callRoute(route.GET, { path: "/api/passport/onboarding", cookies: me.cookies, query: { user: me.uid } });
  assert.equal(first.status, 200); assert.equal(first.body.questions.length, 7); assert.equal(first.body.identity.yearAt12, null); assert.equal(first.body.progress.done, false);
  assert.equal(first.body.law.cohorts.entries > 60, true);
  const sug = { name: "Deftones" };
  const ans = await callRoute(route.POST, { path: "/api/passport/onboarding", cookies: me.cookies, json: { user: me.uid, action: "answer", questionId: "bus", text: "Deftones", suggestion: sug } });
  assert.equal(ans.status, 200); assert.equal(ans.body.anchors.length, 1); assert.equal(ans.body.anchors[0].suggested, true); assert.ok(ans.body.manual.SEDUCTIVE > 0);
  const prof = await getProfile(me.uid);
  assert.ok(prof._meta.manual.SEDUCTIVE > 0, "the explicit class carries the anchor's tags"); assert.equal(prof._meta.anchors.length, 1);
  const skip = await callRoute(route.POST, { path: "/api/passport/onboarding", cookies: me.cookies, json: { user: me.uid, action: "skip", questionId: "breakup" } });
  assert.equal(skip.body.progress.skipped, 1); assert.equal(skip.body.questions[1].skipped, true);
  const na = await callRoute(route.POST, { path: "/api/passport/onboarding", cookies: me.cookies, json: { user: me.uid, action: "answer", questionId: "breakup", na: true } });
  assert.equal(na.body.questions[1].answer.na, true); assert.equal(na.body.progress.skipped, 0, "an edit replaces the skip");
  const bad = await callRoute(route.POST, { path: "/api/passport/onboarding", cookies: me.cookies, json: { user: me.uid, action: "answer", questionId: "closet", na: true } });
  assert.equal(bad.status, 400);
  const rm = await callRoute(route.POST, { path: "/api/passport/onboarding", cookies: me.cookies, json: { user: me.uid, action: "remove", questionId: "bus" } });
  assert.equal(rm.body.anchors.filter((a) => !a.na).length, 0);
  assert.equal((await getProfile(me.uid))._meta.manual.SEDUCTIVE, undefined, "removal takes the tags away (14.3)");
  const again = await callRoute(route.GET, { path: "/api/passport/onboarding", cookies: me.cookies, query: { user: me.uid } });
  assert.equal(again.body.questions[1].answer.na, true, "resume keeps what was answered");
  // the |A| in the Info Dock: exploration off, read back by the feed's preference
  const off = await callRoute(memory.POST, { path: "/api/asterisk/memory", cookies: me.cookies, json: { user: me.uid, explorationOff: true } });
  assert.equal(off.status, 200);
  assert.equal((await getMemoryPreferences(me.uid)).explorationOff, true);
  await saveMemoryPreferences(me.uid, { explorationOff: false });
  assert.equal((await getMemoryPreferences(me.uid)).explorationOff, false);
  assert.equal((await callRoute(memory.POST, { path: "/api/asterisk/memory", cookies: me.cookies, json: { user: me.uid, explorationOff: "yes" } })).status, 400);
});

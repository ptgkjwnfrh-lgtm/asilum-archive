// tests/disc.test.js — the disc's physics and the dwell clock (V.2
// Blueprint, chapter 2), held against lib/disc.js without a DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stepFor, indexAt, angleFor, snapAngle, stepMomentum, pointerAngle, delta, dwell, DWELL_MS, SLOW_DEG_PER_S, tuning } from "../lib/disc.js";

test("items sit at even steps around the disc and snap to the nearest", () => {
  assert.equal(stepFor(10), 36);
  assert.equal(stepFor(6), 60);
  assert.equal(angleFor(3, 10), 108);
  assert.equal(indexAt(100, 10), 3);
  assert.equal(indexAt(350, 10), 0, "wraps past the top");
  assert.equal(snapAngle(100, 10), 108);
  assert.equal(snapAngle(-10, 10), 0);
});

test("2.1 — a fast flick coasts under friction; once slow it snaps and ticks; it settles at a rest angle", () => {
  let s = { angle: 0, velocity: 1800 }; // deg/s: a hard flick on a ten-item dial
  let ticksWhileFast = 0, ticksWhileSlow = 0, frames = 0;
  while (frames < 600) {
    const next = stepMomentum(s, 10, 16);
    if (next.tick) { if (next.slow) ticksWhileSlow++; else ticksWhileFast++; }
    s = next; frames++;
    if (next.settled) break;
  }
  assert.ok(frames < 600, "the disc settles");
  assert.equal(ticksWhileFast, 0, "no ticks while spinning fast");
  assert.ok(ticksWhileSlow >= 1, "ticks begin as momentum fades");
  assert.equal(s.angle, snapAngle(s.angle, 10), "it rests on an item");
  assert.equal(s.velocity, 0);
});

test("2.1 — a slow movement snaps immediately", () => {
  const next = stepMomentum({ angle: 30, velocity: 20 }, 10, 16);
  assert.ok(next.slow);
  assert.ok(Math.abs(next.angle - 36) < Math.abs(30 - 36), "pulled toward the rest angle on the first frame");
});

test("2.2 — physics are shared but tuned by item count", () => {
  assert.ok(tuning(6).friction < tuning(10).friction, "fewer items spin shorter");
  assert.ok(tuning(6).snap > tuning(10).snap, "and snap harder");
  assert.ok(SLOW_DEG_PER_S > 0);
});

test("pointer angles read clockwise from the top; deltas take the short way round", () => {
  assert.equal(Math.round(pointerAngle(0, 0, 0, -10)), 0, "straight up is 0");
  assert.equal(Math.round(pointerAngle(0, 0, 10, 0)), 90, "right is 90");
  assert.equal(Math.round(pointerAngle(0, 0, 0, 10)), 180);
  assert.equal(delta(350, 10), 20);
  assert.equal(delta(10, 350), -20);
});

test("2.3 / 2.5 — the dwell fires after one still second; movement pauses it and a new selection restarts it", () => {
  let d = dwell(null, { index: 2, settled: true, now: 0 });
  assert.equal(d.fire, false);
  d = dwell(d, { index: 2, settled: true, now: 500 });
  assert.equal(d.progress, 0.5);
  d = dwell(d, { index: 2, settled: false, now: 600 });
  assert.equal(d.since, null, "movement pauses the clock");
  d = dwell(d, { index: 2, settled: true, now: 700 });
  d = dwell(d, { index: 2, settled: true, now: 700 + DWELL_MS });
  assert.equal(d.fire, true, "a fresh second after settling fires");
  d = dwell(d, { index: 3, settled: true, now: 2000 });
  assert.equal(d.fire, false, "a new selection restarts the clock");
  assert.equal(d.since, 2000);
});

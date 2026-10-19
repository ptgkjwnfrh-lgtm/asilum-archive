// lib/disc.js — THE DISC's physics, as pure functions (V.2 Blueprint,
// owner, 17 Oct 2026, chapter 2 "Disc controls, motion and tactile
// behavior"). The component (app/components/Disc.jsx) drives these each
// frame; the tests hold the laws without a DOM.
//
//   2.1  momentum with magnetic snapping: a fast flick spins free; as it
//        slows, snapping and ticks begin; a slow turn snaps at once
//   2.2  shared physics, tuned by item count (snap strength, friction)
//   2.3  tap to confirm, or a one-second dwell
//   2.5  movement pauses the dwell; it restarts when the disc settles
//   2.7  the disc can be turned off per interface, remembered
//
// Angles are degrees; index 0 sits at the top (angle 0) and the disc turns
// clockwise through its items.

export const DWELL_MS = 1000;
export const LONG_PRESS_MS = 500;
/** below this speed (deg per second) the disc is "slow": snapping and ticks
 *  apply immediately (2.1) */
export const SLOW_DEG_PER_S = 240;

/** Degrees between items. */
export function stepFor(count) {
  return count > 0 ? 360 / count : 360;
}

/** Normalise to [0, 360). */
export function norm(angle) {
  const a = angle % 360;
  return a < 0 ? a + 360 : a;
}

/** The item under the pointer at this angle. */
export function indexAt(angle, count) {
  if (count <= 0) return 0;
  const step = stepFor(count);
  return Math.round(norm(angle) / step) % count;
}

/** The angle that centres an item. */
export function angleFor(index, count) {
  return norm(index * stepFor(count));
}

/** The nearest resting angle (magnetic snap). */
export function snapAngle(angle, count) {
  return angleFor(indexAt(angle, count), count);
}

/** Shared physics, tuned by the number of items (2.2): fewer items snap
 *  harder and spin shorter; a ten-item dial coasts a little longer. */
export function tuning(count) {
  const n = Math.max(1, count);
  return {
    friction: n <= 4 ? 0.90 : n <= 8 ? 0.93 : 0.95,   // velocity kept per 16ms frame
    snap: n <= 4 ? 0.30 : n <= 8 ? 0.22 : 0.18,        // pull toward the rest angle per frame, once slow
    stop: 6,                                            // deg/s under which the disc is at rest
  };
}

/**
 * One frame of free motion after release. `velocity` is deg/s. Fast motion
 * coasts under friction; once slow, the magnetic pull toward the nearest
 * rest angle takes over and the disc settles (2.1). Returns the next state
 * and whether a tick (a snap boundary crossed while slow) should fire.
 */
export function stepMomentum(state, count, dtMs = 16) {
  const { friction, snap, stop } = tuning(count);
  const dt = Math.max(1, dtMs) / 1000;
  let { angle, velocity } = state;
  const before = indexAt(angle, count);
  const fast = Math.abs(velocity) > SLOW_DEG_PER_S;
  angle = norm(angle + velocity * dt);
  velocity *= Math.pow(friction, dtMs / 16);
  let settled = false;
  if (!fast) {
    // the magnet grows as the disc slows: at the slow threshold it is a
    // whisper, so the disc still passes items (and ticks on each); near rest
    // it holds the item firmly
    const pull = snap * (1 - Math.min(1, Math.abs(velocity) / SLOW_DEG_PER_S));
    const target = snapAngle(angle, count);
    let d = target - angle;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    angle = norm(angle + d * pull);
    if (Math.abs(velocity) < stop && Math.abs(d) < 0.25) { angle = target; velocity = 0; settled = true; }
  }
  const after = indexAt(angle, count);
  const tick = !fast && after !== before;
  return { angle, velocity, settled, tick, slow: !fast };
}

/** Angle of a pointer around a centre, in the disc's own frame (0 at top,
 *  clockwise). */
export function pointerAngle(cx, cy, x, y) {
  return norm((Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90);
}

/** The signed shortest turn from one angle to another. */
export function delta(from, to) {
  let d = norm(to) - norm(from);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * The dwell clock (2.3, 2.5). Pure: feed it the settled index and the time;
 * it says when the centred item has been still for DWELL_MS. Movement
 * resets it; a change of selection resets it; confirming clears it.
 */
export function dwell(prev, { index, settled, now }) {
  if (!settled) return { index, since: null, progress: 0, fire: false };
  if (!prev || prev.index !== index || prev.since == null) return { index, since: now, progress: 0, fire: false };
  const elapsed = now - prev.since;
  return { index, since: prev.since, progress: Math.min(1, elapsed / DWELL_MS), fire: elapsed >= DWELL_MS };
}

/** The per-interface disc preference key (2.7, 2.8). */
export function prefKey(name) {
  return "asilum-disc:" + String(name || "disc");
}

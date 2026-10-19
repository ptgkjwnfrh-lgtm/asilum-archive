// tests/sessions.test.js — the universal session hub's laws (V.2 Blueprint,
// chapter 1), held against the pure model in lib/sessions.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_LIMIT, createHub, newSession, openView, pushView, back, dismiss, switchSession,
  closeSession, undoClose, renameSession, ordered, counter, activeSession, topView,
  identityOf, previewFor, serialize, hydrate, isFull,
} from "../lib/sessions.js";

const T = (n) => 1_700_000_000_000 + n * 1000;

test("1.1 / 1.2 — a popup extends the active session; Back restores the previous one; the last Back dismisses", () => {
  let h = openView(createHub(), "search", { q: "erd" }, { now: T(1) });
  assert.equal(h.sessions.length, 1, "the first popup makes the first session");
  h = pushView(h, "overview", { title: "ERD" }, { now: T(2) });
  h = pushView(h, "overview", { title: "Jacket" }, { now: T(3) });
  assert.equal(activeSession(h).stack.length, 3);
  assert.equal(topView(h).props.title, "Jacket");
  h = back(h, { now: T(4) });
  assert.equal(topView(h).props.title, "ERD", "Back restores the previous popup exactly");
  h = back(h, { now: T(5) });
  assert.equal(topView(h).view, "search");
  h = back(h, { now: T(6) });
  assert.equal(h.open, false, "nothing left: the popup is dismissed");
  assert.equal(activeSession(h).stack.length, 1, "but the session keeps its history (1.3)");
});

test("1.3 / 1.9 — dismissing keeps the session; reopening resumes where it left off", () => {
  let h = openView(createHub(), "search", { q: "erd" }, { now: T(1) });
  h = pushView(h, "overview", { title: "ERD" }, { now: T(2) });
  h = dismiss(h);
  assert.equal(h.open, false);
  const id = h.activeId;
  h = switchSession(h, id, { now: T(3) });
  assert.equal(h.open, true);
  assert.equal(topView(h).props.title, "ERD");
});

test("opening a view already in the chain pops back to it rather than stacking it twice", () => {
  let h = openView(createHub(), "search", { q: "a" }, { now: T(1) });
  h = pushView(h, "overview", { title: "X" }, { now: T(2) });
  h = openView(h, "search", { q: "b" }, { now: T(3) });
  assert.deepEqual(activeSession(h).stack.map((e) => e.view), ["search"]);
  assert.equal(topView(h).props.q, "b", "the same surface is updated, not duplicated");
});

test("1.7 / 1.8 / 1.21 — ten sessions, the fixed-capacity counter, and the manager at the eleventh", () => {
  let h = createHub();
  for (let i = 0; i < SESSION_LIMIT; i++) h = newSession(h, { now: T(i) });
  assert.equal(h.sessions.length, 10);
  assert.ok(isFull(h));
  assert.equal(counter(h, h.activeId), "01/10", "the newest is first and the counter reads over the limit");
  assert.equal(counter(h, h.sessions[0].id), "10/10", "the oldest sits last; always /10 (1.21)");
  const before = h;
  h = newSession(h, { now: T(99) });
  assert.equal(h.sessions.length, 10, "nothing is created");
  assert.equal(h.manager, true, "the manager opens instead");
  assert.equal(h.activeId, before.activeId, "and nothing was discarded (1.8)");
  // a first popup at the limit also goes to the manager rather than silently reusing a slot
  const h2 = openView({ ...before, activeId: null, open: false }, "likes", {}, { now: T(100) });
  assert.equal(h2.manager, true);
  assert.equal(h2.sessions.length, 10);
});

test("1.22 — most recently used first; switching touches a session", () => {
  let h = newSession(createHub(), { now: T(1) });
  const a = h.activeId;
  h = newSession(h, { now: T(2) });
  const b = h.activeId;
  assert.deepEqual(ordered(h).map((s) => s.id), [b, a]);
  h = switchSession(h, a, { now: T(3) });
  assert.deepEqual(ordered(h).map((s) => s.id), [a, b]);
  assert.equal(counter(h, a), "01/10");
});

test("1.24 — closing a session can be undone; the next most recent becomes active, closed", () => {
  let h = openView(createHub(), "likes", {}, { now: T(1) });
  const a = h.activeId;
  h = newSession(h, { now: T(2) });
  h = openView(h, "search", { q: "x" }, { now: T(3) });
  const b = h.activeId;
  h = closeSession(h, b);
  assert.equal(h.sessions.length, 1);
  assert.equal(h.activeId, a, "the other session is active");
  assert.equal(h.open, false, "but not reopened on its own");
  assert.ok(h.undo && h.undo.session.id === b);
  h = undoClose(h, { now: T(4) });
  assert.equal(h.sessions.length, 2);
  assert.equal(h.undo, null);
  assert.ok(h.sessions.some((s) => s.id === b), "the closed session is back with its history");
  assert.equal(h.sessions.find((s) => s.id === b).stack[0].props.q, "x");
});

test("1.32 / 1.33 — identity follows the content until the passenger names the session", () => {
  let h = newSession(createHub(), { now: T(1) });
  assert.deepEqual(identityOf(activeSession(h)), { icon: "disc", title: "NEW SESSION", auto: true });
  h = openView(h, "search", { q: "erd" }, { now: T(2) });
  assert.equal(identityOf(activeSession(h)).title, "SEARCH · ERD");
  h = pushView(h, "overview", { title: "Enfants Riches Déprimés" }, { now: T(3) });
  assert.equal(identityOf(activeSession(h)).icon, "glasses");
  h = renameSession(h, h.activeId, "Jackets I'm considering");
  h = pushView(h, "likes", {}, { now: T(4) });
  const id = identityOf(activeSession(h));
  assert.equal(id.title, "Jackets I'm considering", "a custom title stays fixed");
  assert.equal(id.auto, false);
  h = renameSession(h, h.activeId, "   ");
  assert.equal(identityOf(activeSession(h)).title, "LIKES", "an empty name returns to automatic identity");
});

test("1.34 — sensitive previews are hidden by default; payment screens are never previewed", () => {
  let h = openView(createHub(), "messages", {}, { now: T(1) });
  const s = activeSession(h);
  assert.equal(previewFor(s).hidden, true);
  assert.equal(previewFor(s, { revealSensitive: true }).hidden, false, "eligible previews can be revealed");
  h = pushView(h, "checkout", {}, { now: T(2) });
  assert.equal(previewFor(activeSession(h), { revealSensitive: true }).hidden, true, "never, for a payment screen");
  const open = openView(createHub(), "search", { q: "x" }, { now: T(3) });
  assert.equal(previewFor(activeSession(open)).hidden, false);
});

test("1.9 / 1.10 — the hub survives a restart: sessions, the active one, and whether a popup was up", () => {
  let h = openView(createHub(), "search", { q: "erd" }, { now: T(1) });
  h = pushView(h, "overview", { title: "ERD" }, { now: T(2) });
  h = newSession(h, { now: T(3) });
  h = dismiss(h);
  const again = hydrate(serialize(h));
  assert.equal(again.sessions.length, 2);
  assert.equal(again.activeId, h.activeId);
  assert.equal(again.open, false, "a blank session dismissed stays dismissed");
  const live = hydrate(serialize(switchSession(h, h.sessions[0].id, { now: T(4) })));
  assert.equal(live.open, true, "an open popup resumes exactly where it was (1.10)");
  assert.equal(topView(live).props.title, "ERD");
  assert.deepEqual(hydrate("not json"), createHub(), "garbage hydrates to an empty hub");
  assert.deepEqual(hydrate(JSON.stringify({ v: 1 })), createHub(), "an old shape hydrates to an empty hub");
});

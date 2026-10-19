// tests/dm-desk.test.js — the mail desk's decisions, tested without a DOM.
//
// There is no jsdom in this repo, so these rules were untestable while they
// lived inside MailDesk.jsx. Each one below is a finding from
// docs/history/dm-open-findings-2026-08-23.md, written from its Reproduce section.

import test from "node:test";
import { dmStoreSource } from "./helpers/dm-source.mjs";
import assert from "node:assert/strict";

import {
  composerKey, mergeFolderItems, NO_SIGNAL, pageIsCurrent, reactionsAcross,
  shouldPollActivity, startSummaryPolling,
} from "../lib/dm-desk.js";

function pollingBrowser(visibility = "visible") {
  const page = new EventTarget();
  const host = new EventTarget();
  const timers = new Map();
  let nextTimer = 0;
  page.visibilityState = visibility;
  host.setInterval = (callback, intervalMs) => {
    const id = ++nextTimer;
    timers.set(id, { callback, intervalMs });
    return id;
  };
  host.clearInterval = (id) => timers.delete(id);
  return {
    page, host, timers,
    tick: () => [...timers.values()].forEach(({ callback }) => callback()),
    visibility: (state) => {
      page.visibilityState = state;
      page.dispatchEvent(new Event("visibilitychange"));
    },
    identity: () => host.dispatchEvent(new Event("asilum:identity")),
  };
}

test("inbox summaries wait until a background tab becomes visible", () => {
  const browser = pollingBrowser("hidden");
  let requests = 0;
  const stop = startSummaryPolling(() => requests++, browser);
  assert.equal(requests, 0);
  assert.equal(browser.timers.size, 0);
  browser.tick();
  browser.identity();
  assert.equal(requests, 0);
  browser.visibility("visible");
  assert.equal(requests, 1, "returning refreshes immediately");
  assert.equal(browser.timers.size, 1);
  stop();
});

test("inbox polling pauses while hidden and keeps the visible cadence", () => {
  const browser = pollingBrowser();
  let requests = 0;
  const stop = startSummaryPolling(() => requests++, { ...browser, intervalMs: 45000 });
  assert.equal(requests, 1);
  assert.equal([...browser.timers.values()][0].intervalMs, 45000);
  browser.tick();
  assert.equal(requests, 2);
  browser.visibility("hidden");
  assert.equal(browser.timers.size, 0);
  for (let i = 0; i < 80; i++) browser.tick();
  browser.identity();
  assert.equal(requests, 2, "an hour hidden creates no summary requests");
  browser.visibility("visible");
  assert.equal(requests, 3);
  browser.identity();
  assert.equal(requests, 4, "visible account changes still refresh");
  assert.equal(browser.timers.size, 1);
  stop();
});

test("inbox polling does not accumulate timers or survive cleanup", () => {
  const browser = pollingBrowser();
  let requests = 0;
  const stop = startSummaryPolling(() => requests++, browser);
  for (let i = 0; i < 3; i++) {
    browser.visibility("hidden");
    browser.visibility("visible");
    assert.equal(browser.timers.size, 1);
  }
  assert.equal(requests, 4);
  stop();
  stop();
  browser.tick();
  browser.identity();
  browser.visibility("hidden");
  browser.visibility("visible");
  assert.equal(requests, 4);
  assert.equal(browser.timers.size, 0);
});

test("a draft cannot reach a composer it was not written for", () => {
  // The register's scenario: type "the invoice is wrong, can you refund the
  // 240" into the search-mode first-message box for @stu, clear the search,
  // then open an existing conversation. One shared string handed that text to
  // the thread composer, which sends on a bare Enter.
  const forStu = composerKey({ searching: true });
  const inThread = composerKey({ threadId: "c0ffee00-0000-4000-8000-000000000000" });
  const otherThread = composerKey({ threadId: "deadbeef-0000-4000-8000-000000000000" });

  assert.notEqual(forStu, inThread, "the search box and a thread are different composers");
  assert.notEqual(inThread, otherThread, "and so are two threads");

  // the drafts a panel holds, keyed
  const drafts = { [forStu]: "the invoice is wrong, can you refund the 240" };
  assert.equal(drafts[inThread] || "", "",
    "opening a conversation finds ITS composer, which is empty");
  assert.equal(drafts[otherThread] || "", "", "and so does the next one");
  assert.equal(drafts[forStu], "the invoice is wrong, can you refund the 240",
    "while the message you actually wrote is still where you wrote it");

  // no thread and not searching is no composer at all
  assert.equal(composerKey(), "");
  assert.equal(composerKey({}), "");
});

test("a folder page cannot land in a folder it was not asked for", () => {
  // MORE ↓ on the inbox, then switch to REQUESTS while it is in flight. The
  // inbox page lands second and used to be APPENDED to the requests list —
  // accepted threads under "first messages from people you have not spoken
  // to", carrying the preview text the store nulls for requests, and
  // installing the inbox cursor so MORE ↓ kept paging the inbox.
  const inFlight = { folder: "inbox", token: 7 };
  const nowSelected = { folder: "requests", token: 8 };

  assert.equal(pageIsCurrent(inFlight, nowSelected), false, "a different folder AND an older request");
  assert.equal(pageIsCurrent({ folder: "requests", token: 7 }, nowSelected), false,
    "the same folder, but a request the panel has already superseded");
  assert.equal(pageIsCurrent({ folder: "inbox", token: 8 }, nowSelected), false,
    "the current request, but for the folder that is no longer selected");
  assert.equal(pageIsCurrent(nowSelected, nowSelected), true, "only the current one applies");

  // de-duplication by id could never have caught it: the ids are all real
  const requests = [{ id: "r1" }];
  const inboxPage = [{ id: "i1" }, { id: "i2" }];
  assert.deepEqual(mergeFolderItems(requests, inboxPage, { append: true }).map((x) => x.id),
    ["r1", "i1", "i2"],
    "which is exactly what it used to do — the row is fine, the FOLDER is wrong");
});

test("a page that is current is merged, and merged once", () => {
  const page1 = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(mergeFolderItems(null, page1).map((x) => x.id), ["a", "b"], "page one replaces");
  assert.deepEqual(mergeFolderItems(page1, [{ id: "c" }], { append: true }).map((x) => x.id),
    ["a", "b", "c"]);
  // a conversation that gained a message mid-scroll can legally appear twice
  assert.deepEqual(mergeFolderItems(page1, [{ id: "b" }, { id: "c" }], { append: true }).map((x) => x.id),
    ["a", "b", "c"], "de-duplicated by id, and the first position is kept");
  assert.deepEqual(mergeFolderItems(page1, null, { append: true }).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(mergeFolderItems(page1, [{ id: "c" }]).map((x) => x.id), ["c"],
    "a page-one response REPLACES — that is what makes a folder switch clean");
});

test("a reaction on an older page is still a reaction", () => {
  // Someone reacted to a message forty-one back. loadOlder kept only
  // { messages, olderBefore } and threw the page's reactions away, so the
  // message rendered bare, the reader tapped the same reaction again, and
  // loadThread reset the older pages so the message left the view entirely.
  const newest = { messages: [{ id: 90 }], reactions: { 90: [{ emoji: "\u{1F44D}", count: 1, mine: false }] } };
  const older = { messages: [{ id: 49 }], reactions: { 49: [{ emoji: "❤️", count: 2, mine: true }] } };
  const pages = [newest, older];

  assert.deepEqual(reactionsAcross(pages, 90).map((r) => r.emoji), ["\u{1F44D}"]);
  assert.deepEqual(reactionsAcross(pages, 49).map((r) => r.emoji), ["❤️"],
    "the older page's own reactions, not the newest page's map");
  assert.deepEqual(reactionsAcross(pages, 12), [], "a message nobody reacted to");
  assert.deepEqual(reactionsAcross([{ messages: [] }], 1), [], "a page that carried none at all");
  assert.deepEqual(reactionsAcross(null, 1), []);
});

test("a knock is not polled for presence", () => {
  // v46 made presence need an ACCEPTED conversation — in the trigger and in
  // the query — so polling an unaccepted knock returns nulls forever. The
  // client kept polling anyway: 1200 guaranteed-empty reads an hour, which is
  // exactly the caller's own dm-activity budget. Spend it on a knock and the
  // indicators in their REAL threads go quiet for the rest of the hour,
  // because the tick ignores a 429.
  assert.equal(shouldPollActivity({ open: true, threadId: "c1", folder: "requests" }), false,
    "a request has nothing to poll for");
  assert.equal(shouldPollActivity({ open: true, threadId: "c1", folder: "inbox" }), true);
  assert.equal(shouldPollActivity({ open: true, threadId: "c1", folder: "archived" }), true,
    "an archived thread was accepted once — its presence is still meaningful");

  // NOR A KNOCK NOBODY HAS ANSWERED, from either side. The folder test only
  // silenced the RECIPIENT: the opener's own copy of a knock sits in their
  // INBOX, so they polled every three seconds forever for an answer v46
  // guarantees is empty — the exact waste this predicate exists to stop, on
  // the side nobody checked.
  assert.equal(shouldPollActivity({ open: true, threadId: "c1", folder: "inbox", heardFromThem: false }),
    false, "my own knock, still unanswered");
  assert.equal(shouldPollActivity({ open: true, threadId: "c1", folder: "inbox", heardFromThem: true }),
    true, "once they have said anything, presence means something");

  // not open, or no thread, is not a poll either way
  assert.equal(shouldPollActivity({ open: false, threadId: "c1", folder: "inbox" }), false);
  assert.equal(shouldPollActivity({ open: true, threadId: null, folder: "inbox" }), false);
  assert.equal(shouldPollActivity({}), false);
  assert.equal(shouldPollActivity(), false);

  // A thread that has not loaded yet has no folder. Poll: the common case is
  // an accepted thread, and one wasted tick is cheaper than an indicator that
  // never starts.
  assert.equal(shouldPollActivity({ open: true, threadId: "c1", folder: null }), true);
});

test("no signal is nothing known, not a negative answer", () => {
  // The panel's LOCAL state when a thread opens or a poll fails. Here the
  // answer is genuinely unknown and null says so, so nothing renders.
  //
  // This is deliberately NOT the shape the wire uses. The payload answers two
  // booleans, because a null that only SOME peers produce is a fact about
  // those peers — that was the activity oracle: signals on with nothing read
  // serialised as 0, signals off as null, and one request told you which. This
  // constant never crosses the network and is never compared against another
  // person's data.
  assert.deepEqual(NO_SIGNAL, { typing: null, readYours: null });
  assert.notEqual(NO_SIGNAL.typing, false, "false says they are not typing; null says we do not know");
  assert.notEqual(NO_SIGNAL.readYours, false);
  assert.ok(Object.isFrozen(NO_SIGNAL), "one shared constant nobody can mutate into a claim");
});

test("the panel routes every thread change through one door", async () => {
  // The guards this file exists to make testable are refs inside the
  // component, so what can be checked here is that the component actually uses
  // them — that no writer of the open thread bypasses the reset, and that both
  // in-flight readers check they are still current before merging.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const panel = readFileSync(
    fileURLToPath(new URL("../app/components/MailDesk.jsx", import.meta.url)), "utf8");

  assert.match(panel, /useEffect\(\(\) => startSummaryPolling\(poll,/,
    "the mounted desk uses the visibility-aware scheduler exercised above");
  assert.doesNotMatch(panel, /setInterval\(poll,/,
    "no independent summary interval can bypass the scheduler");

  const raw = [...panel.matchAll(/setThreadId\(/g)].length;
  assert.equal(raw, 1,
    "setThreadId is called in exactly one place — inside showThread, which also "
    + "clears the last thread's pages and its stale peer signal");
  assert.match(panel, /openThreadRef\.current = id/, "and that one place updates the ref");

  // both async readers bail on a late response
  assert.match(panel, /if \(openThreadRef\.current !== id\) return;/,
    "loadThread drops a page for a thread nobody is looking at");
  assert.match(panel, /const forThread = threadId;/,
    "loadOlder captures the thread its page belongs to");

  // a failed poll must go quiet rather than keep the last thread's answer
  assert.match(panel, /setPeer\(NO_SIGNAL\)/, "and a failed tick clears the signal");
  assert.equal([...panel.matchAll(/setPeer\(NO_SIGNAL\)/g)].length >= 3, true,
    "on switch, on a bad response, and on a thrown fetch");
});

test("the panel is a thread that receives, and a desk that leads with the mail", async () => {
  // Four things the desk did not do, none of them in the findings register,
  // all of them the first things a person would notice.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const panel = readFileSync(root + "app/components/MailDesk.jsx", "utf8");
  const store = dmStoreSource();

  // 1. AN OPEN THREAD NEVER RECEIVED A MESSAGE. Nothing refetched it: the
  // badge poll moved counts, the activity poll moved typing and read, and
  // loadThread ran only on open and after the reader's OWN actions. You
  // watched "typing…" and then nothing arrived.
  assert.match(store, /AS newest/, "the activity read returns the newest id in MY thread");
  assert.match(panel, /newestSeen/, "and the panel remembers what it has already seen");
  assert.match(panel, /Number\(data\.newest\) > Number\(newestSeen\.current/,
    "so a refresh happens when it MOVES, not on every tick");

  // 2. You could not see who you were talking to.
  assert.match(store, /with: \(await handlesFor\(\[member\.rows\[0\]\.other_id\]\)\)/,
    "readThread carries the counterparty, by handle");
  assert.match(panel, /thread\.with/);
  assert.doesNotMatch(panel, /\botherId\b/, "and still never a uuid");

  // 3. A count that climbed over a list that did not move.
  assert.match(panel, /countsMoved/, "the badge poll now says when the list beneath it is stale");

  // 4. The panel led with two checkboxes and a list of people you had blocked.
  const listAt = panel.indexOf('className="maillist"');
  const settingsAt = panel.indexOf('className="mailsignals"');
  const blocksAt = panel.indexOf('className="mailblocks"');
  assert.ok(listAt > 0 && settingsAt > 0 && blocksAt > 0);
  assert.ok(listAt < settingsAt && listAt < blocksAt,
    "the mail comes before the controls that shape it");

  // and the dismissal contract is complete: the panel is a dialog, it traps
  // focus, and closing gives focus back — the half people forget.
  assert.match(panel, /useFocusTrap\(panelRef, open\)/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-live="polite"/, "and a failure is announced, not just drawn");
});

// ---------------------------------------------------------------------------
// STAGE C (V.2 brief §3): which controls a row shows, and what the counter says.
// ---------------------------------------------------------------------------
import { composerCount, messageControls } from "../lib/dm-desk.js";

test("EDIT and UNSEND show only on my own live text inside the hour; a card can be unsent but not edited", () => {
  const sent = Date.parse("2026-10-02T10:00:00.000Z");
  const row = (over = {}) => ({ id: 1, mine: true, unsent: false, redacted: false, kind: "text", at: "2026-10-02T10:00:00.000Z", body: "x", ...over });
  assert.deepEqual(messageControls(row(), sent + 3_599_999), { edit: true, unsend: true }, "59:59");
  assert.deepEqual(messageControls(row(), sent + 3_600_000), { edit: false, unsend: false }, "60:00");
  assert.deepEqual(messageControls(row({ mine: false }), sent), { edit: false, unsend: false });
  assert.deepEqual(messageControls(row({ unsent: true }), sent), { edit: false, unsend: false });
  assert.deepEqual(messageControls(row({ redacted: true }), sent), { edit: false, unsend: false });
  assert.deepEqual(messageControls(row({ kind: "profile-card" }), sent), { edit: false, unsend: true });
  assert.deepEqual(messageControls(row({ kind: undefined }), sent), { edit: true, unsend: true }, "a v48 row with no kind is text");
  assert.deepEqual(messageControls(null), { edit: false, unsend: false });
});

test("the counter appears 100 under the limit, counts clusters, and says over", () => {
  assert.deepEqual(composerCount("hello"), { count: 5, limit: 1000, show: false, over: false });
  assert.equal(composerCount("x".repeat(899)).show, false);
  assert.equal(composerCount("x".repeat(900)).show, true);
  assert.deepEqual(composerCount("x".repeat(1001)), { count: 1001, limit: 1000, show: true, over: true });
  assert.equal(composerCount("👩‍👩‍👧".repeat(950)).count, 950, "a family is one cluster to a person");
});

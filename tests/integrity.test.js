// tests/integrity.test.js — Request and write integrity: quota subjects ignore
// forgeable forwarding headers, only the declared trusted header is read, and
// concurrent first saves share one default board.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { requestSubject, verifiedRequestSubject } from "../lib/security/request.js";
import {
  addBoardItem, commitBoardSave, createBoard, getBoards, getInteractions,
  getProfile, listEvents, recordEvent, recordInteraction, saveProfile,
} from "../lib/db/index.js";
import {
  adoptAccountData, createTicket, transitionTicket, updateTicket,
} from "../lib/db/production.js";

const headerReq = (headers) => ({ headers: new Headers(headers), cookies: { get: () => null } });

test("public quota subjects ignore forgeable forwarding headers", () => {
  // Unconfigured is the default and must stay byte-for-byte today's behaviour:
  // Next.js does NOT sanitize x-forwarded-for (base-server does `??=`, which
  // PRESERVES a client value), so on localhost, next dev, tests, or any
  // non-Vercel host an IP header is fully attacker-controlled. A spoofable
  // subject is worse than a shared one — it means one identity per forged
  // header value.
  const request = headerReq({
    "cf-connecting-ip": "198.51.100.7",
    "x-forwarded-for": "203.0.113.9",
    "x-real-ip": "203.0.113.10",
    "x-vercel-forwarded-for": "203.0.113.11",
    "user-agent": "rotating-agent",
  });
  assert.equal(verifiedRequestSubject(request), null);
  assert.equal(requestSubject(request), "unverified-public");
});

test("a declared trusted header is read, and ONLY that header", () => {
  const prev = { h: process.env.TRUSTED_EDGE_IP_HEADER, s: process.env.RATE_LIMIT_SUBJECT_SALT };
  process.env.TRUSTED_EDGE_IP_HEADER = "x-vercel-forwarded-for";
  process.env.RATE_LIMIT_SUBJECT_SALT = "s".repeat(48);
  try {
    const a = requestSubject(headerReq({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "6.6.6.6" }));
    const b = requestSubject(headerReq({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "7.7.7.7" }));
    const c = requestSubject(headerReq({ "x-vercel-forwarded-for": "203.0.113.8" }));
    assert.equal(a, b, "a forged x-forwarded-for must not move the bucket");
    assert.notEqual(a, c, "a genuinely different edge IP must");
    assert.ok(a.startsWith("edge:") && !a.includes("203.0"), "the subject must not carry the address");

    // An IPv6 subscriber holds a whole /64 — keying on the full address would
    // hand one ordinary customer 2^64 subjects, i.e. unlimited minting with no
    // spoofing at all.
    const v6a = requestSubject(headerReq({ "x-vercel-forwarded-for": "2001:db8:1:2:aaaa::1" }));
    const v6b = requestSubject(headerReq({ "x-vercel-forwarded-for": "2001:db8:1:2:ffff::9" }));
    const v6c = requestSubject(headerReq({ "x-vercel-forwarded-for": "2001:db8:1:3::1" }));
    assert.equal(v6a, v6b, "one /64 is one subject");
    assert.notEqual(v6a, v6c, "a different /64 is a different subject");

    // No guessing on anomalies — that is how a spoofable value gets trusted.
    assert.equal(requestSubject(headerReq({ "x-vercel-forwarded-for": "1.2.3.4, 5.6.7.8" })), "unverified-public");
    assert.equal(requestSubject(headerReq({ "x-vercel-forwarded-for": "not-an-ip" })), "unverified-public");

    // An unsalted digest of an IPv4 address is not anonymization: the whole
    // 2^32 space is minutes of laptop time.
    process.env.RATE_LIMIT_SUBJECT_SALT = "tooshort";
    assert.equal(requestSubject(headerReq({ "x-vercel-forwarded-for": "203.0.113.7" })), "unverified-public");
  } finally {
    if (prev.h === undefined) delete process.env.TRUSTED_EDGE_IP_HEADER; else process.env.TRUSTED_EDGE_IP_HEADER = prev.h;
    if (prev.s === undefined) delete process.env.RATE_LIMIT_SUBJECT_SALT; else process.env.RATE_LIMIT_SUBJECT_SALT = prev.s;
  }
});

test("concurrent first saves share one default board", async () => {
  const userId = `u-${randomUUID()}`;
  const items = [
    { id: `a-${randomUUID()}`, title: "A", tags: { MINIMAL: 0.8 } },
    { id: `b-${randomUUID()}`, title: "B", tags: { TAILORED: 0.8 } },
  ];
  await Promise.all(items.map((item) => commitBoardSave({
    userId, item,
    canonicalEvent: (boardId) => ({
      userId, type: "USER_ADDED_TO_MOOD_BOARD", payload: { boardId, itemId: item.id },
    }),
    reduce(profile) { return { profile, edgePairs: [], popularity: [] }; },
  })));
  const boards = await getBoards(userId);
  assert.equal(boards.length, 1);
  assert.equal(boards[0].isDefault, true);
  assert.deepEqual(new Set(boards[0].items.map((item) => item.id)), new Set(items.map((item) => item.id)));
});

test("ticket transitions cannot revive or rewrite a terminal flow", async () => {
  const userId = `u-${randomUUID()}`;
  const ticket = await createTicket({
    userId, productId: `item-${randomUUID()}`, sourceName: "ebay",
    sourceProductUrl: "https://www.ebay.com/itm/123", idempotencyKey: randomUUID(),
  });
  await updateTicket(ticket.id, { status: "awaiting_user_consent" });
  const consented = await transitionTicket(ticket.id, userId, "consent", {
    disclaimerVersion: "server-version",
  });
  assert.equal(consented.status, "checkout_started");
  assert.equal(consented.disclaimerVersion, "server-version");
  assert.equal(await transitionTicket(ticket.id, userId, "consent", {
    disclaimerVersion: "forged-version",
  }), null);
  assert.equal(await transitionTicket(ticket.id, userId, "cancel"), null);
});

test("account adoption moves boards, merges taste, and accepts later device data", async () => {
  const from = `u-${randomUUID()}`;
  const to = `sb-${randomUUID()}`;
  const item = { id: `item-${randomUUID()}`, title: "Saved", tags: { MINIMAL: 1 } };
  await saveProfile(from, { long: { MINIMAL: 0.8 }, session: {}, _meta: {} });
  await saveProfile(to, { long: { TAILORED: 0.6 }, session: {}, _meta: {} });
  const sourceBoard = await createBoard(from, "device board");
  await addBoardItem(sourceBoard.id, item);
  await createBoard(to, "account board");
  await recordInteraction(from, item.id, "favorite");
  await recordEvent({ userId: from, type: "USER_FAVORITED_ITEM", payload: { itemId: item.id } });

  const [first, retry] = await Promise.all([adoptAccountData(from, to), adoptAccountData(from, to)]);
  assert.equal([first, retry].filter((result) => result.duplicate).length, 1);
  assert.equal((await getBoards(from)).length, 0);
  const targetBoards = await getBoards(to);
  assert.equal(targetBoards.length, 2);
  assert.equal(targetBoards.filter((board) => board.isDefault).length, 1);
  const merged = await getProfile(to);
  assert.ok(merged.long.MINIMAL > 0);
  assert.ok(merged.long.TAILORED > 0);
  assert.equal((await getInteractions(from)).length, 0);
  assert.equal((await getInteractions(to)).length, 1);
  assert.equal((await listEvents(from)).length, 0);
  assert.equal((await listEvents(to)).length, 1);

  await saveProfile(from, { long: { GORP: 0.7 }, session: {}, _meta: {} });
  await createBoard(from, "later device board");
  const later = await adoptAccountData(from, to);
  assert.equal(later.duplicate, false);
  assert.equal(later.movedBoards, 1);
  assert.equal((await getBoards(to)).length, 3);
  assert.ok((await getProfile(to)).long.GORP > 0);
});

test("one device cannot be adopted into two accounts concurrently", async () => {
  const from = `u-${randomUUID()}`;
  const targets = [`sb-${randomUUID()}`, `sb-${randomUUID()}`];
  await saveProfile(from, { long: { MINIMAL: 0.9 }, session: {}, _meta: {} });
  await createBoard(from, "single-owner board");

  const results = await Promise.all(targets.map((target) => adoptAccountData(from, target)));
  assert.equal(results.reduce((sum, result) => sum + result.movedBoards, 0), 1);
  assert.equal((await getBoards(from)).length, 0);
  assert.equal(
    (await Promise.all(targets.map((target) => getBoards(target))))
      .reduce((sum, boards) => sum + boards.length, 0),
    1
  );
  const copiedProfiles = await Promise.all(targets.map((target) => getProfile(target)));
  assert.equal(copiedProfiles.filter((profile) => profile.long?.MINIMAL === 0.9).length, 1);
});

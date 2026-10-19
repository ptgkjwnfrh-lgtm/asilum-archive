// tests/wardrobe-gifts.test.js — gifting (V.2 brief §8), memory mode. The
// laws: the recipient must accept; acceptance moves the ACTIVE card and
// records an event; decline, cancel and expiry leave ownership untouched; one
// open offer per card; a retried offer is the same offer; the sender keeps a
// receipt; both parties see the disclaimer. The concurrency law (two accepts,
// one winner) is proven against Postgres in tests/postgres-integration.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { TRANSFER_DISCLAIMER, giftExpired, giftExpiry, giftTransition, provenanceLabel } from "../lib/wardrobe/gifts.js";
import {
  GiftRefused, acceptGift, cancelGift, declineGift, expireGifts, listGifts, offerGift, resolveGiftRecipient, resetMemoryTransfers,
} from "../lib/db/production/wardrobeTransfers.js";
import { addWardrobeItem } from "../lib/wardrobe/index.js";
import { listWardrobeItems, upsertProfileRoom, setWardrobeItemStatus } from "../lib/db/production.js";
import { listNotifications, resetMemoryListingStatus } from "../lib/db/production/listingStatus.js";
import { mem } from "../lib/db/production/store.js";

const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", C_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const A = "sb-" + A_ID, B = "sb-" + B_ID, C = "sb-" + C_ID;

test.beforeEach(async () => {
  resetMemoryTransfers(); resetMemoryListingStatus();
  mem.wardrobe = []; mem.profileRooms = new Map();
  await upsertProfileRoom(A_ID, { handle: "alice-a", published: true });
  await upsertProfileRoom(B_ID, { handle: "bob-b", published: true });
  await upsertProfileRoom(C_ID, { handle: "carol-c", published: false });
});

test("the state machine: only pending moves, and only by the right party", () => {
  assert.equal(giftTransition("pending", "accept", "recipient"), "accepted");
  assert.equal(giftTransition("pending", "accept", "sender"), null, "a sender cannot accept their own gift");
  assert.equal(giftTransition("pending", "decline", "recipient"), "declined");
  assert.equal(giftTransition("pending", "cancel", "sender"), "cancelled");
  assert.equal(giftTransition("pending", "cancel", "recipient"), null);
  assert.equal(giftTransition("pending", "expire", "clock"), "expired");
  for (const s of ["accepted", "declined", "cancelled", "expired"]) assert.equal(giftTransition(s, "accept", "recipient"), null, s + " is final");
  assert.equal(giftExpired(giftExpiry(0), 14 * 86_400_000), true);
  assert.equal(giftExpired(giftExpiry(0), 14 * 86_400_000 - 1), false);
  assert.equal(TRANSFER_DISCLAIMER, "Digital wardrobe transfer. Physical delivery is not verified by ASILUM.");
  assert.equal(provenanceLabel({ provenance: "transferred", transferredFromHandle: "alice-a" }), "digitally transferred from alice-a");
  assert.equal(provenanceLabel({ source: "ticket" }), "from a purchase record");
});

test("a recipient is a published passenger named by handle, never yourself, never an unpublished room", async () => {
  assert.deepEqual(await resolveGiftRecipient(A, "*BOB-B"), { handle: "bob-b", accountId: B_ID, toUserId: B });
  assert.equal(await resolveGiftRecipient(A, "alice-a"), null, "not to yourself");
  assert.equal(await resolveGiftRecipient(A, "carol-c"), null, "unpublished");
  assert.equal(await resolveGiftRecipient(A, "nobody-here"), null);
  assert.equal(await resolveGiftRecipient(A, "x"), null);
});

test("offer → accept moves the active card atomically, records the event, keeps the sender's receipt, tells both", async () => {
  const added = await addWardrobeItem(A, { source: "manual", title: "black double-rider", brand: "Schott", category: "outerwear" });
  const item = added.item;
  await assert.rejects(() => offerGift(A, { itemId: item.id, toHandle: "nobody" }), (e) => e instanceof GiftRefused && e.code === "no-recipient");
  await assert.rejects(() => offerGift(B, { itemId: item.id, toHandle: "alice-a" }), (e) => e.code === "no-such-piece", "not the sender's card");
  const offer = await offerGift(A, { itemId: item.id, toHandle: "bob-b", note: "for you", idempotencyKey: "key-0001-abc" });
  assert.equal(offer.state, "pending"); assert.equal(offer.toHandle, "bob-b"); assert.equal(offer.fromHandle, "alice-a");
  assert.equal(offer.disclaimer, TRANSFER_DISCLAIMER); assert.equal(offer.item.title, "black double-rider");
  // a retried offer is the same offer; a second open offer of the same card is refused
  const again = await offerGift(A, { itemId: item.id, toHandle: "bob-b", idempotencyKey: "key-0001-abc" });
  assert.equal(again.id, offer.id); assert.equal(again.duplicate, true);
  await assert.rejects(() => offerGift(A, { itemId: item.id, toHandle: "bob-b" }), (e) => e.code === "already-offered", "the pending-transfer lock");
  // nothing has moved
  assert.equal((await listWardrobeItems(A)).length, 1); assert.equal((await listWardrobeItems(B)).length, 0);
  const bobsList = await listGifts(B);
  assert.equal(bobsList.incoming.length, 1); assert.equal(bobsList.incoming[0].id, offer.id);
  assert.equal((await listNotifications(B)).filter((n) => n.kind === "wardrobe-gift").length, 1, "the recipient is told");
  // the wrong party cannot accept; the sender cannot accept their own
  assert.deepEqual(await acceptGift(C, offer.id), { ok: false, reason: "not-pending" });
  assert.deepEqual(await acceptGift(A, offer.id), { ok: false, reason: "not-pending" });
  // accept
  const r = await acceptGift(B, offer.id);
  assert.equal(r.ok, true); assert.equal(r.transfer.state, "accepted");
  assert.equal((await listWardrobeItems(A)).length, 0, "the sender lost the card");
  const bobs = await listWardrobeItems(B);
  assert.equal(bobs.length, 1); assert.equal(bobs[0].title, "black double-rider"); assert.equal(bobs[0].provenance, "transferred"); assert.equal(bobs[0].transferredFrom, A); assert.equal(bobs[0].transferId, offer.id);
  assert.equal(mem.transferEvents.filter((e) => e.transfer_id === Number(offer.id)).map((e) => e.event).join(","), "offered,accepted");
  const alices = await listGifts(A);
  assert.equal(alices.given.length, 1); assert.equal(alices.given[0].item.title, "black double-rider", "the sender's receipt survives on the transfer");
  assert.equal((await listGifts(B)).received.length, 1);
  // final: a second accept, a decline, a cancel all answer not-pending and move nothing
  assert.deepEqual(await acceptGift(B, offer.id), { ok: false, reason: "not-pending" });
  assert.deepEqual(await declineGift(B, offer.id), { ok: false, reason: "not-pending" });
  assert.deepEqual(await cancelGift(A, offer.id), { ok: false, reason: "not-pending" });
  assert.equal((await listWardrobeItems(B)).length, 1);
});

test("decline, cancel, expiry and a vanished card leave ownership exactly where it was", async () => {
  const one = (await addWardrobeItem(A, { source: "manual", title: "one" })).item;
  const two = (await addWardrobeItem(A, { source: "manual", title: "two" })).item;
  const three = (await addWardrobeItem(A, { source: "manual", title: "three" })).item;
  const four = (await addWardrobeItem(A, { source: "manual", title: "four" })).item;
  const o1 = await offerGift(A, { itemId: one.id, toHandle: "bob-b" });
  const o2 = await offerGift(A, { itemId: two.id, toHandle: "bob-b" });
  const o3 = await offerGift(A, { itemId: three.id, toHandle: "bob-b" });
  const o4 = await offerGift(A, { itemId: four.id, toHandle: "bob-b" });
  assert.equal((await declineGift(B, o1.id)).transfer.state, "declined");
  assert.equal((await cancelGift(A, o2.id)).transfer.state, "cancelled");
  assert.deepEqual(await cancelGift(B, o3.id), { ok: false, reason: "not-pending" }, "the recipient cannot cancel");
  // expiry by the clock
  mem.transfers.find((t) => t.id === Number(o3.id)).expires_at = new Date(Date.now() - 1000);
  assert.deepEqual(await acceptGift(B, o3.id), { ok: false, reason: "expired" });
  assert.equal(await expireGifts(), 0, "already stamped on the accept");
  // the sender retired the card before the accept: the offer dies, nothing moves
  await setWardrobeItemStatus(A, four.id, "retired");
  assert.deepEqual(await acceptGift(B, o4.id), { ok: false, reason: "piece-gone" });
  assert.equal((await listWardrobeItems(A, { status: "all" })).length, 4, "alice still owns all four");
  assert.equal((await listWardrobeItems(B)).length, 0);
  const l = await listGifts(A);
  assert.equal(l.outgoing.length, 0); assert.equal(l.given.length, 0);
  // a decided card can be offered again
  const again = await offerGift(A, { itemId: one.id, toHandle: "bob-b" });
  assert.equal(again.state, "pending");
  // the sweep stamps a pending offer past its date
  mem.transfers.find((t) => t.id === Number(again.id)).expires_at = new Date(Date.now() - 1);
  assert.equal(await expireGifts(), 1);
});

// tests/connectors.test.js — the connector registry (V.2 brief §11): explicit
// per-capability states, the uses a connection never grants, no fake
// "connected", and the eBay split (Browse ≠ purchase history ≠ everything).
import test from "node:test";
import assert from "node:assert/strict";
import { CONNECTORS, CONNECTOR_STATES, capabilityState, connectSentence, connectorRegistry, connectorStatus } from "../lib/connectors/index.js";

const ENV = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_PARTNERSHIP_APPROVED", "SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"];
function withEnv(patch, fn) {
  const was = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  try { for (const k of ENV) delete process.env[k]; Object.assign(process.env, patch); return fn(); }
  finally { for (const k of ENV) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; } }
}

test("every capability reports one of the six states, and nothing is ever 'connected'", () => {
  const reg = withEnv({}, () => connectorRegistry());
  assert.ok(reg.length >= 5);
  for (const c of reg) for (const cap of c.capabilities) assert.ok(CONNECTOR_STATES.includes(cap.state), `${c.id}.${cap.id} = ${cap.state}`);
  // the music seams (slice 13) carry a per-connector `connected` FLAG, false with nothing stored;
  // no capability ever reports a STATE of "connected" — a stored connection reads "available"
  for (const c of reg) assert.equal(c.connected, false, `${c.id} connected with nothing stored`);
  for (const c of reg) for (const cap of c.capabilities) assert.notEqual(cap.state, "connected");
});

test("Spotify: manual artist stamps are available, profiling is unsupported, display needs approval", () => {
  const sp = withEnv({}, () => connectorRegistry()).find((c) => c.id === "spotify");
  const by = Object.fromEntries(sp.capabilities.map((c) => [c.id, c.state]));
  // slice 9 adds playback and catalog-search (4.13–4.14), both behind the same approved app
  assert.deepEqual(by, { "artist-stamps": "available", "display-link": "requires-approval", playback: "requires-approval", "catalog-search": "requires-approval", "taste-import": "unsupported" });
  const am = withEnv({}, () => connectorRegistry()).find((c) => c.id === "apple-music");
  assert.ok(am && am.capabilities.every((c) => c.state === "requires-approval"), "Apple Music: unexamined terms, nothing offered");
  assert.match(am.basis, /NOT YET EXAMINED/);
  assert.ok(sp.never.some((n) => /profiling/.test(n)));
  assert.match(sp.capabilities.find((c) => c.id === "artist-stamps").basis, /no Spotify data/);
});

test("eBay: Browse follows the keys AND the partnership; purchase history is a separate approval; everything is unsupported", () => {
  assert.equal(withEnv({}, () => capabilityState("ebay", "browse")), "requires-approval");
  assert.equal(withEnv({ EBAY_CLIENT_ID: "x", EBAY_CLIENT_SECRET: "y" }, () => capabilityState("ebay", "browse")), "requires-approval", "keys without the partnership");
  assert.equal(withEnv({ EBAY_CLIENT_ID: "x", EBAY_CLIENT_SECRET: "y", EBAY_PARTNERSHIP_APPROVED: "1" }, () => capabilityState("ebay", "browse")), "available");
  assert.equal(withEnv({ EBAY_CLIENT_ID: "x", EBAY_CLIENT_SECRET: "y", EBAY_PARTNERSHIP_APPROVED: "1" }, () => capabilityState("ebay", "browse", { account: "sb-x" })), "disconnected", "an account is a separate fact; no OAuth flow exists");
  assert.equal(capabilityState("ebay", "purchase-history"), "requires-approval");
  assert.equal(capabilityState("ebay", "all-historical-purchases"), "unsupported");
  assert.equal(capabilityState("ebay", "nope"), "unsupported");
  assert.match(connectSentence("ebay", "all-historical-purchases", "unsupported"), /unsupported/);
  assert.match(connectSentence("ebay", "browse", "disconnected"), /no flow exists/);
});

test("TikTok and Pinterest never promise what their APIs do not expose; the admin status reader still works", () => {
  assert.equal(capabilityState("tiktok", "liked-history"), "unsupported");
  assert.equal(capabilityState("tiktok", "dm-import"), "unsupported");
  assert.equal(capabilityState("pinterest", "browsing-history"), "unsupported");
  assert.equal(capabilityState("pinterest", "board-import"), "requires-approval");
  const st = connectorStatus();
  assert.ok(st.find((s) => s.id === "ebay") && "configured" in st[0] && "note" in st[0]);
  assert.ok(Object.keys(CONNECTORS).includes("letterboxd"));
});

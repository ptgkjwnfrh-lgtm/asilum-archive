// tests/wardrobe-hardening.test.js — Wardrobe hardening: pieces a passenger
// already owns never become purchase intent.

import test from "node:test";
import assert from "node:assert/strict";
import { purchasableLookItems } from "../lib/wardrobe/purchase.js";

test("owned wardrobe anchors never become purchase intent", () => {
  const owned = { id: "wardrobe:1", title: "Mine", owned: true, price: 0 };
  const listing = { id: "catalog:1", title: "For sale", price: 125 };
  assert.deepEqual(purchasableLookItems([owned, listing]), [listing]);
  assert.deepEqual(purchasableLookItems([owned]), []);
  assert.deepEqual(purchasableLookItems(null), []);
});

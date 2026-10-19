// tests/storefront-shell.test.js — the native Storefront inside the V.2
// shell (the native-storefront branch landed on v2/build, slice 6). The branch
// wrote its checkout into the shell's bag panel and the feed page's modal;
// slices 1–3 retired both. On V.2 the bag is a popup (BagSheet), the piece
// is the LISTING popup (ListingSheet), and ONE client opens native checkout
// for every surface (lib/storefront/client.js). Source reads.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("Storefront adds no deck key and no fixture; a fresh launch stays on the Feed; /store is ACCOUNT's room", () => {
  const nav = read("lib/nav.js");
  const shell = read("app/shell.js");
  assert.doesNotMatch(nav, /label:\s*["']STOREFRONT/);
  assert.doesNotMatch(shell, /router\.replace\(["']\/cover/);
  assert.match(nav, /p\.startsWith\("\/store"\)/, "a public storefront route lights the ACCOUNT key");
});

test("one client opens native checkout: the bag popup, the listing popup and Discover all use it; no surface carries its own copy", () => {
  const client = strip(read("lib/storefront/client.js"));
  assert.match(client, /postJSON\("\/api\/checkout"/);
  assert.match(client, /body\.commerceRail !== NATIVE_RAIL/);
  assert.match(client, /target\.hostname !== "checkout\.stripe\.com"/);
  assert.match(client, /item\.native_checkout_ready !== true/);
  for (const file of ["app/components/BagSheet.jsx", "app/components/ListingSheet.jsx", "app/discover/page.js"]) {
    const src = strip(read(file));
    assert.match(src, /startNativeCheckout\(/, file + " uses the one client");
    assert.ok(!/postJSON\("\/api\/checkout"/.test(src), file + " carries no second copy of the checkout call");
    assert.ok(!/checkout\.stripe\.com/.test(src), file + " does not re-check the provider host itself");
  }
  assert.ok(!/commerce_rail === "native_storefront"/.test(strip(read("app/page.js"))), "the Feed page has no native branch of its own: a piece opens the LISTING popup");
});

test("the bag popup: a native line carries units and CHECK OUT THIS SELLER; the gate is visible; the legacy fee rail is refused server-side", () => {
  const bag = strip(read("app/components/BagSheet.jsx"));
  assert.match(bag, /bagSetQuantity\(keyOf\(x\), \(x\.quantity \|\| 1\) \+ 1\)/);
  assert.match(bag, /CHECK OUT THIS SELLER/);
  assert.match(bag, /CHECKOUT NOT ENABLED/);
  assert.match(bag, /ASILUM passenger fee before payment/);
  assert.match(bag, /Adding to the Bag reserves nothing; checkout does/, "7.6: the Bag reserves nothing");
  assert.match(bag, /DISPLAY SUBTOTAL/, "a display snapshot, never payment authority");
  const ticketRoute = read("app/api/ticket-fee/route.js");
  assert.match(ticketRoute, /item\.commerce_rail === "native_storefront"/);
  assert.match(ticketRoute, /native Storefront items require native checkout/);
  const css = read("app/globals.css");
  assert.match(css, /\.bagsheet \.bagqty button:focus-visible/);
  assert.ok(!/\.bagpanel/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "the retired panel's selector stays gone");
});

test("the listing popup: a native listing buys here and never shows the referral ticket; readiness is the server's stamp", () => {
  const listing = strip(read("app/components/ListingSheet.jsx"));
  assert.match(listing, /isNativeItem\(item\) \? \(/);
  assert.match(listing, /item\.native_checkout_ready === true \? \(buying \? "opening checkout…" : "buy ↗"\) : "checkout not enabled"/);
  // (18 Oct) the button carries its warning light and opens the ticket a beat after the light blinks
  assert.match(listing, /\) : \(\s*<>\s*<button type="button" className="buy" onClick=\{\(e\) => \{ blinkLamp\(e\); setTimeout\(\(\) => setTicket\(true\), 420\); \}\}><Lamp \/>request purchase<\/button>/, "external records keep the ticket flow");
});

// tests/storefront-ui.test.js — the Storefront's owner and public surfaces
// on V.2 (codex/native-storefront landed on v2/build, slice 6). Source reads
// where a .jsx cannot be imported under node's test runner.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentDestination, navFor } from "../lib/nav.js";
import { STOREFRONT_CATEGORIES, STOREFRONT_TERMS_VERSION } from "../lib/storefront/contracts.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Profile owns exactly one Storefront subtab and its hash opens it", () => {
  const profile = read("../app/profile/page.js");
  assert.match(profile, /import StorefrontTab from ["']\.\.\/components\/StorefrontTab\.jsx["']/);
  assert.equal((profile.match(/\["storefront", "STOREFRONT"\]/g) || []).length, 1);
  assert.match(profile, /window\.location\.hash === "#storefront"/);
  assert.match(profile, /tab === "storefront" && <StorefrontTab \/>/);
});

test("Storefront stays inside the V.2 shell: no key of its own; a public store lights ACCOUNT (ANALYTICS for a business)", () => {
  const labels = navFor("passport").map((entry) => entry.label);
  assert.ok(!labels.includes("STOREFRONT"), labels.join(","));
  assert.equal(currentDestination("passport", "/store/night-objects")?.label, "ACCOUNT");
  assert.equal(currentDestination("business", "/store/night-objects")?.label, "ANALYTICS");
});

test("owner UI uses the authenticated storefront contract and honest capabilities", () => {
  const source = read("../app/components/StorefrontTab.jsx");
  assert.match(source, /authorizedFetch\(`\/api\/storefront\?user=/);
  assert.match(source, /sendJSON\("POST", "\/api\/storefront", \{ user, \.\.\.payload \}\)/);
  for (const action of ["create_store", "update_store", "create_listing", "update_listing", "archive_listing"]) {
    assert.match(source, new RegExp(`"${action}"`));
  }
  assert.match(source, /acceptedTermsVersion: termsVersion, accepted: true/);
  assert.match(source, /import \{ STOREFRONT_CATEGORIES, STOREFRONT_TERMS_VERSION \} from/);
  assert.equal(STOREFRONT_TERMS_VERSION, "storefront-terms-v1-2026-10-02");
  assert.match(source, /capabilities\.canReceiveOrders === true/);
  assert.match(source, /TEST CHECKOUT ONLY/);
  assert.match(source, /ORDER INTAKE OFF/);
  assert.match(source, /Reservations are not collected money/);
  assert.match(source, /feeEntries = Array\.isArray\(raw\.feeEvents\)/);
  assert.match(source, /nothing is charged to create the draft/);
  assert.match(source, /REQUEST REVIEW/);
  assert.match(source, /nextStatus = status === "active" \? "paused" : "pending_review"/);
  assert.match(source, /createOperationKey = useRef/);
  assert.match(source, /operationKey: createOperationKey\.current/);
  assert.match(source, /setCreateEpoch\(\(value\) => value \+ 1\)/);
  assert.ok(!source.includes("AS" + "iLUM"), "the name is *ASILUM");
});

test("native listings cover every approved category and reuse shared item depth", () => {
  const source = read("../app/components/StorefrontTab.jsx");
  assert.deepEqual(STOREFRONT_CATEGORIES.map(({ id }) => id), [
    "clothing", "jewelry", "posters_prints", "furniture",
    "electronics_tech", "ornaments_home", "other",
  ]);
  assert.match(source, /return String\(listing\?\.itemId \|\| listing\?\.item_id \|\| listing\?\.id/);
  assert.match(source, /href=\{`\/\?item=\$\{encodeURIComponent\(id\)\}`\}/);
  assert.match(source, /\/api\/storefront\/public\?slug=/);
  const page = read("../app/store/[slug]/page.js");
  assert.match(page, /<PublicStorefront slug=/);
  assert.match(page, /href="\/profile#storefront"/);
});

test("public storefront reuses Passport social, messaging, sharing, and reporting", () => {
  const storefront = read("../app/components/StorefrontTab.jsx");
  const mail = read("../app/components/MailDesk.jsx");
  assert.match(storefront, /<FollowButton handle=\{handle\} \/>/);
  assert.match(storefront, /href=\{`\/u\/\$\{encodeURIComponent\(handle\)\}`\}/);
  assert.match(storefront, /new CustomEvent\("asilum:dm-open", \{ detail: \{ handle \} \}\)/);
  assert.match(storefront, /navigator\.share/);
  assert.match(storefront, /op: "report", handle/);
  assert.match(mail, /window\.addEventListener\("asilum:dm-open", openToHandle\)/);
  assert.match(mail, /window\.removeEventListener\("asilum:dm-open", openToHandle\)/);
});

test("storefront and bag quantity controls have scoped visible focus", () => {
  const css = read("../app/globals.css");
  assert.match(css, /\.sfroot :is\(a, button, input, textarea, select\):focus-visible/);
  assert.match(css, /\.bagsheet \.bagqty button:focus-visible/);
  assert.match(css, /\.bagsheet \.bagqty span/);
});

test("the accepted Storefront terms state the free draft and both fee boundaries, under the ruled name", () => {
  const component = read("../app/components/StorefrontTab.jsx");
  const terms = read("../app/terms/page.js");
  assert.match(component, /href="\/terms#storefront-terms"/);
  assert.match(terms, /id="storefront-terms"/);
  assert.match(terms, /without a creation charge, subscription, tier, separate/);
  assert.match(terms, /\$1 per item or unit plus/);
  assert.match(terms, /one-time \$30 Storefront fee is collected only from available seller/);
  assert.match(terms, /does not enable payment acceptance/);
  assert.ok(!terms.includes("AS" + "iLUM") && !/ASILUM magazine/.test(terms), "the name is *ASILUM, never 'ASILUM magazine'");
});

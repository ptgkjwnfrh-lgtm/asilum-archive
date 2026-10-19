// tests/v2-feed.test.js — V.2 SLICE 3: THE ONE FEED, as the components wire
// the law in lib/feed/types.js (owner's blueprint, 17 Oct 2026). Source
// reads where a .jsx cannot be imported under node's test runner; the pure
// law is tests/feed-types.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { validateComposition, attachmentsFor, ECHO_TTL_MS, ECHO_MIN_MS } from "../lib/posts/compose.js";
import { captionInk } from "../lib/feed/caption.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const page = strip(read("app/page.js"));
const card = strip(read("app/components/PostCard.jsx"));
const listing = strip(read("app/components/ListingSheet.jsx"));
const media = strip(read("app/components/MediaFloat.jsx"));
const echo = strip(read("app/components/EchoRail.jsx"));
const place = strip(read("app/components/PlaceCard.jsx"));
const host = strip(read("app/components/SheetHost.jsx"));
const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("there is no Wire: the selector, the lanes, the in-page composer and the hotlist rail are gone", () => {
  assert.ok(!/view=wire|THE WIRE|streamlanes|PostComposer|HotlistStrip|streamrail/.test(page));
  assert.ok(!existsSync(new URL("../app/components/HotlistStrip.jsx", import.meta.url)), "the rail component is deleted");
  for (const sel of [".feedview", ".streamlanes", ".streamrail", ".hotstrip", ".whot", ".modal.lg", ".mscroll", ".mimg", ".mbody"]) {
    assert.ok(!css.includes("\n" + sel + " ") && !css.includes("\n" + sel + "{") && !css.includes("\n" + sel + "."), sel + " has no rule left");
  }
});

test("the stream is Tetris-packed and wheels: packFeed drives the segments, a full card breaks the columns", () => {
  assert.match(page, /const segs = packFeed\(feedList\(list\)\);/);
  assert.match(page, /seg\.kind === "grid"\s*\?\s*<Columns/);
  assert.match(page, /className=\{seg\.kind === "full" \? "feedfull" : "feedstrip"\}/);
  assert.match(css, /\.feedwheel > \* \+ \* \{ margin-top: -6px; \}/, "slight overlap");
});

test("every card wears its type; media enlarges over the Feed; a piece opens the LISTING popup", () => {
  assert.match(card, /const type = postType\(p\);/);
  assert.match(card, /data-type=\{type\}/);
  assert.match(card, /openSheet\("media", sample \? \{ id: p\.id, sample: true, title: type \} : \{ id: p\.serverId, title: type \}\)/);
  assert.match(card, /openSheet\("listing", \{ id: pc\.id, title: "LISTING" \}\)/, "a tagged piece opens its listing");
  assert.match(page, /openSheet\("listing", \{ item, title: "LISTING" \}\)/);
  assert.match(host, /listing: \{ title: "LISTING", render: \(p\) => <ListingSheet/);
  assert.match(host, /media: \{ title: "STILL", render: \(p\) => <MediaFloat.*tall: true/);
  assert.match(host, /echo: \{ title: "ECHO", render: \(p\) => <EchoViewer.*tall: true/);
});

test("the LISTING popup: carousel, LIKE, OFFER (soon), bag, sizes, price, three tags and BEHIND THE PRODUCT", () => {
  assert.match(listing, /visibleTags\(tagsFor\(item, \{ typed, state: \{ verification: /, "the three come from the grammar (slice 4)");
  assert.match(listing, /className="lstdots"/, "the photo carousel's dots");
  // slice 14 (reference 5.jpg): OFFER is real on a native listing and a Wardrobe piece that takes offers; elsewhere the word is quiet, never a dead button
  assert.match(listing, /const offerable = offerMode\(item\);/, "the popup asks the one law what OFFER does");
  assert.match(listing, /<span className="lstofferword quiet" title=\{offerable\.reason\}/, "a quiet OFFER is a label with its reason");
  assert.ok(!/OFFER<\/button>[^\n]*disabled|disabled[^\n]*>OFFER</.test(listing), "never a disabled OFFER button");
  assert.match(listing, /openSheet\("messages", \{ title: "MESSAGES" \}\)/, "a Wardrobe OFFER starts with a message (13.4)");
  assert.match(listing, /postJSON\("\/api\/storefront\/offers"/, "a native OFFER is sent");
  assert.match(listing, /BEHIND THE PRODUCT/);
  assert.match(listing, /<AsteriskWhy item=\{item\} onNotice=\{setNotice\} \/>/, "the depth moved with the modal");
  assert.match(listing, /<TicketFlow item=\{item\}/, "the purchase request is the real ticket flow");
  assert.match(listing, /demo \? <span className="demoflag">\{DEMO_NOTE\}<\/span>/, "a demo record has no purchase control");
  assert.ok(!/fetch\("\/api\/interaction"/.test(listing), "actions go through lib/feed/actions.js");
});

test("STILL and MOTION enlarged: the caption stays on the media, moves up, and its ink follows the light", () => {
  assert.match(media, /className=\{"mfcaption" \+ \(up \? " up" : ""\)\}/);
  assert.match(media, /setInk\(captionInk\(/);
  assert.match(media, /className="soon" disabled title="comments are not built yet"/, "COMMENT says soon");
  assert.ok(!/audio/.test(media.replace(/aria-label="[^"]*"/g, "")) || /audio exists/.test(read("app/components/MediaFloat.jsx")), "no audio button without audio");
  assert.equal(captionInk(0.9), "black"); assert.equal(captionInk(0.5), "gray"); assert.equal(captionInk(0.1), "white"); assert.equal(captionInk(NaN), "white");
});

test("ECHO: 24 hours, stored on the row, filtered when expired, viewed sequentially with tap and hold", () => {
  assert.equal(ECHO_TTL_MS, 86_400_000); assert.equal(ECHO_MIN_MS, 3_600_000);
  const v = validateComposition({ text: "hi", echo: true });
  assert.equal(v.ok, true); assert.equal(v.echo, true);
  assert.equal(validateComposition({ text: "hi", echo: true, echoMs: 10 }).ok, false, "a life under an hour is refused");
  assert.equal(validateComposition({ text: "hi", echo: true, echoMs: ECHO_TTL_MS * 2 }).ok, false, "a life over a day is refused");
  const a = attachmentsFor({ text: "hi", echo: true }, { now: 1000 });
  assert.deepEqual(a.echo, { expiresAt: 1000 + ECHO_TTL_MS });
  assert.ok(!("echo" in attachmentsFor({ text: "hi" }, { now: 1000 })), "no mark without the flag");
  const route = strip(read("app/api/editorial/route.js"));
  assert.match(route, /\.filter\(\(post\) => !\(post\.attachments && post\.attachments\.echo\) \|\| Number\(post\.attachments\.echo\.expiresAt\) > now\)/, "an expired echo is never served");
  assert.match(echo, /export const ECHO_STEP_MS = 5000;/);
  assert.match(echo, /onPointerDown=\{\(\) => hold\(true\)\}/, "hold pauses");
  assert.match(echo, /\.filter\(\(p\) => echoLive\(p\)\)/, "the viewer shows live echoes only");
  const composer = strip(read("app/components/PostComposer.jsx"));
  assert.match(composer, /echo: !!c\.echo/, "the composer sends the mark");
  const sel = strip(read("app/components/PostSelection.jsx"));
  assert.ok(!/echo:/.test(sel.split("const SOON")[1].split("};")[0]), "ECHO is no longer soon");
});

test("PLACE: the reference's card (venue mark, distance, name, globe) opens the map popup; a rating only from a real source", () => {
  assert.match(place, /openSheet\("map", \{ pin: p\.id, title: "MAP" \}\)/, "the card opens the map popup, never a page");
  assert.match(place, /<Icon name="venue"/); assert.match(place, /<Icon name="globe"/);
  assert.match(place, /discoveryCenter\(\)/, "the distance only from this device's own centre");
  assert.ok(!/rating|stars/.test(place), "the card draws no rating");
  const map = strip(read("app/components/MapSheet.jsx"));
  assert.match(map, /const rating = placeRating\(place\);/, "the popup asks the registry whether a sourced rating exists");
  assert.match(map, /\{rating \? \(/, "and draws one only when it does");
  assert.ok(!/4\.6|24K/.test(map), "never the reference's placeholder figure");
  assert.match(map, /className="mapspill" href=\{maps\} target="_blank" rel="noopener noreferrer">MAPS ↗/);
  assert.match(page, /fetch\("\/api\/places"\)/);
});

test("the post card to the reference: media fills the card, handle and caption over it, four outline actions, the BRDCST footer as drawn", () => {
  assert.match(card, /className="wpcover"/, "handle and caption sit over the media");
  for (const g of ["heart", "comment", "share"]) assert.match(card, new RegExp('<Icon name="' + g + '"'), g);
  assert.match(card, /icon="hourglass"/, "the hourglass is STAMP, the one save");
  assert.match(card, /className="wpcact soon" title="comments are not built yet"/, "the bubble says soon");
  assert.match(card, /<b className="brdcstword">BRDCST/);
  assert.match(card, /<span className="brdcstrule" aria-hidden="true" \/>/);
  assert.match(card, /<i className="brdcstast" aria-hidden="true">\*<\/i>\{first\.name\}/, "*event under the rule");
  assert.match(card, /<Icon name="chevron"/);
  assert.match(card, /brdcstWhen\(first\)/, "the date and time from the one law");
  assert.match(css, /\.wpcover \{[^}]*position: absolute;/);
  assert.match(css, /\.card\.wpostcard \{[^}]*border-radius: var\(--radius-card\)/);
});

test("the piece card and the listing popup to the references: rounded photograph, quiet line, × to pass; unverified only from the ledger; ♡ OFFER bag; the lines in Michroma", () => {
  assert.match(page, /className=\{"card piece"/);
  assert.match(page, /className="piecepass" onClick=\{onPass\}/);
  assert.match(listing, /className=\{"lstbadge " \+ badge\.state\}/, "the word on the photograph comes from the ledger's badge");
  assert.match(listing, /\{badge && badge\.state !== "none" \?/, "nothing without a badge");
  assert.match(listing, /priceLine\(item\)/);
  assert.match(listing, /"SIZE: " \+ item\.size\.label/);
  assert.match(css, /\.lstbadge\.unverified \.vbadgemark small \{[^}]*var\(--mich\)/);
  assert.match(css, /\.adslot \{[^}]*color: var\(--red\)/, "the *ADs slot is red under the deck");
  assert.match(strip(read("app/components/ControlCenter.jsx")), /<span className="adslot" aria-hidden="true">\*ADs<\/span>/);
});

test("the BRDCST footer: collapsed to title and date, inline expansion, the map and the organizer's tickets", () => {
  // slice 8: the footer carries every attached event (5.10–5.12) and the server's delivery note
  assert.match(card, /export function BrdcstFooter\(\{ event, events = null, brdcst = null \}\)/);
  assert.match(card, /footerPages\(all, \{ page \}\)/, "five soonest-first per page, +N beside the expander");
  assert.match(card, /PASSPORT MAP →/);
  assert.match(card, /TICKETS · THE ORGANIZER ↗/);
  assert.ok(!/stripe|checkout/i.test(card), "ASILUM never sells the ticket");
});

test("the FEED key's second tap reloads the feed", () => {
  assert.match(page, /window\.addEventListener\("asilum:feed-refresh", on\)/);
});

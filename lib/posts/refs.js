// lib/posts/refs.js
// Hashtags and @mentions on the wire (owner directive,
// 14 Aug 2026, backlog 3). Pure text in, structure out — no DOM,
// no db, no window: safe to import from routes, tests, and components
// alike.
//
// ORDER MATTERS, and the handover names it: parse AFTER the sanitizer,
// never before. sanitizeStatement strips angle brackets and control
// characters; parsing first would hand the renderer spans built from
// text the sanitizer had not yet cleaned. Everything here therefore
// takes already-sanitized text and only ever SPLITS it — no segment is
// rewritten, so what a reader sees is exactly what the author wrote.

// handles.js, NOT rooms.js: rooms reaches the database, and this module
// is imported by a client component (importing rooms would ship `pg` to
// the browser and break the build).
import { HANDLE_RE, RESERVED_HANDLES } from "../profile/handles.js";

// A hashtag is #, then letters/digits/hyphens. It must start at the head
// of the text or after whitespace or an opening bracket — "C#" and an
// anchor in a url are not tags.
const HASHTAG = /(^|[\s([{"'—–-])#([a-z0-9][a-z0-9-]{0,39})/gi;
// A mention is @ plus a claimable handle shape. Same boundary rule, so
// an email address never becomes a mention.
const MENTION = /(^|[\s([{"'—–-])@([a-z0-9][a-z0-9-]{0,23})/gi;

// A handle is linkable only if it COULD exist: the room rules must accept
// it, and reserved words (asilum, admin, staff…) can never be claimed, so
// linking one would promise a page that can never load.
export function linkableHandle(raw) {
  const handle = String(raw || "").toLowerCase();
  if (!HANDLE_RE.test(handle)) return null;
  if (RESERVED_HANDLES.includes(handle)) return null;
  return handle;
}

/** A hashtag reduced to storable form, or null if it is not one. Lowercased
 *  with trailing hyphens stripped, so `#Archive-` and `#archive` are one tag. */
export function normalizeHashtag(raw) {
  const tag = String(raw || "").toLowerCase().replace(/-+$/, "");
  return tag.length >= 1 && tag.length <= 40 ? tag : null;
}

// Extracted refs for storage: lowercased, de-duplicated, order preserved,
// and bounded so one transmission cannot fill the row with tags.
export function extractRefs(text, { maxTags = 12, maxMentions = 12 } = {}) {
  const source = String(text || "");
  const hashtags = [];
  const mentions = [];
  for (const [, , tag] of source.matchAll(HASHTAG)) {
    const norm = normalizeHashtag(tag);
    if (norm && !hashtags.includes(norm) && hashtags.length < maxTags) hashtags.push(norm);
  }
  for (const [, , handle] of source.matchAll(MENTION)) {
    const norm = linkableHandle(handle);
    if (norm && !mentions.includes(norm) && mentions.length < maxMentions) mentions.push(norm);
  }
  return { hashtags, mentions };
}

// Segments for rendering: [{ type: "text"|"hashtag"|"mention", text, value }].
// `text` is always the author's exact characters (so the display keeps
// their capitalization); `value` is the normalized target for the link.
// Concatenating every segment's `text` reproduces the input EXACTLY —
// the property the tests pin, because a renderer that drops or reorders
// a character is rewriting someone's transmission.
export function segmentTransmission(text) {
  const source = String(text || "");
  if (!source) return [];
  const marks = [];
  for (const m of source.matchAll(HASHTAG)) {
    const value = normalizeHashtag(m[2]);
    if (!value) continue;
    const start = m.index + m[1].length;
    marks.push({ start, end: start + 1 + m[2].length, type: "hashtag", value });
  }
  for (const m of source.matchAll(MENTION)) {
    const value = linkableHandle(m[2]);
    if (!value) continue;
    const start = m.index + m[1].length;
    marks.push({ start, end: start + 1 + m[2].length, type: "mention", value });
  }
  marks.sort((a, b) => a.start - b.start);

  const segments = [];
  let cursor = 0;
  for (const mark of marks) {
    // Overlaps cannot happen with these patterns, but a defensive skip
    // keeps the reproduce-exactly property true no matter what changes.
    if (mark.start < cursor) continue;
    if (mark.start > cursor) {
      segments.push({ type: "text", text: source.slice(cursor, mark.start) });
    }
    segments.push({ type: mark.type, text: source.slice(mark.start, mark.end), value: mark.value });
    cursor = mark.end;
  }
  if (cursor < source.length) segments.push({ type: "text", text: source.slice(cursor) });
  return segments;
}

// Where a ref points. A hashtag hands off to search (the wire does not
// own a tag archive; discover already reads ?q=); a mention lands on the
// reader's page, which resolves on server truth and says NOT FOUND
// honestly when nobody holds the handle.
export const hashtagHref = (value) => "/discover?q=" + encodeURIComponent(value);
/** Where a mention links. Points at the reader's page, which resolves on
 *  SERVER truth and says NOT FOUND honestly when nobody holds the handle —
 *  a mention is never proof the person exists. */
export const mentionHref = (value) => "/u/" + encodeURIComponent(value);

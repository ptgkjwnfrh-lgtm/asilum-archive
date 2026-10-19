// lib/model/media.js — SAMPLE MEDIA for the Live Launch V.2 model.
//
// The repository ships no photographs (audited 17 Sep: public/ holds fonts
// and a road map; catalog covers are generated gradients), and the rights
// register blocks runway/editorial imagery. These eight files are the ONLY
// exception, and they are here because their licences allow it: seven
// Unsplash-licensed photographs and one CC BY 4.0 portrait, each credited in
// public/model/credits.json and on every surface that shows one.
//
// They illustrate SAMPLE editorial posts so The Wire and the Front Cover
// open on media before the first person posts. Every sample is labelled
// SAMPLE EDITORIAL on screen, is never a listing, never a price, never a
// person's account. When the media pipeline lands, real posts replace them
// in the same card.
//
// ONE SAMPLE MOTION (slice 9): public/model/motion-test-pattern.mp4 is a
// SYNTHETIC test pattern drawn and encoded by scripts/make-motion-sample.swift
// (H.264 MP4, 320×180, six seconds, a generated 220 Hz test tone that swells
// and fades so nobody mistakes it for music) — the same kind of
// generated artefact as the catalog's gradient covers, so the housing can
// be exercised on a deployment with no video uploads. It is labelled
// GENERATED TEST PATTERN on every surface and is never a fashion film.

export const SAMPLE_CREDITS = Object.freeze({
  "chyntia-juls-fashion": { credit: "Chyntia Juls / Unsplash", license: "Unsplash License", url: "https://unsplash.com/photos/HlVjI5WmoQY", alt: "Low-angle monochrome portrait of a model in a textured blazer and dark trousers" },
  "ana-nichita-leather": { credit: "Ana Nichita / Unsplash", license: "Unsplash License", url: "https://unsplash.com/photos/woman-wearing-black-leather-jacket-IfNYCBwtAL4", alt: "Model in a black leather jacket with arms raised" },
  "faune-magazine-fashion": { credit: "Faune Magazine / Unsplash", license: "Unsplash License", url: "https://unsplash.com/photos/DQP03Vq78Z4", alt: "Open fashion magazine on a sofa, with a portrait on its right page" },
  "marjan-taghipour-fashion": { credit: "Marjan Taghipour / Unsplash", license: "Unsplash License", url: "https://unsplash.com/photos/1tjMpBTvFAA", alt: "Low-angle fashion portrait in a red outfit against a clear blue sky" },
  "nicolas-ladino-silva-fashion": { credit: "Nicolas Ladino Silva / Unsplash", license: "Unsplash License", url: "https://unsplash.com/photos/qUp0UsT89BY", alt: "Seated model in a burgundy blazer, patterned trousers and long black gloves" },
  "culture-study": { credit: "Yaosheng Zheng / Unsplash", license: "Unsplash License", url: "https://unsplash.com/photos/gray-concrete-building-under-white-sky-during-daytime-pQOqQpweE98", alt: "Interlocking gray concrete walls against a pale sky" },
  "product-study": { credit: "Zachary Keimig / Unsplash", license: "Unsplash License", url: "https://unsplash.com/photos/pair-of-white-sneakers-XVBZc0zig4Y", alt: "Pair of white sneakers photographed from above on a dark surface" },
});

export const SAMPLE_MOTION = Object.freeze({
  id: "sample-motion-1", generated: true, url: "/model/motion-test-pattern.mp4", poster: null,
  durationMs: 6000, width: 320, height: 180, rotation: 0, codec: "avc1", container: "mp4", audio: true,
  captions: [{ lang: "en", label: "English (description)", default: true, src: "/model/motion-test-pattern.vtt" }],
});

export const sampleImage = (key) => ({ src: `/model/${key}.jpg`, ...(SAMPLE_CREDITS[key] || { credit: "", license: "", url: "", alt: "" }) });

export const WIRE_CATEGORIES = Object.freeze([
  { id: "style", label: "STYLE" },
  { id: "film", label: "FILM & ART" },
  { id: "food", label: "FOOD & RITUAL" },
  { id: "movement", label: "MOVEMENT" },
  { id: "commentary", label: "COMMENTARY" },
  { id: "runway", label: "RUNWAY" },
]);

export const WIRE_INTENTS = Object.freeze([
  { id: "create", label: "CREATE", means: "original work — an outfit, a film, a plate, a dance" },
  { id: "curate", label: "CURATE", means: "a thoughtful selection, with attribution" },
  { id: "interpret", label: "INTERPRET", means: "context that adds meaning — a breakdown, a reading" },
]);

// Each sample rides the same shape a real transmission does on the wire
// (title, text, tags as hashtags) plus `sample: true`, `image` and `credit`.
export const SAMPLE_POSTS = Object.freeze([
  {
    id: "sample-w1", sample: true, intent: "interpret", category: "style",
    handle: "the-asilum-edit", name: "THE ASILUM EDIT",
    title: "Dressing like the city feels.",
    text: "An editorial study in proportion. Start with one structured piece; let the rest fall away. A silhouette becomes personal when you repeat it, reinterpret it, and make it your own.\n\nThe connection: architectural lines → sharp shoulders → your next saved piece.",
    tags: ["TAILORED", "ARCHIVAL"], image: sampleImage("chyntia-juls-fashion"),
  },
  {
    id: "sample-w2", sample: true, intent: "interpret", category: "film",
    handle: "culture-studies", name: "CULTURE STUDIES",
    title: "The frame is an outfit, too.",
    text: "Look at negative space, the shape of a shadow, the colour left at the edge of a frame. Those decisions travel from a film to a room to a wardrobe.\n\nCurate with context: say what you notice and credit the person who made it.",
    tags: ["MINIMAL", "AVANT-GARDE"], image: sampleImage("culture-study"),
  },
  {
    id: "sample-w3", sample: true, intent: "create", category: "style",
    handle: "independent-voices", name: "INDEPENDENT VOICES",
    title: "Personal style has no uniform.",
    text: "A visual note on getting dressed with intention. What makes an outfit interesting is often the choice that breaks your own pattern.",
    tags: ["INDEPENDENT", "STATEMENT"], image: sampleImage("faune-magazine-fashion"),
  },
  {
    id: "sample-w4", sample: true, intent: "create", category: "food",
    handle: "everyday-rituals", name: "EVERYDAY RITUALS",
    title: "Texture belongs at the table.",
    text: "A treatment for an aesthetic cooking film: close framing, natural sound, a quiet palette. A useful post reveals a creative decision rather than filling a feed.\n\nA storyboard concept with a reference image — not a playable video.",
    tags: ["MINIMAL", "INDEPENDENT"], image: sampleImage("product-study"),
  },
  {
    id: "sample-w8", sample: true, intent: "create", category: "movement",
    handle: "the-asilum-edit", name: "THE ASILUM EDIT",
    title: "The housing, exercised.",
    text: "A generated test pattern in the MOTION housing: tap for the controls, double-tap a side to seek, CC for the creator's captions, the speed and the quality settings, KEEP AUDIO to hand its test tone to the music circle. Not a film — a fixture so the player can be seen before the first upload.",
    tags: ["MINIMAL", "UTILITARIAN"], video: SAMPLE_MOTION,
  },
  {
    id: "sample-w5", sample: true, intent: "curate", category: "movement",
    handle: "movement-notes", name: "MOVEMENT NOTES",
    title: "Clothes in motion.",
    text: "A movement-film treatment: follow the fabric before following the dancer. Contrast a held pose with a loose sleeve in motion.\n\nA sample creative brief; the media player arrives with the pipeline.",
    tags: ["AVANT-GARDE", "STREETWEAR"], image: sampleImage("nicolas-ladino-silva-fashion"),
  },
  {
    id: "sample-w6", sample: true, intent: "interpret", category: "runway",
    handle: "runway-desk", name: "RUNWAY DESK",
    title: "Reading a show from the third look.",
    text: "The first two looks state the thesis; the third tells you whether the house believes it. A breakdown method, not a review.",
    tags: ["STATEMENT", "SEDUCTIVE"], image: sampleImage("marjan-taghipour-fashion"),
  },
  {
    id: "sample-w7", sample: true, intent: "curate", category: "commentary",
    handle: "after-hours", name: "AFTER HOURS",
    title: "Leather, after hours.",
    text: "Dark texture and a clean line — three references and why they hold together. Attribution in the notes.",
    tags: ["SEDUCTIVE", "ARCHIVAL", "STATEMENT"], image: sampleImage("ana-nichita-leather"),
  },
]);

/** A sample post's category as the hashtag a real post would carry. */
export const categoryTag = (id) => "#" + id;

/** Read a real transmission's category/intent back out of its hashtags. */
export function readWireRefs(tags = []) {
  const set = new Set((tags || []).map((t) => String(t).replace(/^#/, "").toLowerCase()));
  const category = WIRE_CATEGORIES.find((c) => set.has(c.id))?.id || null;
  const intent = WIRE_INTENTS.find((i) => set.has(i.id))?.id || null;
  return { category, intent };
}

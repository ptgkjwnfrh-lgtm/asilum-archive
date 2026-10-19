"use client";

// app/components/PostComposer.jsx — THE ONE COMPOSER (V.2 brief §6, owner,
// 1 Oct 2026). One housing for every post: begin with text, then ADD MEDIA
// · ADD PIECES · ADD LINK · ADD EVENT, with a preview — not seven competing
// upload screens. The KIND is read off what is attached (lib/posts/compose.js):
// words alone are a TRANSMISSION (≤ 500 characters, counted the way a person
// counts); an image makes it a POST and keeps the words as the caption;
// detaching the last image exposes the transmission again, and if it is now
// too long the author is asked to shorten it — never cut. A post's LAYOUT
// (single, carousel, wardrobe fragment, exposé, event publication) is a
// choice inside the post. VIDEO (slice 9) is the media worker's seam: where
// video uploads are enabled the file goes straight to storage on a signed
// URL, the worker reads its own copy and admits or refuses by name, and the
// admitted asset rides the composition; where they are not, the button says
// why. A poster frame the device captures rides the image path.
//
// The draft autosaves on the device with a version (lib/posts/draft.js);
// detached media stays in the draft's history until discarded. Pieces are
// tagged like people — chosen from the catalog, resolved to listing ids —
// so a plain word never becomes a verified tag. Events are chosen from the
// map's records. Links are previewed by the safe server service and stored
// as a plain-text snapshot. Publishing runs the same validator the server
// runs, then POSTs the composition; the device copy is written only after
// the server accepts.
//
// Images are re-drawn to a canvas before upload (lib pattern from
// WardrobeTab.jsx): EXIF and GPS never leave the browser.

import { useEffect, useMemo, useRef, useState } from "react";
import GlassPane from "./GlassPane.jsx";
import { Avatar } from "./UserBits.jsx";
import Icon from "./Icons.jsx";
import ModelTag from "./ModelTag.jsx";
import { getUid, postJSON, authorizedFetch, thumbFor } from "../../lib/client.js";
import { getProfileInfo, addPost } from "../../lib/social.js";
import BrdcstOptions, { DEFAULT_TARGETING, money } from "./BrdcstOptions.jsx";
import { quote as brdcstQuote } from "../../lib/brdcst/index.js";
import { extractRefs } from "../../lib/posts/refs.js";
import { WIRE_CATEGORIES, WIRE_INTENTS } from "../../lib/model/media.js";
import { TRANSMISSION_MAX, CAPTION_MAX, MAX_IMAGES, MAX_PIECES, LAYOUTS, LAYER_ALIGNS, LAYER_POSITIONS, LAYER_COLORS, graphemeCount } from "../../lib/posts/compose.js";
import {
  newDraft, readDraft, writeDraft, clearDraft, attachMedia, detachMedia, restoreMedia, discardMedia,
  setText, setTitle, setLayout, setLink, setEvent, addEvent, removeEvent, setPieces, setLayers, setVideo, describe,
} from "../../lib/posts/draft.js";
import { preflightMotion, MOTION } from "../../lib/media/index.js";

const LAYOUT_LABEL = { single: "SINGLE", carousel: "CAROUSEL", fragment: "WARDROBE FRAGMENT", expose: "EXPOSÉ", event: "EVENT" };
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error("image could not be decoded")); im.src = url; });
  } finally { URL.revokeObjectURL(url); }
}
/** Re-draw to a canvas (≤ 1600px) and re-encode as JPEG ≤ 2 MB: no metadata survives. */
async function prepImage(file) {
  const bmp = await decodeImage(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale)); canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
  let blob = null;
  for (const q of [0.86, 0.74, 0.62, 0.5]) { blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", q)); if (blob && blob.size <= IMAGE_MAX_BYTES) break; }
  if (!blob || blob.size > IMAGE_MAX_BYTES) throw new Error("the image could not be made small enough");
  return { blob, w: canvas.width, h: canvas.height };
}

// `kind` is Post Selection's hint (V.2 slice 3): transm · still · motion ·
// brdcst · echo. STILL opens the image picker's tool row, BRDCST the event
// picker, ECHO marks the composition temporary (24 hours; lib/posts/compose.js).
export default function PostComposer({ onPublished, compact = false, kind = null }) {
  // the draft lives in localStorage, which the server cannot read: start from
  // an empty draft on both sides and adopt the device's after mount, or the
  // first paint and the hydration disagree (caught 1 Oct: "a draft is
  // waiting" rendered on the client only)
  const [draft, setDraft] = useState(() => newDraft());
  useEffect(() => { setDraft(readDraft()); }, []);
  const [intent, setIntent] = useState("create");
  const [category, setCategory] = useState("style");
  const [open, setOpen] = useState(!compact);
  const [anon, setAnon] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [tool, setTool] = useState(null);       // "pieces" | "link" | "event" | "layers" | null
  const [uploads, setUploads] = useState(null); // { available, reason }
  const [motion, setMotion] = useState(null);   // { available, reason, law, worker } — the media worker's gate
  const videoRef = useRef(null);
  // BRDCST targeting (slice 8): the composer's panel; a campaign is created
  // as a DRAFT the moment the post publishes, paid as a separate step
  const [targeting, setTargeting] = useState({ ...DEFAULT_TARGETING });
  const [brdcstPlan, setBrdcstPlan] = useState("draft"); // "draft" | "pay"
  const fileRef = useRef(null);
  const c = draft.composition;
  const status = useMemo(() => describe(draft), [draft]);
  // the hint: the tool that type needs is open; an ECHO is marked at once
  useEffect(() => {
    if (!kind) return;
    setOpen(true);
    if (kind === "brdcst") setTool("event");
    if (kind === "echo") setDraft((d) => writeDraft({ ...d, composition: { ...d.composition, echo: true } }));
    if (kind !== "echo") setDraft((d) => d.composition.echo ? writeDraft({ ...d, composition: { ...d.composition, echo: false } }) : d);
  }, [kind]);

  useEffect(() => {
    const check = () => setAnon(!(getUid() || "").startsWith("sb-"));
    check();
    window.addEventListener("asilum:identity", check);
    return () => window.removeEventListener("asilum:identity", check);
  }, []);
  useEffect(() => {
    fetch("/api/editorial/media").then((r) => (r.ok ? r.json() : { available: false, reason: `the media service answered ${r.status}` })).then((d) => setUploads(d)).catch(() => setUploads({ available: false, reason: "the media service did not answer" }));
    fetch("/api/editorial/motion").then((r) => (r.ok ? r.json() : { available: false, reason: `the media worker answered ${r.status}` })).then((d) => setMotion(d)).catch(() => setMotion({ available: false, reason: "the media worker did not answer" }));
  }, []);
  // autosave: every change is a new version on the device
  const apply = (fn) => setDraft((d) => writeDraft(fn(d)));

  async function addImages(files) {
    const list = Array.from(files || []).slice(0, MAX_IMAGES - (c.media || []).length);
    if (!list.length) return;
    if (!uploads || !uploads.available) { setNote(uploads ? uploads.reason : "checking the media service…"); return; }
    setBusy("preparing images…");
    for (const file of list) {
      try {
        const { blob, w, h } = await prepImage(file);
        const form = new FormData();
        form.set("user", getUid() || ""); form.set("photo", blob, "image.jpg");
        const res = await authorizedFetch("/api/editorial/media", { method: "POST", body: form });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { setNote(d.error || "the image was not accepted"); continue; }
        apply((dr) => attachMedia(dr, { path: d.path, url: d.url, alt: "", w, h }));
      } catch (e) { setNote(String(e.message || "the image could not be prepared")); }
    }
    setBusy("");
  }
  /** The device reads the file's own length before anything leaves it. */
  function readDuration(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => { const d = v.duration; URL.revokeObjectURL(url); resolve({ durationMs: Number.isFinite(d) ? Math.round(d * 1000) : null, w: v.videoWidth, h: v.videoHeight, el: v }); };
      v.onerror = () => { URL.revokeObjectURL(url); resolve({ durationMs: null, w: 0, h: 0, el: null }); };
      v.src = url;
    });
  }
  /** VIDEO: preflight on the device, a signed direct upload, the worker's verdict. */
  async function addVideo(file) {
    if (!file) return;
    if (!motion || !motion.available) { setNote(motion ? motion.reason : "checking the media worker…"); return; }
    const meta = await readDuration(file);
    const pre = preflightMotion({ mime: file.type, bytes: file.size, durationMs: meta.durationMs });
    if (!pre.ok) { setNote(pre.message); return; }
    setBusy("asking the worker…");
    try {
      const begin = await postJSON("/api/editorial/motion", { user: getUid(), action: "begin", mime: file.type, bytes: file.size, durationMs: meta.durationMs });
      const b = await begin.json().catch(() => ({}));
      if (!begin.ok) { setNote(b.error || "the worker refused"); setBusy(""); return; }
      setBusy("uploading the video…");
      const put = await fetch(b.upload.url, { method: b.upload.method || "PUT", headers: { ...(b.upload.headers || {}), Authorization: `Bearer ${b.upload.token}` }, body: file });
      if (!put.ok) { setNote(`storage answered ${put.status} — nothing was attached`); setBusy(""); return; }
      setBusy("the worker is reading its copy…");
      const verify = await postJSON("/api/editorial/motion", { user: getUid(), action: "verify", id: b.asset.id });
      const v = await verify.json().catch(() => ({}));
      if (!verify.ok) { setNote(v.error || "the worker could not read the upload"); setBusy(""); return; }
      if (v.asset.state !== "ready") { setNote(`refused: ${v.asset.refusalNote || v.asset.refusalCode}`); setBusy(""); return; }
      let poster = null;
      // the poster: a frame the device draws, through the image path (no analysis server-side)
      if (meta.el && uploads && uploads.available) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = Math.min(1600, meta.w || 320); canvas.height = Math.round(canvas.width * ((meta.h || 180) / (meta.w || 320)));
          canvas.getContext("2d").drawImage(meta.el, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.8));
          if (blob && blob.size <= IMAGE_MAX_BYTES) {
            const form = new FormData(); form.set("user", getUid() || ""); form.set("photo", blob, "poster.jpg");
            const res = await authorizedFetch("/api/editorial/media", { method: "POST", body: form });
            const d = await res.json().catch(() => ({}));
            if (res.ok) {
              poster = d;
              await postJSON("/api/editorial/motion", { user: getUid(), action: "poster", id: v.asset.id, path: d.path });
            }
          }
        } catch {}
      }
      apply((dr) => setVideo(dr, { ...v.asset, poster: poster ? poster.url : null, posterPath: poster ? poster.path : null }));
      setNote("");
    } catch (e) { setNote(String(e.message || "the video could not be uploaded")); }
    setBusy("");
  }
  async function addCaptions(file, lang) {
    if (!file || !c.video) return;
    const vtt = await file.text();
    setBusy("saving the captions…");
    const res = await postJSON("/api/editorial/motion", { user: getUid(), action: "captions", id: c.video.id, tracks: [...(c.video.captions || []).filter((t) => t.lang !== lang).map((t) => ({ ...t, vtt: t.vtt })), { lang, label: lang, vtt }].filter((t) => t.vtt) });
    const d = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) { setNote(d.error || "the captions were not accepted"); return; }
    apply((dr) => setVideo(dr, { ...dr.composition.video, captions: d.asset.captions }));
  }
  async function discard(path) {
    apply((dr) => discardMedia(dr, path));
    try { await authorizedFetch("/api/editorial/media", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: getUid(), path }) }); } catch {}
  }

  function publish() {
    if (!status.ok) { setNote(status.errors[0].message); return; }
    const info = getProfileInfo();
    const refs = `#${intent} #${category}`;
    const text = c.text.trim();
    const body = text.includes(refs) ? text : (text ? `${text}\n\n${refs}` : refs);
    const composition = { media: c.media, video: c.video ? { id: c.video.id, durationMs: c.video.durationMs, state: c.video.state } : null, pieces: (c.pieces || []).map((p) => p.id), link: c.link ? { url: c.link.url } : null, event: c.event ? { id: c.event.id } : null, layout: c.layout, layers: c.layers, alt: c.alt, echo: !!c.echo };
    setBusy("publishing…");
    postJSON("/api/editorial", { user: getUid(), handle: info.handle || info.name, text: body, title: c.title || undefined, composition })
      .then(async (res) => {
        const d = await res.json().catch(() => null);
        setBusy("");
        if (!res.ok) { setNote((d && (d.error || d.note)) || "the Feed did not accept that"); return; }
        addPost(body, info, c.title, { postKind: d.postKind, layout: d.layout, attachments: d.attachments, imageUrl: c.media[0] ? c.media[0].url : (c.video && c.video.poster) || "" });
        let note = d && d.held ? (d.note || "saved and paused for a human review") : "";
        // the BRDCST campaign: a draft on the server, named to the post; a
        // sample fixture cannot be promoted and the route says so
        const evs = (c.events && c.events.length ? c.events : c.event ? [c.event] : []).filter((e) => !e.sample);
        if (evs.length && d && d.id != null) {
          try {
            const created = await postJSON("/api/brdcst", { user: getUid(), action: "create", postId: d.id, eventIds: evs.map((e) => e.id), tags: extractRefs(body).hashtags, radiusMi: targeting.radiusMi, tasteBreadth: targeting.tasteBreadth, durationDays: targeting.durationDays, scheduledStart: targeting.scheduledStart || null });
            const cj = await created.json().catch(() => null);
            if (!created.ok) note = (note ? note + " · " : "") + "the BRDCST was not saved: " + ((cj && cj.error) || created.status);
            else if (brdcstPlan === "pay") {
              const paid = await postJSON("/api/brdcst", { user: getUid(), action: "pay", id: cj.campaign.id });
              const pj = await paid.json().catch(() => null);
              if (paid.ok && pj && pj.checkoutUrl) { window.location.assign(pj.checkoutUrl); return; }
              note = (note ? note + " · " : "") + (paid.ok && pj && pj.paid ? "the BRDCST is paid with Credit and " + (pj.campaign.state === "scheduled" ? "scheduled" : "live") : "the BRDCST waits in the Studio's drafts — " + ((pj && pj.error) || "payment did not start"));
            } else note = (note ? note + " · " : "") + "the BRDCST is saved as a draft in the Studio — pay it there to send it";
          } catch { note = (note ? note + " · " : "") + "the BRDCST could not be saved — the post is published"; }
        } else if ((c.events && c.events.length) || c.event) note = (note ? note + " · " : "") + "a sample fixture cannot be promoted — the event rides on the post for you alone";
        setNote(note);
        setDraft(clearDraft()); setTool(null); setTargeting({ ...DEFAULT_TARGETING }); setBrdcstPlan("draft");
        if (onPublished) onPublished();
      })
      .catch(() => { setBusy(""); setNote("the shared wire could not be reached — nothing was published"); });
  }

  const count = status.kind === "transmission" ? `${graphemeCount(c.text)}/${TRANSMISSION_MAX}` : `${c.text.length}/${CAPTION_MAX}`;
  const layoutChoices = LAYOUTS.filter((l) => l !== "event" || c.event || (c.events && c.events.length)).filter((l) => l !== "expose" || c.media.length)
    .filter((l) => (l !== "single" && l !== "carousel") || c.media.length).filter((l) => l !== "fragment" || c.pieces.length);

  return (
    <GlassPane glass="lg-stream-compose" className={"wcomposer streamcompose" + (open ? "" : " closed")} aria-label="post to the stream">
      {!open ? (
        <button className="streamopen" onClick={() => setOpen(true)}>
          <Avatar name={getProfileInfo().name} />
          <span>{draft.version ? "a draft is waiting · " : ""}make something · select with credit · add context</span>
          <b>POST</b>
        </button>
      ) : (
        <>
          <div className="wckind" role="status">
            <span className={"wckindtag " + status.kind}>{c.echo ? "ECHO" : status.kind.toUpperCase()}</span>
            {c.echo ? <span className="wclayout">GONE IN 24H</span> : null}
            {status.kind === "post" && status.layout ? <span className="wclayout">{LAYOUT_LABEL[status.layout]}</span> : null}
            <span className="wckindwhy">{status.kind === "transmission" ? "words alone — attach an image and it becomes a post" : status.kind === "post" ? "the words are the caption" : ""}</span>
            {draft.version ? <span className="wcver">draft v{draft.version}</span> : null}
          </div>
          <div className="wintents seg" role="group" aria-label="what kind of post">
            {WIRE_INTENTS.map((i) => (
              <button key={i.id} className={"fmode" + (intent === i.id ? " cur" : "")} title={i.means} aria-pressed={intent === i.id} onClick={() => setIntent(i.id)}>{i.label}</button>
            ))}
            <span className="wintentmeans">{(WIRE_INTENTS.find((i) => i.id === intent) || {}).means}</span>
          </div>
          <div className="wcats" role="group" aria-label="category">
            {WIRE_CATEGORIES.map((cat) => (
              <button key={cat.id} className={"wchip" + (category === cat.id ? " on" : "")} aria-pressed={category === cat.id} onClick={() => setCategory(cat.id)}>{cat.label}</button>
            ))}
          </div>
          {anon && (
            <p className="pempty">transmissions ride on a signed-in account — reading is open, posting is named. <a className="bizapply" href="/board">sign in on your account →</a></p>
          )}
          <div className="wcompose">
            <Avatar name={getProfileInfo().name} />
            <div className="wcright">
              <input aria-label="caption header" className="wcap" type="text" maxLength={200} placeholder="caption header (optional)" value={c.title} onChange={(e) => apply((d) => setTitle(d, e.target.value))} />
              <textarea aria-label="the transmission" rows={3} placeholder="the transmission — today's uniform, tonight's find, the film, the plate, the whole account of it…" value={c.text} onChange={(e) => apply((d) => setText(d, e.target.value))} />

              {/* THE ATTACHMENTS */}
              {c.media.length > 0 && (
                <ul className="wcmedia" aria-label="images">
                  {c.media.map((m, i) => (
                    <li key={m.path}>
                      <img src={m.url} alt={m.alt || ""} />
                      <input aria-label={`description of image ${i + 1}`} type="text" maxLength={300} placeholder="describe the image (alt)" value={m.alt || ""}
                        onChange={(e) => apply((d) => ({ ...d, composition: { ...d.composition, media: d.composition.media.map((x) => x.path === m.path ? { ...x, alt: e.target.value } : x) } }))} />
                      <button className="txtbtn" onClick={() => apply((d) => detachMedia(d, m.path))}>DETACH</button>
                    </li>
                  ))}
                </ul>
              )}
              {c.video && (
                <div className="wcvideo">
                  <span className="cclbl">MOTION · {c.video.container} · {c.video.codec} · {c.video.width}×{c.video.height} · {Math.round((c.video.durationMs || 0) / 1000)}s{c.video.audio ? "" : " · no audio track"}</span>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video src={c.video.url} poster={c.video.poster || undefined} controls muted playsInline preload="metadata" />
                  <div className="wcvideorow">
                    <label className="txtbtn wcvtt">ADD CAPTIONS (.vtt)<input type="file" accept=".vtt,text/vtt" hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; const lang = window.prompt("the captions' language tag (en, pt-BR…)", "en"); if (f && lang) addCaptions(f, lang.trim()); }} /></label>
                    {(c.video.captions || []).map((t) => <span key={t.lang} className="chip">CC {t.lang}{t.cues ? ` · ${t.cues} cues` : ""}</span>)}
                    <button className="txtbtn" onClick={() => apply((d) => setVideo(d, null))}>REMOVE</button>
                  </div>
                  <p className="fine">{motion && motion.worker ? motion.worker.sentence : ""} · automatic transcription and translation are not built; creator captions are the real path (3.8)</p>
                </div>
              )}
              {draft.detached.length > 0 && (
                <div className="wcdetached">
                  <span className="cclbl">DETACHED · KEPT UNTIL YOU DISCARD</span>
                  {draft.detached.map((m) => (
                    <span key={m.path} className="wcdet">
                      <img src={m.url} alt="" />
                      <button className="txtbtn" onClick={() => apply((d) => restoreMedia(d, m.path))}>RESTORE</button>
                      <button className="txtbtn" onClick={() => discard(m.path)}>DISCARD</button>
                    </span>
                  ))}
                </div>
              )}
              {c.pieces.length > 0 && (
                <ul className="wcpieces" aria-label="tagged pieces">
                  {c.pieces.map((p) => (
                    <li key={p.id}>{p.img ? <img src={p.img} alt="" /> : null}<span>{p.brand ? p.brand + " — " : ""}{p.title}</span>
                      <button className="txtbtn" onClick={() => apply((d) => setPieces(d, d.composition.pieces.filter((x) => x.id !== p.id)))}>REMOVE</button></li>
                  ))}
                </ul>
              )}
              {c.link && (
                <div className="wclink">
                  <span className="cclbl">LINK · {c.link.host || ""}</span>
                  <b>{c.link.title || c.link.url}</b>{c.link.description ? <span>{c.link.description}</span> : null}
                  {c.link.refused ? <span className="fine">preview refused: {c.link.refused} — the link still posts as a link</span> : null}
                  <button className="txtbtn" onClick={() => apply((d) => setLink(d, null))}>REMOVE</button>
                </div>
              )}
              {(c.events && c.events.length ? c.events : c.event ? [c.event] : []).map((ev) => (
                <div className="wcevent" key={ev.id}>
                  <span className="cclbl">BRDCST · {String(ev.kind || "").toUpperCase()}{ev.sample ? " · SAMPLE FIXTURE" : ""}</span>
                  <b>{ev.name}</b><span>{ev.city}{ev.startsAt ? " · " + ev.startsAt : ""}</span>
                  <button className="txtbtn" onClick={() => apply((d) => removeEvent(d, ev.id))}>REMOVE</button>
                </div>
              ))}
              {((c.events && c.events.length) || c.event) ? (
                <>
                  <BrdcstOptions value={targeting} onChange={setTargeting} eventId={(c.events && c.events[0] ? c.events[0].id : c.event && c.event.id) || null} tags={extractRefs(c.text || "").hashtags} compact />
                  <div className="brdplan seg" role="group" aria-label="when to pay">
                    <button type="button" className={"chip clickable" + (brdcstPlan === "draft" ? " cur" : "")} aria-pressed={brdcstPlan === "draft"} onClick={() => setBrdcstPlan("draft")}>SAVE THE BRDCST AS A DRAFT</button>
                    <button type="button" className={"chip clickable" + (brdcstPlan === "pay" ? " cur" : "")} aria-pressed={brdcstPlan === "pay"} onClick={() => setBrdcstPlan("pay")}>PAY {money(brdcstQuote(targeting).totalCents)} ON PUBLISH →</button>
                  </div>
                  <p className="fine">until it is paid the broadcast waits in the Studio's drafts; the post itself publishes now. a BRDCST reaches passports whose taste matches, inside the radius; a block suppresses it.</p>
                </>
              ) : null}

              {/* THE ADD ROW */}
              <div className="wcadd" role="group" aria-label="add to the post">
                <input ref={fileRef} aria-label="choose images" type="file" accept="image/*" multiple hidden onChange={(e) => { addImages(e.target.files); e.target.value = ""; }} />
                <button className="wcaddbtn" disabled={!!busy || c.media.length >= MAX_IMAGES} onClick={() => fileRef.current && fileRef.current.click()}>
                  <Icon name="plus" size={16} /> ADD MEDIA{uploads && !uploads.available ? <ModelTag kind="device">OFF</ModelTag> : null}
                </button>
                <button className={"wcaddbtn" + (tool === "pieces" ? " on" : "")} onClick={() => setTool(tool === "pieces" ? null : "pieces")}><Icon name="feed" size={16} /> ADD PIECES</button>
                <button className={"wcaddbtn" + (tool === "link" ? " on" : "")} onClick={() => setTool(tool === "link" ? null : "link")}><Icon name="link" size={16} /> ADD LINK</button>
                <button className={"wcaddbtn" + (tool === "event" ? " on" : "")} onClick={() => setTool(tool === "event" ? null : "event")}><Icon name="map" size={16} /> ADD EVENT</button>
                <button className={"wcaddbtn" + (c.echo ? " on" : "")} aria-pressed={!!c.echo} onClick={() => apply((d) => ({ ...d, composition: { ...d.composition, echo: !d.composition.echo } }))} title="an echo is a temporary post — gone after 24 hours"><Icon name="disc" size={16} /> ECHO</button>
                <input ref={videoRef} aria-label="choose a video" type="file" accept="video/mp4,video/webm" hidden onChange={(e) => { addVideo(e.target.files && e.target.files[0]); e.target.value = ""; }} />
                <button className={"wcaddbtn" + (motion && !motion.available ? " off" : "")} disabled={!!busy || !!c.video || !motion} title={motion && !motion.available ? motion.reason : `an MP4 (H.264) or a WebM (VP8/VP9), at most ${Math.round(MOTION.maxMs / 60000)} minutes and ${Math.round(MOTION.maxBytes / 1024 / 1024)} MB — no transcoder, so nothing else`} onClick={() => { if (motion && !motion.available) { setNote("video: " + motion.reason); return; } videoRef.current && videoRef.current.click(); }}>
                  <Icon name="cover" size={16} /> VIDEO{motion && !motion.available ? <ModelTag kind="device">OFF</ModelTag> : null}
                </button>
              </div>
              {uploads && !uploads.available && <p className="fine">images: {uploads.reason}</p>}
              {motion && !motion.available && <p className="fine">video: {motion.reason} — {motion.worker ? motion.worker.sentence : ""}</p>}
              {tool === "pieces" && <PiecePicker chosen={c.pieces} onPick={(p) => apply((d) => setPieces(d, [...d.composition.pieces.filter((x) => x.id !== p.id), p]))} />}
              {tool === "link" && <LinkPicker onPick={(snap) => { apply((d) => setLink(d, snap)); setTool(null); }} />}
              {tool === "event" && <EventPicker onPick={(ev) => { apply((d) => addEvent(d, ev)); setTool(null); }} />}

              {/* LAYOUT, for a post */}
              {(status.kind === "post" || c.pieces.length > 0) && (
                <div className="wclayouts seg" role="group" aria-label="layout">
                  {status.kind !== "post" && <span className="wintentmeans">tagged pieces ride on the words — choose WARDROBE FRAGMENT to show them as a post</span>}
                  {layoutChoices.map((l) => (
                    <button key={l} className={"fmode" + ((c.layout || status.layout) === l ? " cur" : "")} aria-pressed={(c.layout || status.layout) === l} onClick={() => apply((d) => setLayout(d, l))}>{LAYOUT_LABEL[l]}</button>
                  ))}
                  {(c.layout || status.layout) === "expose" && <button className="txtbtn" onClick={() => setTool(tool === "layers" ? null : "layers")}>{tool === "layers" ? "CLOSE LAYERS" : "TEXT LAYERS"}</button>}
                </div>
              )}
              {tool === "layers" && (c.layout || status.layout) === "expose" && (
                <LayerEditor layers={c.layers} onChange={(layers) => apply((d) => setLayers(d, layers))} />
              )}

              <div className="cvcomposerow">
                <span className={"ccount" + (status.ok || !c.text ? "" : " over")}>{count}{busy ? " · " + busy : ""}</span>
                {draft.version ? <button className="txtbtn" onClick={() => { setDraft(clearDraft()); setTool(null); }}>DISCARD DRAFT</button> : null}
                {compact && <button className="txtbtn" onClick={() => setOpen(false)}>CLOSE</button>}
                <button className="btn postbtn" onClick={publish} disabled={!status.ok || !!busy || anon}>POST</button>
              </div>
              {!status.ok && c.text && <p className="pempty" role="status">{status.errors[0].message}</p>}
            </div>
          </div>
          {note && <div className="pempty" role="status">{note}</div>}
        </>
      )}
    </GlassPane>
  );
}

/** Tag a piece like a person: search the catalog, choose a listing. */
function PiecePicker({ chosen, onPick }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setRows([]); return undefined; }
    let live = true;
    const t = setTimeout(() => {
      authorizedFetch("/api/discover?q=" + encodeURIComponent(s) + "&limit=8").then((r) => (r.ok ? r.json() : { items: [] })).then((d) => { if (live) setRows(d.items || []); }).catch(() => {});
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return (
    <div className="wcpicker">
      <input aria-label="search the catalog for a piece" type="search" placeholder="search a listing to tag it" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul>
        {rows.map((it) => (
          <li key={it.id}>
            <img src={it.img || thumbFor(it)} alt="" />
            <span>{it.brand} — {it.title}</span>
            <button className="txtbtn" disabled={chosen.some((p) => p.id === it.id) || chosen.length >= MAX_PIECES} onClick={() => onPick({ id: it.id, title: it.title, brand: it.brand, img: it.img || thumbFor(it) })}>TAG</button>
          </li>
        ))}
        {q.trim().length >= 2 && !rows.length && <li className="pempty">nothing in the catalog reads that way — a piece is tagged by choosing it, not by naming it.</li>}
      </ul>
    </div>
  );
}

function LinkPicker({ onPick }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    let u; try { u = new URL(url.trim()); } catch { setErr("that is not a web address"); return; }
    if (u.protocol !== "https:") { setErr("links are https only"); return; }
    setBusy(true); setErr("");
    try {
      const r = await authorizedFetch("/api/editorial/preview?url=" + encodeURIComponent(u.href) + "&user=" + encodeURIComponent(getUid() || ""));
      const d = await r.json().catch(() => ({}));
      if (!r.ok && !d.refused) { setErr(d.error || `the preview service answered ${r.status}`); setBusy(false); return; }
      if (d.refused) onPick({ url: u.href, title: "", description: "", image: "", host: u.hostname.replace(/^www\./, ""), refused: d.refused });
      else if (d.url) onPick(d);
      else setErr(d.error || "the preview service did not answer");
    } catch { setErr("the preview service did not answer"); }
    setBusy(false);
  }
  return (
    <div className="wcpicker">
      <input aria-label="link address" type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button className="txtbtn" disabled={busy} onClick={go}>{busy ? "READING…" : "PREVIEW"}</button>
      {err && <p className="pempty">{err}</p>}
    </div>
  );
}

function EventPicker({ onPick }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { fetch("/api/places?dated=1").then((r) => r.json()).then((d) => setRows(d.places || [])).catch(() => setRows([])); }, []);
  return (
    <div className="wcpicker">
      <ul>
        {rows === null && <li className="pempty">reading the map…</li>}
        {rows && rows.map((p) => (
          <li key={p.id}>
            <span>{p.name} · {String(p.kind).toUpperCase()} · {p.city}{p.startsAt ? " · " + p.startsAt : ""}{p.sample ? " · SAMPLE FIXTURE" : ""}</span>
            <button className="txtbtn" onClick={() => onPick({ id: p.id, name: p.name, kind: p.kind, city: p.city, startsAt: p.startsAt || null, sample: !!p.sample })}>ATTACH</button>
          </li>
        ))}
        {rows && !rows.length && <li className="pempty">the map holds no dated events right now.</li>}
      </ul>
    </div>
  );
}

/** The exposé's text layers: structured text with a bounded palette and
 *  normalised positions — never a flattened picture. */
function LayerEditor({ layers, onChange }) {
  const set = (i, patch) => onChange(layers.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="wclayers">
      {layers.map((l, i) => (
        <div key={i} className="wclayer">
          <input aria-label={`layer ${i + 1} text`} type="text" maxLength={120} placeholder="the words over the image" value={l.text || ""} onChange={(e) => set(i, { text: e.target.value })} />
          <select aria-label="position" value={l.position || "bottom"} onChange={(e) => set(i, { position: e.target.value })}>{LAYER_POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <select aria-label="alignment" value={l.align || "left"} onChange={(e) => set(i, { align: e.target.value })}>{LAYER_ALIGNS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <select aria-label="colour" value={l.color || "paper"} onChange={(e) => set(i, { color: e.target.value })}>{LAYER_COLORS.map((col) => <option key={col} value={col}>{col}</option>)}</select>
          <button className="txtbtn" onClick={() => onChange(layers.filter((_, j) => j !== i))}>REMOVE</button>
        </div>
      ))}
      {layers.length < 3 && <button className="txtbtn" onClick={() => onChange([...layers, { text: "", position: "bottom", align: "left", color: "paper", font: "display" }])}>+ LAYER</button>}
    </div>
  );
}

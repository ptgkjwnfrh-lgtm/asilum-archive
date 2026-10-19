"use client";

// app/components/MediaFloat.jsx — STILL and MOTION, enlarged (V.2
// Blueprint, owner, 17 Oct 2026, Foundations: "STILL and MOTION enlarge
// over the Feed. Username and caption stay on the media and move upward to
// make room; caption text flips between black, gray and white to stay
// legible. Actions: LIKE, COMMENT, STAMP, SHARE, plus an audio button
// beside SHARE only when audio exists").
//
// A popup in the session hub (the "media" view), tall. The caption block
// sits on the media; a tap on it expands upward. The ink is chosen from the
// photograph's own luminance where the browser lets us read it (same-origin
// images; a cross-origin upload taints the canvas and the scrim keeps white
// legible instead). COMMENT says `soon` — comments are not built; the
// audio button beside SHARE appears only when audio exists — a MOTION whose
// track carries sound — and it hands the soundtrack to the music circle
// (3.14). A MOTION plays in the housing (MotionHousing.jsx, slice 9): the
// controls, the captions, the speed, PiP, and the ink read from the frame.

import { useEffect, useRef, useState } from "react";
import { fetchPost, fetchEngagement, toggleEngagement } from "../../lib/social.js";
import { SAMPLE_POSTS } from "../../lib/model/media.js";
import { captionInk } from "../../lib/feed/caption.js";
import MotionHousing from "./MotionHousing.jsx";
import { postType } from "../../lib/feed/types.js";
import SaveButton from "./SaveButton.jsx";
import TransmissionText from "./TransmissionText.jsx";
import { ChevronText } from "./Chevrons.jsx";
import Icon from "./Icons.jsx";
import { haptic } from "../../lib/haptics.js";

/** The MOTION a post carries: the sample's own clip, or the admitted asset. */
function videoOf(p) {
  if (!p) return null;
  if (p.sample) return p.video || null;
  const v = p.attachments && p.attachments.video;
  return v && v.url ? v : null;
}

function mediaOf(p) {
  if (!p) return [];
  if (p.sample) return p.image ? [{ src: p.image.src, alt: p.image.alt || "", credit: p.image.credit, url: p.image.url }] : [];
  const a = p.attachments || {};
  const media = Array.isArray(a.media) ? a.media : [];
  const urls = media.map((m, i) => ({ src: m.url || (i === 0 ? p.imageUrl : null), alt: m.alt || "" })).filter((m) => m.src);
  if (!urls.length && p.imageUrl) return [{ src: p.imageUrl, alt: a.alt || "" }];
  return urls;
}

export default function MediaFloat({ id, sample = false, post: given = null }) {
  const [post, setPost] = useState(given);
  const [ink, setInk] = useState("white");
  const [up, setUp] = useState(false);
  const [slide, setSlide] = useState(0);
  const [eng, setEng] = useState(null);
  const [note, setNote] = useState("");
  const imgRef = useRef(null);

  useEffect(() => {
    if (given) return;
    if (sample) { setPost(SAMPLE_POSTS.find((s) => s.id === id) || null); return; }
    let live = true;
    fetchPost(id).then((p) => { if (live) setPost(p); });
    return () => { live = false; };
  }, [id, sample, given]);
  useEffect(() => {
    if (!post || post.sample || post.serverId == null) return undefined;
    let live = true;
    fetchEngagement([post.serverId]).then((e) => { if (live) setEng(e[String(post.serverId)] || null); }).catch(() => {});
    return () => { live = false; };
  }, [post]);

  // the caption's ink from the photograph (best effort; never an error)
  function sampleInk() {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    try {
      const c = document.createElement("canvas");
      c.width = 16; c.height = 16;
      const ctx = c.getContext("2d");
      // the lower third, where the caption sits
      ctx.drawImage(img, 0, img.naturalHeight * 0.66, img.naturalWidth, img.naturalHeight * 0.34, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      setInk(captionInk(sum / (d.length / 4) / 255));
    } catch { setInk("white"); }
  }

  if (!post) return <p className="deck">reading the post…</p>;
  const media = mediaOf(post);
  const type = postType(post);
  const video = videoOf(post);
  const name = post.sample ? post.name : (post.name || post.handle);
  const cur = media[slide] || media[0];
  const href = post.sample ? "/" : (post.serverId != null ? "/?post=" + encodeURIComponent(post.serverId) : "/");

  async function like() {
    if (post.sample || post.serverId == null) { setNote("a sample has no like"); return; }
    haptic("press");
    const on = !(eng && eng.youLike);
    const r = await toggleEngagement(post.serverId, "like", on).catch(() => null);
    if (r && r.ok) setEng(r.counts);
  }
  async function shareIt() {
    const url = window.location.origin + href;
    try {
      if (navigator.share) await navigator.share({ url, title: post.title || name });
      else { await navigator.clipboard.writeText(url); setNote("link copied"); }
    } catch {}
  }

  return (
    <div className={"mediafloat ink-" + ink} data-type={type}>
      <div className="mfstage">
        {video ? <MotionHousing video={video} postId={post.sample ? post.id : post.serverId} sample={!!post.sample} title={post.title || ""} by={name} onInk={(l) => setInk(captionInk(l))} /> : null}
        {!video && cur ? <img ref={imgRef} src={cur.src} alt={cur.alt || ""} crossOrigin={/^https?:\/\//.test(cur.src) && !cur.src.startsWith(window.location.origin) ? "anonymous" : undefined} onLoad={sampleInk} /> : null}
        {!video && !cur ? <div className="mfblank">{type} · no media</div> : null}
        {media.length > 1 ? (
          <>
            <button type="button" className="mfarrow prev" aria-label="previous photograph" onClick={() => setSlide((s) => (s - 1 + media.length) % media.length)}><Icon name="back" size={18} /></button>
            <button type="button" className="mfarrow next" aria-label="next photograph" onClick={() => setSlide((s) => (s + 1) % media.length)}><Icon name="back" size={18} className="flip" /></button>
            <span className="mfcount" aria-hidden="true">{slide + 1}/{media.length}</span>
          </>
        ) : null}
        <button type="button" className={"mfcaption" + (up ? " up" : "")} aria-expanded={up} onClick={() => setUp((u) => !u)}>
          <b className="mfwho">{name}</b>
          {post.title ? <span className="mfttl">{post.title}</span> : null}
          {up ? <ChevronText as="p" className="mftext" text={post.text} /> : <TransmissionText text={post.text} className="mftext" />}
          {cur && cur.credit ? <small className="mfcredit">{cur.credit}</small> : null}
          {video && video.generated ? <small className="mfcredit">SAMPLE MOTION · GENERATED TEST PATTERN · {video.width}×{video.height} · {video.codec} · a generated test tone</small> : null}
        </button>
      </div>
      <div className="mfacts" role="group" aria-label="actions">
        <button type="button" className={eng && eng.youLike ? "on" : ""} onClick={like} aria-pressed={!!(eng && eng.youLike)}><Icon name="heart" size={18} /><span>LIKE{eng && eng.likes > 0 ? " " + eng.likes : ""}</span></button>
        <button type="button" className="soon" disabled title="comments are not built yet"><Icon name="messages" size={18} /><span>COMMENT</span></button>
        <SaveButton kind="post" id={post.sample ? post.id : String(post.serverId ?? post.id)} title={post.title || (post.text || "").slice(0, 80)} image={cur ? cur.src : ""} href={href} meta={name} tags={post.tags || []} labels={["STAMP", "STAMPED ✓"]} />
        <button type="button" onClick={shareIt}><Icon name="link" size={18} /><span>SHARE</span></button>
      </div>
      {note ? <p className="fine" role="status">{note}</p> : null}
    </div>
  );
}

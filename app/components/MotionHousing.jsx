"use client";

// app/components/MotionHousing.jsx — THE VIDEO HOUSING (V.2 Blueprint,
// owner, 17 Oct 2026, chapter 3 3.1–3.12, 3.14; slice 9). The full-screen
// MOTION inside the "media" popup: familiar controls — play and pause,
// seeking, fast-forward, settings — revealed by a tap, hidden after
// inactivity, kept while in use (3.2); double-tap the sides to seek; the
// popup's own swipe-down exits. While the controls show, the deck, the Info
// Dock and the Passport Button become extremely compact and translucent
// (3.1, `data-media` on <html>). Picture-in-Picture where the browser has it
// (3.5); speed at the six conventional rates (3.7); quality as a stored
// choice that is honest about the single rendition (3.6, QUALITY_NOTE);
// creator-provided captions with a CC toggle, the passenger's size and
// background opacity, the preferred language picked first (3.8–3.11);
// reduced motion means no autoplay. KEEP THE AUDIO hands the soundtrack to
// the one audio source so it keeps playing while the passenger browses
// (3.14); the visuals pause.
//
// Nothing here identifies music: no track label is drawn unless an
// identification exists, and none does (3.12; lib/media/index.js
// musicIdentification is notImplemented).
//
// The caption's ink (lib/feed/caption.js) is read from the frame's lower
// third on load, seek, pause and every INK_SAMPLE_MS while playing, so the
// on-media caption stays legible as the picture changes.

import { useEffect, useRef, useState, useCallback } from "react";
import { SPEEDS, QUALITIES, QUALITY_NOTE, CONTROLS_HIDE_MS, SEEK_STEP_S, INK_SAMPLE_MS, captionsShown, pickCaptionTrack, captionAppearance } from "../../lib/media/index.js";
import { useMediaPreferences, setMediaPreferences, platformLimits } from "../../lib/media/preferences.js";
import { positions } from "../../lib/media/feedplay.js";
import { takeAudio, usePlayer, setSourceColor } from "../../lib/music/player.js";
import { dominantColor } from "../../lib/music/index.js";
import Icon from "./Icons.jsx";
import { haptic } from "../../lib/haptics.js";

const fmt = (s) => { const n = Math.max(0, Math.floor(Number(s) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`; };
const sameOrigin = (src) => !/^https?:\/\//.test(src) || (typeof window !== "undefined" && src.startsWith(window.location.origin));

export default function MotionHousing({ video, postId, sample = false, title = "", by = "", onInk, onFrameColor }) {
  const prefs = useMediaPreferences();
  const player = usePlayer();
  const ref = useRef(null);
  const stageRef = useRef(null);
  const hideTimer = useRef(null);
  const tapRef = useRef({ at: 0, x: 0 });
  const [controls, setControls] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(Number(video.durationMs || 0) / 1000);
  const [menu, setMenu] = useState(null);       // "speed" | "quality" | "cc" | null
  const [speed, setSpeed] = useState(1);
  const [cc, setCc] = useState(() => captionsShown({ prefs, muted: false }));
  const [cue, setCue] = useState("");
  const [note, setNote] = useState("");
  const [pip, setPip] = useState(false);
  const tracks = Array.isArray(video.captions) ? video.captions : [];
  const [lang, setLang] = useState(() => { const pick = pickCaptionTrack(tracks, typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : []); return pick ? pick.lang : null; });
  const trackSrc = (tr) => (sample ? tr.src : `/api/editorial/motion?captions=${encodeURIComponent(video.id)}&lang=${encodeURIComponent(tr.lang)}`);
  const handedOver = !!(player.source && player.source.kind === "motion" && String(player.source.postId) === String(postId) && player.state !== "ended");
  const reduced = platformLimits().reducedMotion;

  // the controls' auto-hide (3.2): while playing and untouched; kept while in use
  const poke = useCallback(() => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { if (ref.current && !ref.current.paused && !menu) setControls(false); }, CONTROLS_HIDE_MS);
  }, [menu]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (controls) document.documentElement.dataset.media = "1"; else delete document.documentElement.dataset.media;
    return () => { delete document.documentElement.dataset.media; };
  }, [controls]);

  // the ink and the frame's colour, from the lower third / the whole frame
  const sampleFrame = useCallback(() => {
    const v = ref.current;
    if (!v || !v.videoWidth || !sameOrigin(video.url)) return;
    try {
      const c = document.createElement("canvas"); c.width = 16; c.height = 16;
      const ctx = c.getContext("2d");
      ctx.drawImage(v, 0, v.videoHeight * 0.66, v.videoWidth, v.videoHeight * 0.34, 0, 0, 16, 16);
      const d = ctx.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (onInk) onInk(sum / (d.length / 4) / 255);
      ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight, 0, 0, 16, 16);
      const color = dominantColor(ctx.getImageData(0, 0, 16, 16).data);
      if (color && onFrameColor) onFrameColor(color);
      if (color && handedOver) setSourceColor(color);
    } catch { if (onInk) onInk(NaN); }
  }, [video.url, onInk, onFrameColor, handedOver]);
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(sampleFrame, INK_SAMPLE_MS);
    return () => clearInterval(id);
  }, [playing, sampleFrame]);

  // the element's events
  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    const on = () => { setPlaying(true); poke(); };
    const off = () => { setPlaying(false); setControls(true); sampleFrame(); };
    const time = () => setT(v.currentTime);
    const meta = () => { setDur(v.duration || dur); const at = positions.get(String(postId)); if (at > 0 && at < (v.duration || Infinity)) { try { v.currentTime = at; } catch {} } };
    const vol = () => setMuted(v.muted);
    v.addEventListener("play", on); v.addEventListener("pause", off); v.addEventListener("ended", off);
    v.addEventListener("timeupdate", time); v.addEventListener("loadedmetadata", meta); v.addEventListener("loadeddata", sampleFrame); v.addEventListener("seeked", sampleFrame); v.addEventListener("volumechange", vol);
    v.addEventListener("enterpictureinpicture", () => setPip(true)); v.addEventListener("leavepictureinpicture", () => setPip(false));
    return () => {
      // 3.4: the exact timestamp survives the popup; 3.5: leaving pauses
      if (v.currentTime > 0) positions.set(String(postId), v.currentTime);
      v.removeEventListener("play", on); v.removeEventListener("pause", off); v.removeEventListener("ended", off);
      v.removeEventListener("timeupdate", time); v.removeEventListener("loadedmetadata", meta); v.removeEventListener("loadeddata", sampleFrame); v.removeEventListener("seeked", sampleFrame); v.removeEventListener("volumechange", vol);
    };
  }, [postId, poke, sampleFrame, dur]);

  // intentional open: play, with sound where the browser allows it; muted
  // as the fallback, never silently nothing; reduced motion waits for a tap
  useEffect(() => {
    const v = ref.current;
    if (!v || reduced || handedOver) return;
    v.muted = false;
    v.play().catch(() => { v.muted = true; setMuted(true); v.play().catch(() => {}); });
  }, [reduced, handedOver]);
  // the one audio source (3.15): when another source claims audio, these visuals pause
  useEffect(() => {
    const onClaim = (e) => { if (ref.current && !(e.detail && String(e.detail.postId) === String(postId))) ref.current.pause(); };
    window.addEventListener("asilum:audio-claimed", onClaim);
    return () => window.removeEventListener("asilum:audio-claimed", onClaim);
  }, [postId]);
  // captions: the chosen track renders through our own box (size and
  // opacity are the passenger's, 3.9), so every track stays "hidden" to the
  // browser's renderer and cuechange gives us the words
  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    const list = v.textTracks;
    const sync = () => {
      for (let i = 0; i < list.length; i++) {
        const tr = list[i];
        tr.mode = cc && tr.language === lang ? "hidden" : "disabled";
      }
    };
    const onCue = () => {
      let text = "";
      for (let i = 0; i < list.length; i++) if (list[i].mode === "hidden" && list[i].activeCues) for (const q of list[i].activeCues) text += (text ? "\n" : "") + q.text;
      setCue(text);
    };
    sync();
    for (let i = 0; i < list.length; i++) list[i].addEventListener("cuechange", onCue);
    if (!cc) setCue("");
    return () => { for (let i = 0; i < list.length; i++) list[i].removeEventListener("cuechange", onCue); };
  }, [cc, lang, tracks.length]);
  useEffect(() => { setCc(captionsShown({ prefs, muted })); }, [prefs.captions, muted]);
  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);

  function toggle() { const v = ref.current; if (!v) return; haptic("press"); if (v.paused) v.play().catch(() => {}); else v.pause(); }
  function seek(d) { const v = ref.current; if (!v) return; v.currentTime = Math.min(v.duration || Infinity, Math.max(0, v.currentTime + d)); poke(); }
  // a tap reveals or hides the controls; a double tap on a side seeks (3.2)
  function stageTap(e) {
    const now = Date.now();
    const rect = stageRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const prev = tapRef.current;
    tapRef.current = { at: now, x };
    if (now - prev.at < 320 && Math.abs(prev.x - x) < 0.2) {
      if (x < 0.33) { seek(-SEEK_STEP_S); setNote(`−${SEEK_STEP_S}s`); }
      else if (x > 0.67) { seek(SEEK_STEP_S); setNote(`+${SEEK_STEP_S}s`); }
      else toggle();
      setTimeout(() => setNote(""), 700);
      return;
    }
    setControls((c) => { const next = !c; if (next) poke(); return next; });
  }
  // the keyboard's housing: space / enter play, the arrows seek, C captions, M mute
  function stageKey(e) {
    if (e.target !== e.currentTarget) return;
    const k = e.key;
    if (k === " " || k === "Enter") { e.preventDefault(); toggle(); }
    else if (k === "ArrowLeft") { e.preventDefault(); seek(-SEEK_STEP_S); }
    else if (k === "ArrowRight") { e.preventDefault(); seek(SEEK_STEP_S); }
    else if (k === "c" || k === "C") { if (tracks.length) setCc((c) => !c); }
    else if (k === "m" || k === "M") { const v = ref.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }
    poke();
  }
  async function pipToggle() {
    const v = ref.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled && v.requestPictureInPicture) await v.requestPictureInPicture();
      else if (v.webkitSetPresentationMode) v.webkitSetPresentationMode(v.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture");
    } catch { setNote("picture-in-picture was refused by the browser"); setTimeout(() => setNote(""), 1600); }
  }
  async function fullscreen() {
    const el = stageRef.current;
    try { if (document.fullscreenElement) await document.exitFullscreen(); else if (el.requestFullscreen) await el.requestFullscreen(); else if (ref.current.webkitEnterFullscreen) ref.current.webkitEnterFullscreen(); } catch {}
  }
  async function keepAudio() {
    const v = ref.current;
    if (!v) return;
    haptic("press");
    const ok = await takeAudio({ kind: "motion", postId, sample, src: video.url, at: v.currentTime, title, by, color: null });
    if (ok) { v.pause(); sampleFrame(); setNote("the audio keeps playing — the circle in the Info Dock holds it"); }
    else setNote("the browser refused to hand the audio over");
    setTimeout(() => setNote(""), 2200);
  }

  const pipAvailable = typeof document !== "undefined" && (document.pictureInPictureEnabled || (ref.current && ref.current.webkitSetPresentationMode));
  const look = captionAppearance(prefs);
  const pct = dur > 0 ? Math.min(100, (t / dur) * 100) : 0;

  return (
    <div ref={stageRef} className={"motion" + (controls ? " showing" : "") + (handedOver ? " handed" : "")} onPointerMove={poke} onFocusCapture={poke} data-rotation={video.rotation || 0}>
      <video
        ref={ref}
        src={video.url}
        poster={video.poster || undefined}
        playsInline
        preload="metadata"
        crossOrigin={sameOrigin(video.url) ? undefined : "anonymous"}
        aria-label={title || "motion"}
        tabIndex={0}
        onClick={stageTap}
        onKeyDown={stageKey}
      >
        {tracks.map((tr) => <track key={tr.lang} kind="captions" srcLang={tr.lang} label={tr.label || tr.lang} src={trackSrc(tr)} default={tr.lang === lang && cc} />)}
      </video>
      {cc && cue ? <div className="mocue" style={{ fontSize: `${look.fontScale}em`, background: look.background }} aria-live="polite">{cue}</div> : null}
      {note ? <div className="monote" role="status">{note}</div> : null}
      {handedOver ? <div className="mohanded">audio playing in the Info Dock · visuals paused<button type="button" className="txtbtn" onClick={() => { haptic("press"); ref.current.currentTime = player.position; ref.current.play().catch(() => {}); }}>RESUME HERE</button></div> : null}
      {reduced && !playing && t === 0 ? <button type="button" className="mobig" onClick={toggle} aria-label="play"><Icon name="post" size={44} /><span>PLAY · reduced motion, no autoplay</span></button> : null}
      <div className={"mocontrols" + (controls ? "" : " hidden")} role="group" aria-label="video controls" aria-hidden={!controls}>
        <div className="moscrub">
          <input type="range" min={0} max={Math.max(1, dur)} step={0.1} value={Math.min(t, dur || t)} aria-label="seek" aria-valuetext={`${fmt(t)} of ${fmt(dur)}`} onChange={(e) => { const v = ref.current; if (v) v.currentTime = Number(e.target.value); poke(); }} style={{ "--pct": pct + "%" }} />
          <span className="motime">{fmt(t)} / {fmt(dur)}</span>
        </div>
        <div className="morow">
          <button type="button" onClick={() => seek(-SEEK_STEP_S)} aria-label={`back ${SEEK_STEP_S} seconds`}><Icon name="back" size={18} /><span>−{SEEK_STEP_S}</span></button>
          <button type="button" className="moplay" onClick={toggle} aria-label={playing ? "pause" : "play"} aria-pressed={playing}>{playing ? <Icon name="minus" size={20} /> : <Icon name="post" size={20} />}<span>{playing ? "PAUSE" : "PLAY"}</span></button>
          <button type="button" onClick={() => seek(SEEK_STEP_S)} aria-label={`forward ${SEEK_STEP_S} seconds`}><Icon name="back" size={18} className="flip" /><span>+{SEEK_STEP_S}</span></button>
          <button type="button" onClick={() => { const v = ref.current; if (v) { v.muted = !v.muted; setMuted(v.muted); } }} aria-label={muted ? "unmute" : "mute"} aria-pressed={muted}><Icon name={muted ? "close" : "disc"} size={18} /><span>{muted ? "MUTED" : "SOUND"}</span></button>
          {tracks.length ? <button type="button" className={cc ? "on" : ""} onClick={() => { setCc((c) => !c); setMenu((m) => (m === "cc" ? null : m)); }} aria-pressed={cc} aria-label="captions"><b className="moglyph">CC</b><span>{cc ? "ON" : "OFF"}</span></button> : null}
          {tracks.length && cc ? <button type="button" className={menu === "cc" ? "on" : ""} onClick={() => setMenu((m) => (m === "cc" ? null : "cc"))} aria-expanded={menu === "cc"} aria-label="caption language and appearance"><b className="moglyph">Aa</b><span>STYLE</span></button> : null}
          <button type="button" className={menu === "speed" ? "on" : ""} onClick={() => setMenu((m) => (m === "speed" ? null : "speed"))} aria-expanded={menu === "speed"} aria-label="playback speed"><b className="moglyph">{speed}×</b><span>SPEED</span></button>
          <button type="button" className={menu === "quality" ? "on" : ""} onClick={() => setMenu((m) => (m === "quality" ? null : "quality"))} aria-expanded={menu === "quality"} aria-label="quality"><b className="moglyph">HQ</b><span>{prefs.quality.toUpperCase()}</span></button>
          {pipAvailable ? <button type="button" className={pip ? "on" : ""} onClick={pipToggle} aria-pressed={pip} aria-label="picture in picture"><Icon name="feed" size={18} /><span>PIP</span></button> : null}
          <button type="button" onClick={fullscreen} aria-label="full screen"><Icon name="plus" size={18} /><span>FULL</span></button>
          {video.audio ? <button type="button" className={handedOver ? "on" : ""} onClick={keepAudio} aria-label="keep the audio playing while you browse" disabled={handedOver}><Icon name="bell" size={18} /><span>KEEP AUDIO</span></button> : null}
        </div>
        {menu === "speed" ? (
          <div className="momenu" role="group" aria-label="speed">
            {SPEEDS.map((s) => <button key={s} type="button" className={"chip clickable" + (speed === s ? " cur" : "")} aria-pressed={speed === s} onClick={() => { setSpeed(s); setMenu(null); }}>{s}×</button>)}
          </div>
        ) : null}
        {menu === "quality" ? (
          <div className="momenu" role="group" aria-label="quality">
            {QUALITIES.map((q) => <button key={q} type="button" className={"chip clickable" + (prefs.quality === q ? " cur" : "")} aria-pressed={prefs.quality === q} onClick={() => { setMediaPreferences({ quality: q }); setMenu(null); }}>{q.toUpperCase()}</button>)}
            <p className="fine">{QUALITY_NOTE} · {video.width}×{video.height} · {video.codec}</p>
          </div>
        ) : null}
        {menu === "cc" && cc && tracks.length > 1 ? (
          <div className="momenu" role="group" aria-label="caption language">
            {tracks.map((tr) => <button key={tr.lang} type="button" className={"chip clickable" + (lang === tr.lang ? " cur" : "")} aria-pressed={lang === tr.lang} onClick={() => setLang(tr.lang)}>{(tr.label || tr.lang).toUpperCase()}</button>)}
          </div>
        ) : null}
        {menu === "cc" && cc ? (
          <div className="momenu moccprefs" role="group" aria-label="caption appearance">
            <span className="cclbl">SIZE</span>
            {[["S", 0.85], ["M", 1], ["L", 1.3]].map(([l, v]) => <button key={l} type="button" className={"chip clickable" + (Math.abs(prefs.captionSize - v) < 0.01 ? " cur" : "")} onClick={() => setMediaPreferences({ captionSize: v })}>{l}</button>)}
            <span className="cclbl">BACKGROUND</span>
            {[["LOW", 0.3], ["MID", 0.6], ["HIGH", 0.9]].map(([l, v]) => <button key={l} type="button" className={"chip clickable" + (Math.abs(prefs.captionOpacity - v) < 0.01 ? " cur" : "")} onClick={() => setMediaPreferences({ captionOpacity: v })}>{l}</button>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

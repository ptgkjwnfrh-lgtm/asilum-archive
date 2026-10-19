"use client";

// app/upload/page.js — UPLOAD // TEACH ASTERISK (redesign/upload-station).
// A Pinterest-style moodboard station over the warped-in Paris map:
// drop pieces, fit pics, anything that matches the vibe — tiles persist
// on-device and every batch trains through the honest palette-v0
// pipeline. Favorites (celebrities / cities / movies / singers), favorite
// designers (real brand-dominant-tag training, same path as DISCOVER
// follows), and lean-toward styles feed the same brain. (The floating
// plug-in pills — Pinterest / Spotify / Apple Music / Letterboxd — live on
// /board's STAMP THE PASSPORT row now; still honest coming-soon, no fake
// OAuth, ever.)
//
// Honesty per mapping: singers hit the curated music map (descriptors →
// lexicon) and say what Asterisk read; unknown names are RECORDED to the
// bearer's file (real mood_board_uploads rows) and said to be unmapped —
// nothing pretends. Design: Gen X Soft Club (curves, haze, milky glass).
//
// THE STATION IN LIQUID GLASS (owner order, 9 Sep: "more visually pleasing,
// easier to navigate, match the front cover's visual language, more liquid
// glass, replace the asterisk figure with a moveable globe of the
// places bought from"). The page now speaks the cover's language — a bold
// masthead with a right-hand meta block, a hairline field behind the
// content, numbered kickers, Warp-sleeve credit stacks, gutter marginalia
// and a colophon whose every value is real state — and every card is the
// same clear pane as the passport, the strip and the item detail
// (LiquidGlass.jsx: no border, the edges lensing where the engine can bend
// a backdrop, the gloss and the pointer's shine over its face). The rail's
// ASTERISK dock is replaced by THE PURCHASE GLOBE (PurchaseGlobe.jsx): a
// wireframe earth of glowing lines (a hologram), drag to turn, marking the houses' cities
// behind the bearer's PAID orders and BOUGHT tickets (/api/orders?places=1)
// — nothing bought, nothing marked, and the readout says so.

import { useEffect, useRef, useState } from "react";
import { getUid, postJSON, authorizedFetch } from "../../lib/client.js";
import { analyzePalette, mergePalettes } from "../../lib/vision/palette.js";
import { vizState } from "../../lib/brain/memory.js";
import { TAGS } from "../../lib/brain/tags.js";
import { mapArtist } from "../../lib/music-mapping/index.js";
import { setFollowBrand, followedBrands } from "../../lib/social.js";
import PurchaseGlobe from "../components/PurchaseGlobe.jsx";
import ParisMap, { useParisRoads } from "../components/ParisMap.jsx";
import Notice from "../components/Notice.jsx";
import { useLiquidGlass } from "../components/LiquidGlass.jsx";
import { useEscape, useOverlayDismiss } from "../components/dismiss.js";

const BOARD_KEY = "asilum-upload-board";
const FAVS_KEY = "asilum-favorites";
const EMPTY_FAVS = { celebrities: [], cities: [], movies: [], singers: [], styles: [] };

// The hairline field (the cover's, in the station's proportions): a few
// thick, most thin, most barely there. Hand-placed and deterministic —
// print texture, not motion, so no random at render.
const HAIRLINES = ["gxln-h1", "gxln-h2", "gxln-h3", "gxln-h4", "gxln-h5", "gxln-h6", "gxln-v1", "gxln-v2", "gxln-v3", "gxln-v4", "gxln-v5"];

export default function UploadPage() {
  const [uid, setUid] = useState("");
  const [viz, setViz] = useState(null);
  const [notice, setNotice] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState([]);
  const [tiles, setTiles] = useState([]);      // device-local moodboard
  const [favs, setFavs] = useState(EMPTY_FAVS);
  const [designers, setDesigners] = useState([]);
  // THE PURCHASE GLOBE's fix: null = still reading; false = the server could
  // not be reached (never rendered as "nothing bought"); else the record.
  const [places, setPlaces] = useState(null);
  const [stamp, setStamp] = useState("");
  // THE MAP SETTLES BACK (owner, 9 Sep: "when a user opens the upload the
  // background map should lower its current visible opacity by 45% — it's a
  // little distracting"). The first frame keeps the warp's 0.5 so the
  // hand-off from the passport stays pixel-continuous; then the map eases
  // to 0.4 (the owner's number). A direct visit gets the same settle.
  const [mapSettled, setMapSettled] = useState(false);
  const fileRef = useRef(null);
  const map = useParisRoads();
  // arriving from the passport build: reuse its exact fit so the
  // background IS the animation's last frame (no reframe cut). Read
  // synchronously so the first painted frame already matches; direct
  // visits (or a resized window) fall back to the viewport slice fit.
  const [warpFit] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const f = JSON.parse(window.sessionStorage.getItem("asilum-warp-fit"));
      if (
        f && Number.isFinite(f.s) && f.s > 0 &&
        Math.abs(f.vw - window.innerWidth) < 2 &&
        Math.abs(f.vh - window.innerHeight) < 2
      ) return f;
    } catch {}
    return null;
  });
  const [resetOpen, setResetOpen] = useState(false);
  const [resetChecked, setResetChecked] = useState(false);
  useEscape(() => { setResetOpen(false); setResetChecked(false); }, resetOpen);
  const dismissResetSheet = useOverlayDismiss(() => { setResetOpen(false); setResetChecked(false); }, resetOpen);

  async function resetBrain() {
    await postJSON("/api/reset", { user: uid }).catch(() => {});
    setResetOpen(false);
    setResetChecked(false);
    setNotice("recommendation model reset — boards, event history, tickets, and aggregate graph signals remain");
    loadViz();
  }
  function forgotten() {
    if (!viz || !viz.profile || !viz.profile._meta) return [];
    return (viz.profile._meta.forgotten || []).slice(0, 4);
  }

  useEffect(() => {
    const user = getUid();
    setUid(user || "");
    if (user) { loadViz(user); loadPlaces(user); } else setPlaces({ places: [], purchases: 0, placed: 0, unplaced: [] });
    try { setTiles(JSON.parse(window.localStorage.getItem(BOARD_KEY)) || []); } catch {}
    try { setFavs({ ...EMPTY_FAVS, ...(JSON.parse(window.localStorage.getItem(FAVS_KEY)) || {}) }); } catch {}
    setDesigners(followedBrands());
    setStamp(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }).toUpperCase());
    // one painted frame at the warp's opacity, then the settle
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setMapSettled(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  function loadViz(user = uid || getUid()) {
    authorizedFetch("/api/profile?user=" + encodeURIComponent(user))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setViz({ state: vizState(d.profile), profile: d.profile }); })
      .catch(() => {});
  }
  function loadPlaces(user = uid || getUid()) {
    authorizedFetch("/api/orders?places=1&user=" + encodeURIComponent(user))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPlaces(d && Array.isArray(d.places) ? d : false))
      .catch(() => setPlaces(false));
  }
  function convictions() {
    if (!viz) return [];
    return Object.entries(viz.state.weights)
      .filter(([, w]) => Math.abs(w) > 0.01)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 6);
  }
  const hear = (line) => setHeard((h) => [line, ...h].slice(0, 6));
  function saveTiles(next) {
    setTiles(next);
    try { window.localStorage.setItem(BOARD_KEY, JSON.stringify(next)); } catch {}
  }
  function saveFavs(next) {
    setFavs(next);
    try { window.localStorage.setItem(FAVS_KEY, JSON.stringify(next)); } catch {}
  }

  // ---- moodboard tiles: thumbnail for the wall + palette-v0 training ----
  async function thumbOf(file) {
    const bmp = await createImageBitmap(file);
    const scale = 340 / Math.max(bmp.width, bmp.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * Math.min(1, scale)));
    canvas.height = Math.max(1, Math.round(bmp.height * Math.min(1, scale)));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.72);

    // WHAT WAS WRONG (audit resume, Aug 14). The palette was read as
    // getImageData(0, 0, 48, 48) from THIS ~340px canvas — the top-left
    // 48×48 corner, not a downsample. On a 1600×1200 photo that is about
    // 2.7% of the image, always the same corner: a black coat on a white
    // backdrop trained the brain on the backdrop, and /upload then told
    // the user "palette v0 saw white". A crop is not a sample.
    // /board's pixelsFrom() always did this correctly — it sizes the
    // canvas to 48×48 FIRST so drawImage scales the whole image into it.
    // Same shape here, on its own canvas so the thumbnail keeps its size.
    const S = 48;
    const pcan = document.createElement("canvas");
    pcan.width = S; pcan.height = S;
    const pctx = pcan.getContext("2d");
    pctx.drawImage(bmp, 0, 0, S, S);
    const px = pctx.getImageData(0, 0, S, S).data;

    if (bmp.close) bmp.close();
    return { url, px, pxW: S };
  }
  async function ingestFiles(fileList) {
    const files = [...(fileList || [])].filter((f) => /^image\//.test(f.type || ""));
    if (!files.length || !uid || busy) return;
    setBusy(true);
    const words = files.map((f) => f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_.]+/g, " ")).join(" ");
    const analyses = [];
    const newTiles = [];
    for (const f of files.slice(0, 8)) {
      try {
        const { url, px, pxW } = await thumbOf(f);
        const a = analyzePalette(px, 5, pxW);
        if (a) analyses.push(a);
        newTiles.push({ id: (window.crypto?.randomUUID?.() || String(Date.now()) + Math.random()), src: url, name: f.name.slice(0, 80) });
      } catch {}
    }
    const merged = mergePalettes(analyses);
    const paletteWords = [...new Set(analyses.flatMap((a) => [...a.words, ...a.moods]))].slice(0, 14);
    const prompt = [words, paletteWords.join(" ")].filter(Boolean).join(" ").trim();
    if (prompt) await postJSON("/api/train", { user: uid, prompt }).catch(() => {});
    postJSON("/api/moodboard", {
      user: uid, kind: "upload",
      filenames: files.map((f) => f.name.slice(0, 200)),
      palette: merged.palette.map((s) => ({ hex: s.hex, weight: s.weight })),
      uploadId: window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10),
    }).catch(() => {});
    saveTiles([...newTiles, ...tiles].slice(0, 40));
    const seen = [...new Set(merged.palette.map((s) => s.name))].slice(0, 3).join(", ");
    hear(`${files.length} image${files.length > 1 ? "s" : ""}${seen ? " — " + seen : ""}`);
    setNotice(analyses.length
      ? `pinned — palette v0 saw ${seen}; trained on colors + filename words`
      : "pinned — pixels unreadable, trained on the words the files carried");
    setBusy(false);
    loadViz();
  }
  function removeTile(id) {
    saveTiles(tiles.filter((t) => t.id !== id));
  }

  // ---- favorites: recorded always, trained where a real mapping exists ----
  async function addFav(kind, raw) {
    const name = raw.trim();
    if (!name || !uid) return;
    if ((favs[kind] || []).some((x) => x.toLowerCase() === name.toLowerCase())) return;
    saveFavs({ ...favs, [kind]: [...(favs[kind] || []), name] });
    // Every favorite is a REAL record on the bearer's file.
    postJSON("/api/moodboard", { user: uid, kind: "text", prompt: `favorite ${kind.replace(/s$/, "")}: ${name}` }).catch(() => {});
    if (kind === "singers") {
      // mapArtist returns the ai-contract envelope: {ok, data:{tags, descriptors}}.
      const hit = mapArtist(name);
      const descriptors = hit?.ok ? hit.data?.descriptors || [] : [];
      if (descriptors.length) {
        await postJSON("/api/train", { user: uid, prompt: descriptors.join(" ") }).catch(() => {});
        hear(`${name} → ${descriptors.slice(0, 3).join(" · ")}`);
        setNotice(`asterisk knows ${name} — trained on ${descriptors.slice(0, 4).join(", ")}`);
        loadViz();
        return;
      }
    }
    if (kind === "styles") {
      await postJSON("/api/train", { user: uid, prompt: name.toLowerCase() }).catch(() => {});
      hear(name.toLowerCase());
      setNotice(`leaned into ${name.toLowerCase()}`);
      loadViz();
      return;
    }
    // No curated mapping yet (celebrities / cities / movies / unknown
    // singers): try the words through the lexicon anyway, and say the truth.
    postJSON("/api/train", { user: uid, prompt: name.toLowerCase() }).catch(() => {});
    hear(`${name} (on file)`);
    setNotice(`${name} is on your record — the culture catalog maps it as coverage grows`);
    loadViz();
  }
  function removeFav(kind, name) {
    saveFavs({ ...favs, [kind]: (favs[kind] || []).filter((x) => x !== name) });
  }

  // ---- designers: the real brand path — follow + dominant-tag training ----
  async function addDesigner(raw) {
    const name = raw.trim();
    if (!name || !uid) return;
    const res = await authorizedFetch("/api/search?q=" + encodeURIComponent(name) + "&brain=0").catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    const brand = (d?.brands || []).find((b) => b.toLowerCase() === name.toLowerCase()) || (d?.brands || [])[0];
    if (!brand) {
      setNotice(`${name} isn't in the archive yet — nothing trained, nothing pretended`);
      return;
    }
    setDesigners(setFollowBrand(brand, true));
    const w = {};
    for (const it of d.items || []) {
      if (it.brand !== brand) continue;
      for (const [t, v] of Object.entries(it.tags || {})) w[t] = (w[t] || 0) + v;
    }
    const topTags = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t.toLowerCase());
    if (topTags.length) await postJSON("/api/train", { user: uid, prompt: topTags.join(" ") }).catch(() => {});
    hear(`${brand} → ${topTags.slice(0, 3).join(" · ") || "followed"}`);
    setNotice(`following ${brand}${topTags.length ? ` — trained on ${topTags.join(", ")}` : ""}`);
    loadViz();
  }
  function removeDesigner(brand) {
    setDesigners(setFollowBrand(brand, false));
  }

  const names = favs.celebrities.length + favs.singers.length + favs.cities.length + favs.movies.length;
  const placeRows = places && places.places ? places.places : [];

  return (
    <div className="wrap gx gxv2">
      {map && (
        <div className={"gxmap" + (mapSettled ? " settled" : "")} aria-hidden="true">
          {warpFit ? (
            <div
              className="gxmapfit"
              style={{
                left: warpFit.tx, top: warpFit.ty,
                width: map.w * warpFit.s, height: map.h * warpFit.s,
              }}
            >
              <ParisMap map={map} hot />
            </div>
          ) : (
            <ParisMap map={map} hot />
          )}
        </div>
      )}
      <div className="gxblob gxb1" aria-hidden="true" />
      <div className="gxblob gxb2" aria-hidden="true" />
      <div className="gxlines" aria-hidden="true">
        {HAIRLINES.map((c) => <i key={c} className={c} />)}
      </div>

      <header className="gxmast" aria-label="upload station masthead">
        <div className="locline"><a href="/board">← PASSPORT</a><span>/ TEACH ASTERISK</span></div>
        <div className="gxmastrow">
          <h1 className="gxmastblock">
            <span className="gxmastline"><b className="red">*</b>UPLOAD</span>
            <span className="gxmastline gxmastsub">STATION</span>
          </h1>
          <div className="gxmeta">
            TRAINING ANNEX · {stamp}<br />PIN · NAME · FOLLOW — THE ASTERISK SYSTEM ANSWERS IN THE RAIL
            <span className="gxledger">
              THE RECORD — {tiles.length} PIN{tiles.length === 1 ? "" : "S"} · {names} NAME{names === 1 ? "" : "S"} · {designers.length} HOUSE{designers.length === 1 ? "" : "S"} FOLLOWED · {placeRows.length} CIT{placeRows.length === 1 ? "Y" : "IES"} BOUGHT FROM
            </span>
          </div>
        </div>
        <i className="gxthick" aria-hidden="true" />
      </header>
      {notice && <Notice variant="banner" onDismiss={() => setNotice("")}>{notice}</Notice>}

      <div className="gxlayout">
        <main className="gxmain">
          <GlassCard id="wall" glass="lg-gx-wall" num="01" kick="THE WALL" note="pin anything that feels like you">
            <div
              className={"gxdrop slim" + (dragOver ? " over" : "") + (busy ? " busy" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); ingestFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current && fileRef.current.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") fileRef.current?.click(); }}
            >
              <span className="gxdropmark">⇪</span>
              <b>{busy ? "reading the pixels…" : "drop pieces, fit pics, anything with the vibe"}</b>
              <em>palette v0 reads the colors; filename words teach too. pins stay on this device.</em>
            </div>
            <input aria-label="upload images to the moodboard" ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { ingestFiles(e.target.files); e.target.value = ""; }} />
            {tiles.length > 0 && (
              <div className="gxwall">
                {tiles.map((t) => (
                  <figure className="gxtile" key={t.id}>
                    <img src={t.src} alt={t.name} />
                    <button className="gxtilex" title="unpin" onClick={() => removeTile(t.id)}>×</button>
                  </figure>
                ))}
              </div>
            )}
          </GlassCard>

          <GlassCard id="people" glass="lg-gx-people" num="02" kick="YOUR PEOPLE & PLACES" note="name what shapes you">
            <div className="gxfavgrid">
              <FavField kind="celebrities" label="FAVORITE CELEBRITIES" placeholder="whose style pulls you…" favs={favs} onAdd={addFav} onRemove={removeFav} />
              <FavField kind="singers" label="FAVORITE SINGERS" placeholder="the sound you dress like…" favs={favs} onAdd={addFav} onRemove={removeFav} />
              <FavField kind="cities" label="FAVORITE CITIES" placeholder="where you feel dressed right…" favs={favs} onAdd={addFav} onRemove={removeFav} />
              <FavField kind="movies" label="FAVORITE MOVIES" placeholder="films that look like your closet…" favs={favs} onAdd={addFav} onRemove={removeFav} />
            </div>
            <em className="gxfoot">every name lands on your record. where the culture catalog knows them, the Asterisk system trains — and tells you what it read.</em>
          </GlassCard>

          <GlassCard id="designers" glass="lg-gx-designers" num="03" kick="DESIGNERS & LEANINGS" note="the houses you follow, the words you lean toward">
            <FavInput label="FAVORITE DESIGNERS" placeholder="type a designer — the Asterisk system learns their dominant tags…" onAdd={addDesigner} />
            {designers.length > 0 && (
              <div className="gxchips" style={{ marginBottom: 14 }}>
                {designers.map((b) => (
                  <span className="gxchip on" key={b}>{b} <button type="button" className="gxchipx" aria-label={"remove " + b} onClick={() => removeDesigner(b)}>×</button></span>
                ))}
              </div>
            )}
            <FavInput label="STYLES YOU LEAN TOWARD" placeholder="washed black, y2k, gorpcore, quiet tailoring…" onAdd={(v) => addFav("styles", v)} />
            {favs.styles.length > 0 && (
              <div className="gxchips" style={{ marginBottom: 14 }}>
                {favs.styles.map((s) => (
                  <span className="gxchip on" key={s}>{s} <button type="button" className="gxchipx" aria-label={"remove " + s} onClick={() => removeFav("styles", s)}>×</button></span>
                ))}
              </div>
            )}
            <div className="gxchips">
              {TAGS.map((t) => (
                <button key={t} className="gxchip" onClick={() => addFav("styles", t.toLowerCase())}>{t.toLowerCase()}</button>
              ))}
            </div>
          </GlassCard>
        </main>

        <aside className="gxside">
          <GlassCard id="globe" glass="lg-gx-globe" num="04" kick="THE GLOBE" note="where your pieces came from" className="gxasterisk">
            <span className="gxsidev" aria-hidden="true">THE HOUSES' CITIES BEHIND WHAT YOU BOUGHT</span>
            <PurchaseGlobe places={placeRows} />

            {places === false ? (
              <em className="gxfoot">the purchase record could not be reached — the globe shows nothing until it can.</em>
            ) : places && placeRows.length > 0 ? (
              <div className="gxplaces">
                {placeRows.slice(0, 6).map((p, i) => (
                  <div className="gxplace" key={p.city}>
                    <span className="gxpnum" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                    <b>{p.city.toUpperCase()}<i>{p.country.toUpperCase()} · {p.brands.join(" · ").toUpperCase()}</i></b>
                    <em>{p.count}</em>
                  </div>
                ))}
              </div>
            ) : places ? (
              <em className="gxfoot">no purchase on the record yet — a paid order, or a ticket you report as bought, puts its house&apos;s city on the globe.</em>
            ) : null}
            {places && places.unplaced && places.unplaced.length > 0 && (
              <em className="gxfoot">
                not placed — {places.unplaced.join(", ")}: the origin record does not hold a city for {places.unplaced.length === 1 ? "this house" : "these houses"}, so nothing is guessed.
              </em>
            )}

            <div className="gxcred" aria-label="the record's credits">
              <span className="cclbl">RECORD No.</span>
              <span className="ccval">{uid ? uid.slice(0, 12).toUpperCase() : "—"}</span>
              <span className="cclbl">PIECES PLACED</span>
              <span className="ccval">{places && places.placed != null ? `${places.placed} OF ${places.purchases}` : "—"}</span>
              <span className="cclbl">CONVICTIONS HELD</span>
              <span className="ccval">{convictions().length}</span>
            </div>

            <div className="gxlabel" style={{ margin: "16px 0 12px" }}>WHAT THE ASTERISK SYSTEM HOLDS</div>
            {convictions().length === 0 ? (
              <em className="gxfoot">nothing yet — the record starts with your first pin.</em>
            ) : (
              <div className="gxread">
                {convictions().map(([tag, w]) => (
                  <div className="gxconv" key={tag}>
                    <span>{tag.toLowerCase()}</span>
                    <div className="gxbar"><i style={{ width: Math.min(100, Math.abs(w) * 100) + "%" }} /></div>
                    <b>{Math.round(Math.abs(w) * 100)}</b>
                  </div>
                ))}
              </div>
            )}
            {heard.length > 0 && (
              <div className="gxheard">
                <span className="gxlabel">HEARD THIS SESSION</span>
                {heard.map((h, i) => <em key={i}>· {h}</em>)}
              </div>
            )}
            {forgotten().length > 0 && (
              <div className="gxheard">
                <span className="gxlabel">RECENTLY FORGOTTEN</span>
                {forgotten().map((f, i) => <em key={i}>· {f.tag.toLowerCase()} — let go</em>)}
              </div>
            )}
            <div className="gxrow gxlinks">
              <a className="gxbtn ghost" href="/board">PASSPORT →</a>
              <a className="gxbtn ghost" href="/stats">FULL READ →</a>
              <a className="gxbtn ghost" href="/orders">ORDERS →</a>
            </div>
            <button className="resetlink" onClick={() => setResetOpen(true)}>
              Reset Brain <b>[Full Amnesia]</b>
            </button>
          </GlassCard>
        </aside>
      </div>

      <footer className="gxcolo" aria-label="colophon">
        *ASILUM TRAINING ANNEX · {stamp} · {tiles.length} PIN{tiles.length === 1 ? "" : "S"} ON THIS DEVICE · {placeRows.length} CIT{placeRows.length === 1 ? "Y" : "IES"} ON THE GLOBE · EVERY VALUE ON THIS PAGE IS REAL STATE — NOTHING IS STAGED
      </footer>

      {resetOpen && (
        <div className="overlay" onClick={dismissResetSheet}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <button className="mclose" aria-label="close" onClick={() => { setResetOpen(false); setResetChecked(false); }}>×</button>
            <h2>Full amnesia<span style={{ color: "var(--red)" }}>.</span></h2>
            <p className="deck">
              this permanently deletes your taste profile — every conviction,
              streak, and forgetting log. your moodboards, orders, and the
              shared taste graph survive. there is no undo.
            </p>
            <label className="toggle" style={{ margin: "10px 0 18px" }}>
              <input type="checkbox" checked={resetChecked} onChange={(e) => setResetChecked(e.target.checked)} />
              I understand this deletes my taste profile
            </label>
            <div className="controls">
              <button className="btn" disabled={!resetChecked} onClick={resetBrain}>
                ERASE EVERYTHING THE BRAIN KNOWS
              </button>
              <button className="btn ghost" onClick={() => { setResetOpen(false); setResetChecked(false); }}>
                keep my taste
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A section of the station: a numbered kicker (the cover's) over a pane of
// liquid glass (the passport's — LiquidGlass.jsx keeps its refraction map in
// step with its size and carries the pointer's shine). One filter id per
// pane, because each map is its own size.
function GlassCard({ id, glass, num, kick, note, className = "", children }) {
  const ref = useRef(null);
  const defs = useLiquidGlass(ref, { id: glass, strength: 0.5 });
  return (
    <section className={"gxcard lg " + className} id={id} ref={ref} aria-label={`${num} ${kick.toLowerCase()}`}>
      {defs}
      <div className="gxhead">
        <span className="gxnum" aria-hidden="true">{num}</span>
        <div>
          <div className="gxkick">{kick}</div>
          {note && <div className="gxnote">{note}</div>}
        </div>
      </div>
      {children}
    </section>
  );
}

// A labelled add-input with its chip list — favorites fields share one form.
function FavField({ kind, label, placeholder, favs, onAdd, onRemove }) {
  return (
    <div className="gxfav">
      <FavInput label={label} placeholder={placeholder} onAdd={(v) => onAdd(kind, v)} />
      {(favs[kind] || []).length > 0 && (
        <div className="gxchips">
          {favs[kind].map((n) => (
            <span className="gxchip on" key={n}>{n} <button type="button" className="gxchipx" aria-label={"remove " + n} onClick={() => onRemove(kind, n)}>×</button></span>
          ))}
        </div>
      )}
    </div>
  );
}

function FavInput({ label, placeholder, onAdd }) {
  const [value, setValue] = useState("");
  const submit = () => { if (value.trim()) { onAdd(value); setValue(""); } };
  return (
    <div className="gxfavinput">
      <span className="gxlabel">{label}</span>
      <div className="gxrow" style={{ margin: 0 }}>
        <input
          className="gxin"
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <button className="gxbtn" onClick={submit} disabled={!value.trim()}>ADD ✓</button>
      </div>
    </div>
  );
}

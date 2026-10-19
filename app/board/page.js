"use client";

// app/board/page.js — THE PASSPORT (Live Launch V.2).
// The person's home, archive and command centre, in four tabs under the
// document: COLLECTION (everything the one save kept — pieces, posts, people,
// places, events — plus the moodboards and the training station), FULL READ
// (the taste network), PLACES (the local and global map and the location
// controls) and STUDIO (the business tools on the same account). Opened with
// ?id=<boardId> it still shows anyone's board read-only with FOLLOW.
//
// Milestones are STAMPS for real acts (first collection, taste defined,
// first transmission) — there is no streak and no timer.

import { openSheet } from "../../lib/dockstate.js";
import BehindUploads from "../components/BehindUploads.jsx";
import AttendanceBlock from "../components/AttendanceBlock.jsx";
import { ScoreLine } from "../components/ScoreSheet.jsx";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Notice from "../components/Notice.jsx";
import { getUid, postJSON, sendJSON, authorizedFetch, thumbFor, safeExternalUrl, aspectFor } from "../../lib/client.js";
import { analyzePalette, mergePalettes } from "../../lib/vision/palette.js";
import { readStamps } from "../../lib/vision/stampReading.js";
import { vizState } from "../../lib/brain/memory.js";
import PassportSecurity from "../components/PassportSecurity.jsx";
import buildRoads, { primeRoads } from "../components/roadBuilder.js";
import { useParisRoads, useRoads } from "../components/ParisMap.jsx";
import { getProfileInfo } from "../../lib/social.js";
import { tasteClass } from "../../lib/brain/taste-class.js";
import { convictionsOf, mrzLines, sinceDisplay as formatSince } from "../../lib/passport/document.js";
import { MrzTint } from "../components/PassportPreview.jsx";
import { ColorEvidenceLine, OriginLine, OriginSticker, ProductFitLine, useFitBrain } from "../components/ProductSignals.jsx";
import { useLiquidGlass } from "../components/LiquidGlass.jsx";
import PageMast from "../components/PageMast.jsx";
import TasteNetwork from "../components/TasteNetwork.jsx";
import PlacesPanel from "../components/PlacesPanel.jsx";
import Studio from "../components/Studio.jsx";
import ModelTag from "../components/ModelTag.jsx";
import { listSaves, unsave, saveCounts } from "../../lib/save.js";
import AddStamp from "../components/AddStamp.jsx";
import { getLocation, basedInLine, confirmBaseCity, setLocation } from "../../lib/location.js";

const TABS = [
  { id: "collection", label: "COLLECTION" },
  { id: "fullread", label: "FULL READ" },
  { id: "places", label: "PLACES" },
  { id: "studio", label: "STUDIO" },
];
const SAVE_FILTERS = [["all", "ALL"], ["piece", "PIECES"], ["post", "POSTS"], ["person", "PEOPLE"], ["place", "PLACES"], ["event", "EVENTS"]];

export default function BoardPage() {
  const fit = useFitBrain();
  const [uid, setUid] = useState(null);
  const [boards, setBoards] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [shared, setShared] = useState(null); // read-only board from ?id=
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState("");
  const [following, setFollowing] = useState(false);
  const [trainText, setTrainText] = useState("");
  const [viz, setViz] = useState(null);
  const fileRef = useRef(null);
  const photoRef = useRef(null);
  const [ppPhoto, setPpPhoto] = useState(null);
  const [pinfo, setPinfo] = useState({ name: "", handle: "", since: "", origin: "" });
  const [ticketCount, setTicketCount] = useState(0);
  const [tab, setTab] = useState("collection");
  const [saves, setSaves] = useState([]);
  const [saveFilter, setSaveFilter] = useState("all");
  const [hasTransmission, setHasTransmission] = useState(false);
  const [loc, setLoc] = useState(null);
  const router = useRouter();
  const warpRef = useRef(null);
  const ppRef = useRef(null);
  const ppGlass = useLiquidGlass(ppRef, { id: "lg-passport", strength: 0.5, bend: ".ppwash-under" });
  const parisMap = useParisRoads();
  // THE READER'S OWN STREETS (V.2 round two): the document's map is the
  // area around the confirmed base city — first suggested from the
  // connection's address (/api/geo), the browser's own location as the
  // fallback, a city picker after that. Paris stands in only until a
  // centre exists.
  const centre = loc && loc.baseCity && Number.isFinite(loc.baseCity.lat) ? { lat: loc.baseCity.lat, lng: loc.baseCity.lng, label: loc.baseCity.name } : null;
  const roads = useRoads(centre);
  const docMap = roads.map;
  const [geoNote, setGeoNote] = useState("");
  useEffect(() => { if (docMap) primeRoads(docMap); }, [docMap]);
  useEffect(() => {
    // one suggestion per device: the connection's city area, confirmed by
    // being shown (CHANGE sits beside it); never a street, never stored raw
    const current = getLocation();
    if (current.baseCity) return;
    let asked = false;
    try { asked = window.localStorage.getItem("asilum-geo-asked") === "1"; } catch {}
    if (asked) return;
    fetch("/api/geo").then((r) => (r.ok ? r.json() : null)).then((g) => {
      try { window.localStorage.setItem("asilum-geo-asked", "1"); } catch {}
      if (g && g.located) {
        const name = [g.city, g.region].filter(Boolean).join(", ") || "your area";
        setLocation({ baseCity: { name, lat: g.lat, lng: g.lng, country: g.country || "", region: g.region || null, tz: null, detected: true }, confirmedAt: new Date().toISOString() });
        setGeoNote(`your base city was read from this connection's address — ${name}. change it below if that is wrong.`);
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = +pos.coords.latitude.toFixed(2), lng = +pos.coords.longitude.toFixed(2);
            setLocation({ baseCity: { name: "your area", lat, lng, country: "", region: null, tz: null, detected: true }, confirmedAt: new Date().toISOString() });
            setGeoNote("your base city was read from this device's location (about a kilometre). change it below if that is wrong.");
          },
          () => setGeoNote("no location could be read — choose a base city under PLACES and your streets appear here."),
          { enableHighAccuracy: false, maximumAge: 600000, timeout: 8000 },
        );
      } else setGeoNote("no location could be read — choose a base city under PLACES and your streets appear here.");
    }).catch(() => {});
  }, []);

  function warpToUpload() {
    const doc = document.querySelector(".ppdoc");
    const overlay = warpRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const m = docMap || parisMap;
    if (!doc || !overlay || !m || reduced) { router.push("/upload"); return; }
    buildRoads(overlay, m, doc.getBoundingClientRect(), () => router.push("/upload"));
  }

  function switchTab(id) {
    setTab(id);
    try {
      const url = new URL(window.location.href);
      if (id === "collection") url.searchParams.delete("tab"); else url.searchParams.set("tab", id);
      window.history.replaceState(null, "", url.toString());
    } catch {}
  }

  useEffect(() => {
    try { setPpPhoto(window.localStorage.getItem("asilum-pp-photo") || null); } catch {}
    try {
      const info = getProfileInfo();
      let since = window.localStorage.getItem("asilum-member-since");
      if (!since) {
        const now = new Date();
        since = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        window.localStorage.setItem("asilum-member-since", since);
      }
      const locale = navigator.language || "";
      const region = (locale.split("-")[1] || "").toUpperCase();
      setPinfo({ name: info.name, handle: info.handle, since, origin: region || "—", area: new Date().getTimezoneOffset() });
    } catch {}
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t && TABS.some((x) => x.id === t)) setTab(t);
    } catch {}
    const syncSaves = () => setSaves(listSaves());
    const syncLoc = () => setLoc(getLocation());
    syncSaves(); syncLoc();
    window.addEventListener("asilum:save", syncSaves);
    window.addEventListener("asilum:location", syncLoc);
    authorizedFetch("/api/tickets?user=" + encodeURIComponent(getUid() || ""))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setTicketCount(Array.isArray(d.tickets) ? d.tickets.length : 0); })
      .catch(() => {});
    authorizedFetch("/api/editorial?mine=1&limit=1&user=" + encodeURIComponent(getUid() || ""))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.posts)) setHasTransmission(d.posts.length > 0); })
      .catch(() => {});
    return () => { window.removeEventListener("asilum:save", syncSaves); window.removeEventListener("asilum:location", syncLoc); };
  }, []);

  useEffect(() => {
    const user = getUid();
    setUid(user);
    // V.2 14.11 (slice 10c): on first opening, the Passport asks its five to
    // seven questions in a popup — once per session until they are answered
    // or skipped; LATER keeps the place
    if (user) {
      let asked = false;
      try { asked = !!window.sessionStorage.getItem("asilum-onboarding-asked"); } catch {}
      if (!asked && !new URLSearchParams(window.location.search).get("id")) {
        authorizedFetch("/api/passport/onboarding?user=" + encodeURIComponent(user)).then((r) => (r.ok ? r.json() : null)).then((d) => {
          if (d && d.progress && !d.progress.done) { try { window.sessionStorage.setItem("asilum-onboarding-asked", "1"); } catch {} openSheet("onboarding"); }
        }).catch(() => {});
      }
    }
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get("id");
    if (id) {
      authorizedFetch("/api/boards?id=" + encodeURIComponent(id) + "&viewer=" + encodeURIComponent(user))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) { loadMine(user); return; }
          if (d.board && !d.owned) { setShared(d.board); return; }
          loadMine(user, d.board ? d.board.id : null);
        })
        .catch(() => loadMine(user));
    } else {
      loadMine(user);
    }
  }, []);

  function loadMine(user, focusId = null) {
    authorizedFetch("/api/boards?user=" + encodeURIComponent(user))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const bs = d.boards || [];
        setBoards(bs);
        setActiveId(focusId || (bs[0] && bs[0].id) || null);
      })
      .catch(() => {});
  }

  const active = boards.find((b) => b.id === activeId) || null;

  async function removeItem(itemId) {
    if (!active) return;
    const res = await sendJSON("DELETE", "/api/boards", { user: uid, boardId: active.id, itemId });
    if (!res.ok) return;
    const d = await res.json();
    if (d.board) setBoards((prev) => prev.map((b) => (b.id === d.board.id ? d.board : b)));
  }
  async function rename(name) {
    if (!active || !name.trim()) return;
    const res = await sendJSON("PATCH", "/api/boards", { user: uid, boardId: active.id, name: name.trim() });
    if (!res.ok) return;
    const d = await res.json();
    if (d.board) setBoards((prev) => prev.map((b) => (b.id === d.board.id ? d.board : b)));
  }
  async function createNew() {
    const name = newName.trim() || "moodboard";
    const res = await postJSON("/api/boards", { user: uid, name });
    if (!res.ok) return;
    const d = await res.json();
    if (d.board) { setBoards((prev) => [...prev, d.board]); setActiveId(d.board.id); setNewName(""); }
  }
  async function copyShare(board) {
    const url = window.location.origin + "/?board=" + encodeURIComponent(board.id);
    try { await navigator.clipboard.writeText(url); setNotice("share link copied — it seeds the feed of whoever opens it"); } catch {}
  }

  // ---- The training station ----
  function loadViz(user = uid || getUid()) {
    authorizedFetch("/api/profile?user=" + encodeURIComponent(user))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setViz({ state: vizState(d.profile), profile: d.profile }); })
      .catch(() => {});
  }
  useEffect(() => { if (uid) loadViz(uid); }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  async function train() {
    if (!trainText.trim()) return;
    await postJSON("/api/train", { user: uid, prompt: trainText.trim() }).catch(() => {});
    postJSON("/api/moodboard", { user: uid, kind: "text", prompt: trainText.trim() }).catch(() => {});
    setNotice(`the brain read “${trainText.trim()}” — convictions updated`);
    setTrainText("");
    loadViz();
  }
  const [recognized, setRecognized] = useState([]);
  async function pixelsFrom(file) {
    const bmp = await createImageBitmap(file);
    const size = 48;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0, size, size);
    if (bmp.close) bmp.close();
    return ctx.getImageData(0, 0, size, size).data;
  }
  async function onUpload(e) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setRecognized([]);
    const words = files.map((f) => f.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_.]+/g, " ")).join(" ");
    const analyses = [];
    for (const f of files.slice(0, 6)) {
      try { const a = analyzePalette(await pixelsFrom(f), 5, 48); if (a) analyses.push(a); } catch {}
    }
    const stamps = await readStamps(files.slice(0, 6));
    const merged = mergePalettes(analyses);
    const paletteWords = [...new Set(analyses.flatMap((a) => [...a.words, ...a.moods]))].slice(0, 14);
    const prompt = [words, paletteWords.join(" ")].filter(Boolean).join(" ").trim();
    if (prompt) await postJSON("/api/train", { user: uid, prompt }).catch(() => {});
    postJSON("/api/moodboard", {
      user: uid, kind: "upload",
      filenames: files.map((f) => f.name.slice(0, 200)),
      palette: merged.palette.map((s) => ({ hex: s.hex, weight: s.weight })),
      stamps,
      uploadId: window.crypto?.randomUUID ? window.crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10),
    })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => { if (d && d.recognized?.length) setRecognized(d.recognized); try { window.dispatchEvent(new CustomEvent("asilum:upload")); } catch {} })
      .catch(() => {});
    const seen = [...new Set(merged.palette.map((s) => s.name))].slice(0, 3).join(", ");
    setNotice(analyses.length
      ? `${files.length} image${files.length > 1 ? "s" : ""} read — palette v0 saw ${seen}; trained on colors + filename words`
      : `${files.length} image${files.length > 1 ? "s" : ""} queued — pixels unreadable, trained on the words they carried`);
    e.target.value = "";
    loadViz();
  }

  function convictions() { return viz ? convictionsOf(viz.state.weights) : []; }
  async function toggleFollow(board) {
    const next = !following;
    setFollowing(next);
    try {
      await postJSON("/api/follow", { user: uid, boardId: board.id, follow: next });
      setNotice(next ? "following — this board now shapes your feed" : "unfollowed — its influence fades from your feed");
    } catch { setFollowing(!next); }
  }

  const view = shared || active;

  function onPassportPhoto(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { setPpPhoto(rd.result); try { window.localStorage.setItem("asilum-pp-photo", rd.result); } catch {} };
    rd.readAsDataURL(f);
    e.target.value = "";
  }

  const sinceDisplay = formatSince(pinfo.since);
  const pinCount = boards.reduce((s, b) => s + ((b.items && b.items.length) || 0), 0);
  const { top: mrzTop, bottom: mrzBot } = mrzLines({ uid, name: pinfo.name, since: pinfo.since, pinCount, ticketCount, areaCode: pinfo.area || 0 });
  const mrzTint = (line) => <MrzTint line={line} />;
  const counts = saveCounts();
  const otherSaves = saves.filter((s) => s.kind !== "piece" && (saveFilter === "all" || s.kind === saveFilter));
  const showPieces = saveFilter === "all" || saveFilter === "piece";
  const stamps = [
    { id: "collection", label: "FIRST COLLECTION", earned: pinCount > 0 || counts.total > 0, glyph: "✳" },
    { id: "taste", label: "TASTE DEFINED", earned: convictions().length >= 3, glyph: "◇" },
    { id: "transmission", label: "FIRST TRANSMISSION", earned: hasTransmission, glyph: "↗" },
  ];
  const basedIn = loc ? basedInLine(loc, "me") : null;

  return (
    <div className="wrap ppage">
      <div className="ppwarp" ref={warpRef} aria-hidden="true" />
      <header className="cthead">
        <PageMast word="PASSPORT" sub={shared ? "SOMEONE'S TASTE" : "YOUR ARCHIVE · YOUR TASTE · YOUR PLANS"} />
      </header>

      {!shared && (
        <div className="ppdoc lg" ref={ppRef} aria-label="passport document">
          {ppGlass}
          <div className="ppsec"><span className="ppnum">№ AS·{String(boards.length).padStart(2, "0")}·{String(convictions().length).padStart(2, "0")}</span></div>
          <div className="ppnation">ASILUM <b>*</b> FASHION PASSPORT</div>
          <div className="ppbody">
            <div className="ppphotocol">
              <span className="ppquad"><b>PASSPORT</b><span>パスポート</span><span>REISEPASS</span><span>PASSEPORT</span></span>
              <button className="ppphoto" title="add a bearer photo (stays on this device)" onClick={() => photoRef.current && photoRef.current.click()}>
                {ppPhoto ? <img src={ppPhoto} alt="bearer" /> : <span className="ppphotoempty">◉<em>⇪ ADD PHOTO</em></span>}
              </button>
            </div>
            <input ref={photoRef} type="file" accept="image/*" hidden aria-label="upload a passport photo" onChange={onPassportPhoto} />
            <dl className="ppid">
              <div><dt>TYPE<em>/ Type</em></dt><dd>P</dd></div>
              <div><dt>CODE<em>/ Code</em></dt><dd>ASM</dd></div>
              <div><dt>ACCOUNT NO<em>/ № de compte</em></dt><dd className="ppmono">{uid || "—"}</dd></div>
              <div className="sp3"><dt>USERNAME<em>/ Nom</em></dt><dd>{(pinfo.name || "UNNAMED READER").toUpperCase()} <span className="ppmono">{pinfo.handle}</span></dd></div>
              <div className="sp3"><dt>CLASS<em>/ Classe</em></dt><dd>{uid && uid.startsWith("sb-") ? "AUTHENTICATED ACCOUNT" : "DEVICE IDENT"}</dd></div>
              <div><dt>MEMBER SINCE<em>/ Membre depuis</em></dt><dd>{sinceDisplay}</dd></div>
              <div><dt>BASED IN<em>/ Basé à</em></dt><dd>{loc && loc.baseCity ? loc.baseCity.name : "—"}{loc && loc.baseCity && !basedIn ? <span className="ppmono"> PRIVATE</span> : null}</dd></div>
              <div><dt>COUNTRY OF ORIGIN<em>/ Pays</em></dt><dd>{pinfo.origin}</dd></div>
              <div><dt>TASTE CLASS<em>/ Classe de goût</em></dt><dd><span className="red">*</span> {tasteClass(convictions())}</dd></div>
              <div className="sp2"><dt>AUTHORITY<em>/ Autorité</em></dt><dd><span className="red">*</span>ASTERISK — PERSONALIZED FASHION TERMINAL</dd></div>
              <div><dt>SAVED</dt><dd>{pinCount + (counts.total - counts.piece)}</dd></div>
              <div className="sp2"><dt>CONVICTIONS</dt><dd>{convictions().length} ACTIVE</dd></div>
            </dl>
          </div>
          {/* THE OG DOCUMENT (owner, 18 Oct 2026: "the og passport design should
              transfer over 90% accurately" — iteration 5, 25 Jul, 7db2b89): the
              data page, then the hologram window, the microprint, and the
              machine zone at the FOOT of the document */}
          <PassportSecurity topTag={convictions()[0]?.[0]} topWeight={convictions()[0]?.[1] || 0} map={docMap} />
          <div className="ppmrz">{mrzTint(mrzTop)}<br />{mrzTint(mrzBot)}</div>
          <div className="ppdocacts">
            <button className="ppbtn" onClick={() => switchTab("places")}>OPEN MAP</button>
            <button className="ppbtn primary" onClick={warpToUpload}>STAMP PASSPORT</button>
          </div>
        </div>
      )}
      {geoNote && !shared && <p className="ppgeonote">{geoNote} <button className="txtbtn" onClick={() => { setGeoNote(""); switchTab("places"); }}>CHANGE →</button></p>}

      {notice && <Notice variant="banner" onDismiss={() => setNotice("")}>{notice}</Notice>}

      {!shared && (
        <>
          <nav className="pptabs seg" aria-label="passport sections">
            {TABS.map((t) => (
              <button key={t.id} className={"tab" + (tab === t.id ? " cur" : "")} aria-pressed={tab === t.id} onClick={() => switchTab(t.id)}>{t.label}</button>
            ))}
          </nav>
        </>
      )}

      {/* ================= COLLECTION ================= */}
      {(shared || tab === "collection") && (
        <>
          {!shared && (
          <section className="ppworld card" aria-label="what you have built">
            <div className="ppledger">
              <span><b>{String(pinCount + (counts.total - counts.piece)).padStart(2, "0")}</b>saved</span>
              <span><b>{String(convictions().length).padStart(2, "0")}</b>taste branches</span>
              <span><b>{String(stamps.filter((s) => s.earned).length).padStart(2, "0")}</b>stamps</span>
              <span><b>{String(boards.length).padStart(2, "0")}</b>boards</span>
            </div>
            <div className="ppstamps">
              {stamps.map((s) => (
                <span key={s.id} className={"ppstamp" + (s.earned ? " earned" : "")} title={s.earned ? "earned" : "not yet"}>
                  <i aria-hidden="true">{s.glyph}</i>{s.label}
                </span>
              ))}
              <span className="ppstampnote">stamps mark things you make and keep. no timer, no streak to lose.</span>
            </div>
          </section>
          )}
          {/* V.2 §11: ADD STAMP — the one housing for places, artists,
              designers/houses and passengers, with a preview before
              confirmation and an undo after. Images and Wire posts are
              stamped where they are seen and listed above. */}
          {!shared && <AddStamp onStamped={() => setSaves(listSaves())} />}
          {!shared && (
            <>
              <div className="fmodes ppfilters seg">
                {SAVE_FILTERS.map(([k, l]) => (
                  <button key={k} className={"fmode" + (saveFilter === k ? " cur" : "")} onClick={() => setSaveFilter(k)}>
                    {l}{k !== "all" && counts[k] + (k === "piece" ? pinCount : 0) > 0 ? ` ${counts[k] + (k === "piece" ? pinCount - counts.piece : 0)}` : ""}
                  </button>
                ))}
              </div>
              {otherSaves.length > 0 && (
                <ul className="ppsaves">
                  {otherSaves.map((s) => (
                    <li key={s.kind + s.id} className={"ppsave " + s.kind}>
                      {s.image ? <img src={s.image} alt="" loading="lazy" /> : <span className="ppsavemono" aria-hidden="true">{s.kind.slice(0, 1).toUpperCase()}</span>}
                      <span className="ppsavebody">
                        <span className="cclbl">{s.kind.toUpperCase()}{s.kind !== "post" ? <ModelTag kind="device" /> : null}</span>
                        <a className="ppsavettl" href={s.href || "#"}>{s.title}</a>
                        {s.meta && <span className="ppsavemeta">{s.meta}</span>}
                      </span>
                      <button className="txtbtn" onClick={() => unsave(s.kind, s.id)}>REMOVE</button>
                    </li>
                  ))}
                </ul>
              )}
              {saveFilter !== "all" && saveFilter !== "piece" && otherSaves.length === 0 && (
                <div className="empty">nothing saved here yet — the SAVE word on any {saveFilter} keeps it.</div>
              )}
            </>
          )}

          {showPieces && !shared && (
            <div className="controls">
              {boards.map((b) => (
                <button key={b.id} className={"fitbtn" + (b.id === activeId ? " active" : "")} onClick={() => setActiveId(b.id)}>
                  {b.name} ({b.items.length})
                </button>
              ))}
              <input type="text" aria-label="new board name" placeholder="new board name…" value={newName}
                onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createNew()} style={{ maxWidth: 200 }} />
              <button className="btn ghost" onClick={createNew}>+ board</button>
            </div>
          )}

          {showPieces && (view ? (
            <>
              <div className="controls">
                {!shared ? (
                  <input type="text" key={view.id} aria-label="rename this board" defaultValue={view.name}
                    onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.target.blur()} style={{ maxWidth: 260 }} />
                ) : (
                  <div style={{ fontSize: 20, fontWeight: 900, textTransform: "uppercase" }}>{view.name}</div>
                )}
                {shared ? (
                  <button className={"btn" + (following ? "" : " ghost")} onClick={() => toggleFollow(view)}>{following ? "Following ✓" : "Follow this taste"}</button>
                ) : null}
                <button className="btn" onClick={() => copyShare(view)}>Copy share link</button>
                <a className="btn ghost" href={"/?board=" + encodeURIComponent(view.id)}>explore this taste →</a>
              </div>
              {view.items.length === 0 ? (
                <div className="empty">no pieces yet — the SAVE word on any piece brings it here.</div>
              ) : (
                <div className="grid">
                  {view.items.map((it) => (
                    <div className="card" key={it.id}>
                      <div className="imgwrap" style={{ aspectRatio: aspectFor(it.id) }}>
                        <OriginSticker item={it} />
                        <img src={it.img || thumbFor(it)} alt={it.alt || it.title} loading="lazy" />
                      </div>
                      <div className="body">
                        <div className="ttl">{it.title}</div>
                        <div className="brand2">{it.brand}</div>
                        <ColorEvidenceLine item={it} />
                        <OriginLine item={it} />
                        <ProductFitLine item={it} fit={fit} />
                        <div className="pricerow">
                          {it.price ? <span className="price">{it.currency || "USD"} {it.price}</span> : null}
                          {safeExternalUrl(it.url) ? <a className="buy" href={safeExternalUrl(it.url)} target="_blank" rel="noopener noreferrer">view ↗</a> : null}
                        </div>
                        {!shared && <div className="actions"><button onClick={() => removeItem(it.id)}>Remove</button></div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            !shared && saveFilter === "piece" && <div className="empty">no boards yet — save a piece from DISCOVER to start one.</div>
          ))}

          {!shared && (
            <section className="ppstation" aria-label="teach the passport">
              <h3 className="statshead">ADD INSPIRATION</h3>
              <div className="controls">
                <input type="text" aria-label="teach asterisk — words, moods, colours, places, brands"
                  placeholder="words, moods, colors, cities, fabrics, music, brands — berlin, leather, quiet, rick owens, goretex…"
                  value={trainText} onChange={(e) => setTrainText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && train()} />
                <button className="btn" onClick={train}>ADD TO PASSPORT</button>
                <button className="btn ghost" onClick={() => fileRef.current && fileRef.current.click()}>UPLOAD IMAGES</button>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-label="upload images to train the passport" onChange={onUpload} />
              </div>
              <BehindUploads uid={uid} />
              {/* slice 12: the Passenger Score on the Passport (6.18) and where you went (17.19) */}
              <div className="bdatt"><b>PASSENGER SCORE</b><ScoreLine subject={uid} /></div>
              <AttendanceBlock uid={uid} />
              {recognized.length > 0 && (
                <div className="stampknow">
                  <span className="stampknow-mark" aria-hidden="true">✳</span>
                  <span className="stampknow-say">{recognized.length === 1 ? "the archive holds this one." : `the archive holds ${recognized.length} of these.`}</span>
                  <span className="stampknow-row">
                    {recognized.map((it) => (
                      <a key={it.id} className="stampknow-piece" href={"/?item=" + encodeURIComponent(it.id)} title={[it.brand, it.title].filter(Boolean).join(" — ")}>
                        <img src={it.img || thumbFor(it)} alt={it.title || "piece"} loading="lazy" />
                      </a>
                    ))}
                  </span>
                </div>
              )}
              <p className="deck">imports — pinterest, spotify, apple music, letterboxd — need real OAuth and arrive as secondary setup, never simulated.</p>
              <section className="ppbenefit" aria-label="member benefit example">
                <div className="cclbl">YOUR MEMBER BENEFIT <ModelTag>EXAMPLE — NOT A LIVE OFFER</ModelTag></div>
                <p className="stp">On a $600 piece the passenger fee is $1 + 1.5%: <b>$10</b>. A funded member credit of <b>$5</b> would make that fee <b>$5</b>. A real, auditable benefit — never a crossed-out price, never an invented markdown. At 1,000 redemptions a $5 credit is up to $5,000 of foregone fee revenue; taste status never buys purchasing power.</p>
              </section>
            </section>
          )}
        </>
      )}

      {/* ================= FULL READ ================= */}
      {!shared && tab === "fullread" && (
        <section className="ppread" aria-label="full read">
          <h3 className="statshead">FULL READ — THE TASTE NETWORK</h3>
          <p className="deck">a readable model of your preferences, not a scan of you. each node says what lit it; every change can be undone.</p>
          <TasteNetwork onExplore={(tag) => router.push("/discover?q=" + encodeURIComponent(tag.toLowerCase()))} />
          {viz && viz.state.forgotten && viz.state.forgotten.length > 0 && (
            <p className="deck">recently let go: {viz.state.forgotten.slice(0, 4).map((f) => f.tag).join(" · ")}</p>
          )}
          <p className="deck faint"><a className="txtbtn" href="/stats">THE HOUSE NUMBERS →</a> staff-only operating dashboards live on their own page now.</p>
        </section>
      )}

      {/* ================= PLACES ================= */}
      {!shared && tab === "places" && (
        <section className="ppplaces" aria-label="places">
          <h3 className="statshead">PLACES — NEAR YOU AND AROUND THE WORLD</h3>
          <p className="deck">events and permanent places, kept apart. saves land in your collection; your location stays yours.</p>
          <PlacesPanel />
        </section>
      )}

      {/* ================= STUDIO ================= */}
      {!shared && tab === "studio" && (
        <section className="ppstudio" aria-label="studio">
          <h3 className="statshead">STUDIO — ONE ACCOUNT, MORE POSSIBILITIES</h3>
          <Studio uid={uid} />
        </section>
      )}
    </div>
  );
}

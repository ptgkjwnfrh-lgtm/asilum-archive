"use client";

// app/hotlist/page.js — THE WIRE (owner overhaul, Aug 13; formerly
// EDITORIAL — the destination renamed by owner decree).
// This is where ALL user posts live, and where the hotlist stands.
//
// THE FOR-YOU HUB (owner, 9 Sep evening: "the same format as twitter —
// videos, pictures and transmissions all live in one hub, and the hotlist
// lives in a liquid glass strip to the side"): one feed column — the
// composer in a glass pane, then every post as a glass card (avatar,
// handle, time, the caption header, the text, the action row) — and a
// rail beside it: THE HOTLIST's ten booths in their own pane, then the
// ladder's quieter rungs. Pictures and video take the same card the day the
// media pipeline lands; nothing is staged before it.
//
// The posting law (owner order, Aug 13) — three ways to post:
//   TRANSMISSIONS (live): text capped at 5000 characters; the caption
//     acts as the transmission's HEADER (≤200, the server's title).
//   IMAGES (pipeline pending): up to SIX images in one carousel,
//     caption allowed — needs real storage; honestly coming soon.
//   VIDEO (pipeline pending): one video capped at 3:00, caption
//     allowed — same pipeline, same honesty.
//
// Booths link to their pieces when the desk has linked an inventory
// namespace (18 Aug) — the commerce pipeline is real now; a booth with
// no linked inventory still reads honestly as presence only.
//
// The hotlist law (owner order, Aug 13): the hotlist is TEN BOOTH
// SLOTS held for independent Shopify-based brands. A passport account
// becomes a BUSINESS account by verifying itself, connecting its
// Shopify, and connecting its personal website; only business accounts
// get a chance at a booth. No commerce pipeline exists yet, so every
// booth honestly reads OPEN — nothing stands in.
//
// Below the booths, the quieter rungs keep the graded descent:
// ASILUM MAGAZINE → AD SPACE → EXTERNAL DISPATCHES.

import { useEffect, useState } from "react";
import { authorizedFetch, getUid, postJSON } from "../../lib/client.js";
import {
  READING_ROOM, fetchWire, fetchPost, addPost, editPost, deletePost, timeAgo, getProfileInfo,
  fetchEngagement, toggleEngagement,
} from "../../lib/social.js";
import { Avatar, WhoToFollowList } from "../components/UserBits.jsx";
import TransmissionText from "../components/TransmissionText.jsx";
import PageMast from "../components/PageMast.jsx";
import GlassPane from "../components/GlassPane.jsx";
import SaveButton from "../components/SaveButton.jsx";
import ModelTag from "../components/ModelTag.jsx";
import { thumbFor } from "../../lib/client.js";
import { SAMPLE_POSTS, WIRE_CATEGORIES, WIRE_INTENTS, readWireRefs } from "../../lib/model/media.js";

// The identity chain (owner order, Aug 13): every byline is a link —
// your own to /profile, anyone else's to their /u/[handle] page — and a
// server post's timestamp is its permalink (?post=<id> pins it here).
// Device-only copies (just posted, or held) have no server id yet, so
// their timestamps stay plain — a permalink that only works for its
// author would be a lie.
function PostByline({ p }) {
  return (
    <span className="fposthandle">
      {p.mine
        ? <a className="whandle" href="/profile">{p.handle}</a>
        : <a className="whandle" href={"/u/" + encodeURIComponent(p.handle)}>{p.handle}</a>}
      {p.mine ? <i className="cmine">you</i> : null}
      {" · "}
      {p.serverId != null
        ? <a className="wperma" href={"/?post=" + encodeURIComponent(p.serverId)}>{timeAgo(p.at)}</a>
        : timeAgo(p.at)}
      {/* the edited stamp is server truth — a touched transmission says
          so; an untouched one carries no label (honesty, Aug 14) */}
      {p.editedAt ? <i className="wedited">· edited {timeAgo(p.editedAt)}</i> : null}
    </span>
  );
}

// The wire's hairline field (magazine treatment, Aug 13): pinned to the
// page's first stretch, hand-placed and deterministic.

const BOOTHS = Array.from({ length: 10 }, (_, i) => i + 1);

export default function TheWirePage() {
  const [posts, setPosts] = useState(null);
  const [postsLive, setPostsLive] = useState(true);
  const [house, setHouse] = useState(null);
  const [houseLive, setHouseLive] = useState(true);
  const [stamp, setStamp] = useState("");
  const [mode, setMode] = useState("transmission"); // transmission | images | video
  // V.2 — CREATE / CURATE / INTERPRET and the category ride as hashtags on
  // the transmission (the refs the wire already parses), so no schema moves.
  const [intent, setIntent] = useState("create");
  const [category, setCategory] = useState("style");
  const [lane, setLane] = useState("foryou");  // foryou | mine | <category id>
  // purchasable pieces braided into the stream, from the feed engine
  const [pieces, setPieces] = useState([]);
  const [caption, setCaption] = useState("");
  const [text, setText] = useState("");
  const [wireNote, setWireNote] = useState("");
  // ?post=<id> pins one transmission above the wire. undefined = no
  // permalink requested; null = looking it up; false = honestly absent.
  const [focus, setFocus] = useState(undefined);
  // The booth roster — verified business accounts, server truth.
  const [booths, setBooths] = useState(null);
  // P4 — paid placements matched to THIS passport (empty for cold taste,
  // empty when no booth pays; labeled PAID PLACEMENT whenever shown).
  const [paidBooths, setPaidBooths] = useState([]);
  // Impersonation report form (18 Aug) — server enforces the signed-in
  // requirement; refusals render as the server's own words.
  const [reportBrand, setReportBrand] = useState("");
  const [reportReal, setReportReal] = useState("");
  const [reportFake, setReportFake] = useState("");
  const [reportMsg, setReportMsg] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  // Posting is NAMED (sb-only, the Aug 13 law) — an anonymous reader gets
  // the hint AT the composer, before typing, not a refusal after.
  const [anonPoster, setAnonPoster] = useState(false);
  useEffect(() => {
    const check = () => setAnonPoster(!(getUid() || "").startsWith("sb-"));
    check();
    window.addEventListener("asilum:identity", check);
    return () => window.removeEventListener("asilum:identity", check);
  }, []);
  // Which floor posts are the caller's own — SERVER truth (?mine=1, the
  // verified identity), not the local text-match chip: controls that
  // could 404 on a stranger's post must never render on one.
  const [mineIds, setMineIds] = useState(null);
  const [editing, setEditing] = useState(null);   // serverId under edit
  const [editText, setEditText] = useState("");
  const [editCaption, setEditCaption] = useState("");
  const [confirmDel, setConfirmDel] = useState(null); // serverId armed to delete
  // Real engagement counts, keyed by server id. {} = not read yet or the
  // server could not be reached — the floor then shows NO counts rather
  // than zeros it cannot stand behind.
  const [engagement, setEngagement] = useState({});

  function fileImpersonationReport() {
    setReportBusy(true); setReportMsg("");
    postJSON("/api/impersonation", {
      user: getUid(), brandName: reportBrand.trim(),
      realWorkUrl: reportReal.trim(), fakeUrl: reportFake.trim() || undefined,
    })
      .then(async (res) => {
        const d = await res.json().catch(() => null);
        if (!res.ok) { setReportMsg((d && (d.error || d.note)) || "the report could not be filed"); return; }
        setReportMsg(`filed — case ${d.case}. ${d.note}`);
        setReportBrand(""); setReportReal(""); setReportFake("");
      })
      .catch(() => setReportMsg("the server could not be reached — nothing was filed"))
      .finally(() => setReportBusy(false));
  }

  function loadWire() {
    authorizedFetch("/api/feed?user=" + encodeURIComponent(getUid() || "guest") + "&limit=12")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPieces(((d && d.items) || []).slice(0, 8)))
      .catch(() => {});
    fetchWire("user")
      .then((w) => {
        setPosts(w.posts);
        setPostsLive(w.live);
        const ids = w.posts.map((p) => p.serverId).filter((v) => v != null);
        if (ids.length) fetchEngagement(ids).then((e) => setEngagement((prev) => ({ ...prev, ...e })));
      })
      .catch(() => { setPosts([]); setPostsLive(false); });
  }

  // One person's like/save. The server's counts replace ours — we never
  // increment a number locally, because the counter is people, not clicks,
  // and only the ledger knows whether this person was already counted.
  function engage(p, kind) {
    const now = engagement[String(p.serverId)];
    const on = !(kind === "like" ? now?.youLike : now?.youSave);
    toggleEngagement(p.serverId, kind, on).then((r) => {
      if (r.ok) setEngagement((prev) => ({ ...prev, [String(p.serverId)]: r.counts }));
      else setWireNote(r.error || "the Feed could not be reached");
    });
  }

  function loadMine() {
    authorizedFetch("/api/editorial?mine=1&limit=120&user=" + encodeURIComponent(getUid() || ""))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setMineIds(new Set((d.posts || []).map((p) => String(p.id)))); })
      .catch(() => {});
  }

  function beginEdit(p) {
    setEditing(p.serverId);
    setEditText(p.text);
    setEditCaption(p.title || "");
    setConfirmDel(null);
  }

  function saveEdit() {
    const p = (posts || []).find((x) => x.serverId === editing);
    const t = editText.trim();
    if (!p || !t) return;
    editPost(p, t, editCaption.trim()).then((r) => {
      setWireNote(!r.ok
        ? (r.error || "the edit could not reach the Feed")
        : r.held ? (r.note || "your edit is saved and paused for a human review") : "");
      setEditing(null);
      loadWire();
      loadMine();
    });
  }

  function doDelete(p) {
    deletePost(p).then((r) => {
      setWireNote(r.ok ? "" : (r.error || "the delete could not reach the Feed"));
      setConfirmDel(null);
      loadWire();
      loadMine();
      // if the deleted transmission was pinned by permalink, it is now
      // honestly gone — say so rather than keep showing it.
      if (focus && focus.serverId === p.serverId) setFocus(false);
    });
  }

  useEffect(() => {
    setStamp(new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    }).toUpperCase());
    loadWire();
    loadMine();
    fetchWire("asilum")
      .then((w) => { setHouse(w.posts); setHouseLive(w.live); })
      .catch(() => { setHouse([]); setHouseLive(false); });
    const sp = new URLSearchParams(window.location.search);
    const pid = sp.get("post");
    if (pid && /^\d{1,18}$/.test(pid)) {
      setFocus(null);
      fetchPost(pid).then((p) => setFocus(p || false));
    }
    authorizedFetch("/api/business?booths=1&user=" + encodeURIComponent(getUid() || ""))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setBooths(Array.isArray(d.booths) ? d.booths.slice(0, 10) : []);
        setPaidBooths(Array.isArray(d.paidBooths) ? d.paidBooths : []);
      })
      .catch(() => setBooths([]));
  }, []);

  // P2 — the attribution channel's client half: a click-through on a booth
  // is recorded before the reader leaves. Fire-and-forget; the server
  // refuses unknown booths and the ledger stays honest either way.
  function noteBoothVisit(sourceName) {
    if (!sourceName) return;
    postJSON("/api/booth-visit", { user: getUid(), sourceName }).catch(() => {});
  }

  function publish() {
    const t = text.trim();
    if (!t) return;
    const cap = caption.trim();
    const info = getProfileInfo();
    // The device copy is written only AFTER the server accepts.
    //
    // It used to be written first, for instant render, and the handler below
    // only ever asked whether the post was HELD — so any refusal set the note
    // to "" and left the copy in place. Once posting began requiring a
    // signed-in account (Aug-16 audit), that turned into the worst possible
    // outcome: a signed-out visitor saw their transmission appear on their own
    // wire, with no error, having published nothing. The honesty contract says
    // a refusal must look like a refusal.
    const refs = `#${intent} #${category}`;
    const body = t.includes(refs) ? t : `${t}\n\n${refs}`;
    postJSON("/api/editorial", {
      user: getUid(), handle: info.handle || info.name,
      text: body, title: cap || undefined,
    })
      .then(async (res) => {
        const d = await res.json().catch(() => null);
        if (!res.ok) {
          // The server's own words — it knows why better than this page does.
          setWireNote((d && (d.error || d.note)) || "the Feed did not accept that transmission");
          return;
        }
        addPost(t, info, cap);
        setWireNote(d && d.held ? (d.note || "your transmission is saved and paused for a human review") : "");
        setText("");
        setCaption("");
        loadWire();
        loadMine();
      })
      .catch(() => setWireNote("the shared wire could not be reached — nothing was published"));
  }

  // THE HOTLIST's ten booths — the rail's pane (9 Sep). Same roster, same
  // links, same attribution click as before; the row is compact.
  // THE STREAM (V.2): the floor's posts in the chosen lane, sample editorial
  // filling in when the lane is thin, and a purchasable piece braided in
  // after every third entry — so browsing is never only scrolling and a
  // film edit never has to be shoppable to belong.
  const lanePosts = (posts || []).filter((p) => {
    if (lane === "mine") return !!p.mine;
    if (lane === "foryou") return true;
    return readWireRefs(p.tags || []).category === lane;
  });
  const samples = lane === "mine" ? [] : SAMPLE_POSTS.filter((sp) => lane === "foryou" || sp.category === lane);
  const stream = [];
  const laneEntries = [...lanePosts.map((post) => ({ post })), ...(lanePosts.length < 3 ? samples.map((sample) => ({ sample })) : [])];
  let pi = 0;
  laneEntries.forEach((e, i) => {
    stream.push(e);
    if ((i + 1) % 3 === 0 && pieces[pi] && lane !== "mine") stream.push({ piece: pieces[pi++] });
  });

  const boothRows = BOOTHS.map((n) => {
    const holder = booths ? booths[n - 1] : null;
    return (
      <div className="booth" key={n}>
        <div className="elnum" aria-hidden="true">{String(n).padStart(2, "0")}</div>
        {holder ? (
          <div className="boothbody">
            <b>{holder.brandName}</b>
            <span>
              verified independent brand ·{" "}
              <a
                className="boothsite"
                href={holder.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => noteBoothVisit(holder.sourceName)}
              >
                their site ↗
              </a>
              {holder.sourceName && (
                <>
                  {" · "}
                  <a
                    className="boothsite"
                    href={"/discover?q=" + encodeURIComponent(holder.brandName)}
                    onClick={() => noteBoothVisit(holder.sourceName)}
                  >
                    their pieces →
                  </a>
                </>
              )}
            </span>
          </div>
        ) : (
          <div className="boothbody">
            <b>BOOTH OPEN</b>
            <span>held for a verified independent brand</span>
          </div>
        )}
        <span className="boothtag">{holder ? "VERIFIED BUSINESS" : "BUSINESS ACCOUNTS ONLY"}</span>
      </div>
    );
  });

  return (
    <div className="wrap elr ctr wire2">
      {posts !== null && (
        <span className="cvside elside" aria-hidden="true">
          {posts.length} TRANSMISSION{posts.length === 1 ? "" : "S"} IN THE FEED
        </span>
      )}
      <span className="cvside cvsider elsider" aria-hidden="true">
        {booths === null
          ? "10 BOOTHS"
          : booths.length === 0
            ? "10 BOOTHS · ALL OPEN"
            : `10 BOOTHS · ${booths.length} HELD · ${10 - booths.length} OPEN`}
      </span>

      <header className="cthead">
        <PageMast word="THE HOTLIST" sub="TEN BOOTHS · THE LADDER" />
        {stamp && (
          <div className="ctmeta">
            LIVE EDITION · {stamp}
            {posts !== null && (
              <span>
                {posts.length} TRANSMISSION{posts.length === 1 ? "" : "S"}
                {booths !== null && ` · ${10 - booths.length} OF 10 BOOTHS OPEN`}
              </span>
            )}
          </div>
        )}
      </header>
      <p className="deck">
        the ten booths held for verified independent brands, and the quieter rungs of the ladder. the stream itself lives in <a className="txtbtn" href="/">THE FEED →</a>
      </p>

      <div className="wlayout hotlistonly">
        {/* ---- THE RAIL — the hotlist in its glass strip, then the quieter
             rungs of the ladder: who to follow, the house, the open
             placements, the reading room, the report form ---- */}
        <aside className="wrail" aria-label="the hotlist and the rail">
          {/* ---- THE HOTLIST — ten booths, business accounts only ---- */}
          <GlassPane glass="lg-w-hot" className="whot elhot" aria-label="the hotlist">
            <div className="elmast">THE HOTLIST</div>
            <p className="elnote">
              <span className="pulse" />
              ten booths, held for verified independent brands. a passport account
              becomes a BUSINESS account by verifying itself, connecting its
              Shopify, and connecting its personal website — only business
              accounts get a chance at a booth. nothing stands in.
            </p>
            {paidBooths.length > 0 && (
              <div className="paidrail" aria-label="paid placements">
                <p className="elnote">
                  PAID PLACEMENT — these booths pay for the spot, and they reach
                  you only because your Passport already points at their work.
                  taste gates the door; rent never buys the wrong audience.
                </p>
                {paidBooths.map((b) => (
                  <div className="booth" key={"paid-" + b.sourceName}>
                    <div className="elnum" aria-hidden="true">★</div>
                    <div className="boothbody">
                      <b>{b.brandName}</b>
                      <span>
                        matched to your Passport ·{" "}
                        <a
                          className="boothsite"
                          href={b.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => noteBoothVisit(b.sourceName)}
                        >
                          their site ↗
                        </a>
                        {" · "}
                        <a
                          className="boothsite"
                          href={"/discover?q=" + encodeURIComponent(b.brandName)}
                          onClick={() => noteBoothVisit(b.sourceName)}
                        >
                          their pieces →
                        </a>
                      </span>
                    </div>
                    <span className="boothtag">PAID PLACEMENT</span>
                  </div>
                ))}
              </div>
            )}
            {boothRows}
            <div className="elsubmit">
              <span className="adstar" aria-hidden="true">*</span>
              <span>
                RAISE YOUR PASSPORT TO BUSINESS — verify your brand, your Shopify
                storefront, and your own site; a human reviews every application.{" "}
                <a className="bizapply" href="/profile#access">APPLY ON YOUR ACCOUNT →</a>
              </span>
            </div>
          </GlassPane>

          <GlassPane glass="lg-w-who" className="fwho" aria-label="who to follow">
            <div className="elh elh4">WHO TO FOLLOW</div>
            <WhoToFollowList compact withSearch />
          </GlassPane>

          {/* ---- ASILUM MAGAZINE — the house's own dispatches ---- */}
          <GlassPane glass="lg-w-house" className="elhouse" aria-label="asilum">
            <div className="elh elh2">ASILUM</div>
            {house === null && <div className="empty">opening the house pages…</div>}
            {house && !houseLive && (
              <p className="elhousenote">the house pages could not be reached — try again in a moment.</p>
            )}
            {house && houseLive && house.length === 0 && (
              <p className="elhousenote">
                the first ASILUM dispatch is on the cutting table — the house
                writes here, under its own byline, when there is something worth
                saying.
              </p>
            )}
            {(house || []).map((p) => (
              <article className="elpiece" key={p.id}>
                <div className="elpiecettl">{p.title || p.text.slice(0, 80)}</div>
                <p className="elpiecesum">{p.excerpt || p.text}</p>
                <span className="elpiecedate">{timeAgo(p.at)}</span>
              </article>
            ))}
            <div className="elsubmit">
              <span className="adstar" aria-hidden="true">*</span>
              <span>EDITORIAL SUBMISSIONS — submission intake requires setup. <em>coming soon</em></span>
            </div>
          </GlassPane>

          {/* ---- AD SPACE — open placements, always labeled ---- */}
          <section className="elads" aria-label="ad space">
            <div className="elh elh3">AD SPACE</div>
            <div className="eladrow">
              <div className="elad">
                <span className="adstar" aria-hidden="true">*</span>
                <b>THIS PLACEMENT IS OPEN</b>
                <em>space for taste.</em>
              </div>
              <div className="elad">
                <span className="adstar" aria-hidden="true">*</span>
                <b>THIS PLACEMENT IS OPEN</b>
                <em>sponsored placements are always disclosed.</em>
              </div>
            </div>
          </section>

          {/* ---- THE READING ROOM — quietest ----
               Was EXTERNAL DISPATCHES, printing headlines ASILUM invented under
               real mastheads. It is a reading list now: the publication, what it
               actually covers, and a link to its front page. */}
          <section className="elext" aria-label="the reading room">
            <div className="elh elh5">THE READING ROOM</div>
            {READING_ROOM.map((s) => (
              <a className="elextrow" key={s.pub} href={s.url} target="_blank" rel="noopener noreferrer">
                <span className="elextpub">{s.pub.toUpperCase()}</span>
                <span className="elextttl">{s.beat} ↗</span>
              </a>
            ))}
            <p className="elextnote">
              mastheads ASILUM reads. the lines are ours, describing their beat — not
              their headlines. each link goes to their front page.
            </p>
          </section>

          {/* Impersonation reports (18 Aug): the public door to the case
              machinery. Signed-in only — the server enforces it and the
              refusal is shown honestly; a report is a named accusation. */}
          <GlassPane glass="lg-w-report" className="wreport" aria-label="report an impersonation">
            <div className="elh elh4">REPORT AN IMPERSONATION</div>
            <p className="elnote">
              see a brand being copied on the terminal? file it — the case ledger
              records every step and a named human adjudicates. false reports are
              themselves on the ledger.
            </p>
            <div className="bizform">
              <input aria-label="the brand being impersonated"
                type="text" maxLength={80} placeholder="the brand being impersonated"
                value={reportBrand} onChange={(e) => setReportBrand(e.target.value)}
              />
              <input aria-label="link to the real work"
                type="url" maxLength={300} placeholder="https:// link to the REAL work"
                value={reportReal} onChange={(e) => setReportReal(e.target.value)}
              />
              <input aria-label="link to the fake (optional)"
                type="url" maxLength={300} placeholder="https:// link to the fake (optional)"
                value={reportFake} onChange={(e) => setReportFake(e.target.value)}
              />
              <div className="bizrow">
                <button className="btn" disabled={reportBusy || !reportBrand.trim() || !reportReal.trim()}
                  onClick={fileImpersonationReport}>
                  {reportBusy ? "FILING…" : "FILE REPORT"}
                </button>
              </div>
              {reportMsg && <p className="pempty">{reportMsg}</p>}
            </div>
          </GlassPane>
        </aside>
      </div>

      <footer className="cvcolo" aria-label="colophon">
        *ASILUM — THE HOTLIST · {stamp}
        {posts !== null && <> · {posts.length} TRANSMISSION{posts.length === 1 ? "" : "S"}</>}
        {booths !== null && <> · {booths.length} OF 10 BOOTHS HELD</>}
        {" "}· {READING_ROOM.length} MASTHEADS IN THE READING ROOM
      </footer>
    </div>
  );
}

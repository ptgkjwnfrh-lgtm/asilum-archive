"use client";

// app/cover/page.js — FRONT COVER.
// The landing edition (owner amendment, July 25: seventh destination),
// rebuilt as a true magazine cover (owner refinement round, Aug 12) and
// densified to full magazine weight (owner round 3, Aug 13): thick
// floating highlight frames over the look strips (State 3.0 reference),
// a contact-sheet film strip beside the hero (Rag & Bone reference),
// Warp-sleeve credit stacks, a field of non-uniform contrast hairlines,
// and magazine marginalia in every gutter. Every displayed value is real
// state: the pick is the feed's actual top item, the hotlist is the live
// person-deduped popularity ranking (vacant until real people move —
// owner order Aug 13, no feed stand-in), the looks come from the live
// stylist engine, and the marginalia print the system ledger's own
// counters — nothing decorative is invented.

import { useEffect, useState } from "react";
import { getUid, postJSON, authorizedFetch, thumbFor } from "../../lib/client.js";
import {
  READING_ROOM, fetchPosts, addPost, timeAgo, getProfileInfo, sourceFor,
} from "../../lib/social.js";
import { Avatar } from "../components/UserBits.jsx";
import TransmissionText from "../components/TransmissionText.jsx";
import { systemLedger } from "./ledger.js";
import SaveButton from "../components/SaveButton.jsx";
import ModelTag from "../components/ModelTag.jsx";
import { SAMPLE_POSTS } from "../../lib/model/media.js";
import { discoveryCenter } from "../../lib/location.js";
import PlacementsBlock from "../components/Placements.jsx";

const SUBSYSTEMS = [
  { href: "/", label: "CATALOG", meta: "your curated edit" },
  { href: "/", label: "THE FEED", meta: "posts, pieces and places" },
  { href: "/board", label: "PASSPORT", meta: "train the brain" },
  { href: "/discover", label: "DISCOVER", meta: "the open index" },
  { href: "/profile", label: "PROFILE", meta: "your public record" },
  { href: "/settings", label: "SETTINGS", meta: "control panel" },
];

// The hairline field (owner order, Aug 13; diagonals swapped for
// verticals same day): horizontal and vertical contrast lines, a few
// thick, most thin, most barely there. Hand-placed and deterministic —
// print texture, not motion, so no random at render.
const HAIRLINES = [
  "cvln-h1", "cvln-h2", "cvln-h3", "cvln-h4", "cvln-h5", "cvln-h6",
  "cvln-v1", "cvln-v2", "cvln-v3", "cvln-v4", "cvln-v5",
];

export default function CoverPage() {
  const [feed, setFeed] = useState([]);
  const [looks, setLooks] = useState([]);
  const [posts, setPosts] = useState(null);
  const [postsLive, setPostsLive] = useState(true);
  const [postNote, setPostNote] = useState("");
  const [sys, setSys] = useState(null);
  const [text, setText] = useState("");
  const [stamp, setStamp] = useState("");
  const [year, setYear] = useState("");

  const pick = feed[0] || null;
  const film = feed.slice(1, 7);
  const [booths, setBooths] = useState(null);
  // V.2: nearby events and places when a base city is confirmed; the
  // sample editorial lead that gives the cover a story before the first post.
  const [near, setNear] = useState(null);
  const lead = SAMPLE_POSTS[0];

  function loadCoverPosts() {
    fetchPosts()
      .then((w) => { setPosts(w.posts); setPostsLive(w.live); })
      .catch(() => { setPosts([]); setPostsLive(false); });
  }

  useEffect(() => {
    const user = getUid() || "guest";
    loadCoverPosts();
    const now = new Date();
    setStamp(now.toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    }).toUpperCase());
    setYear(String(now.getFullYear()));
    // The hotlist preview mirrors /hotlist exactly: only pieces a real
    // person moved on fill slots; the rest stay VACANT (owner order,
    // Aug 13: the hotlist is held for designer accounts) — the caller's
    // own feed never stands in.
    // The cover shows nine; a default 60-item serve would mark fifty-one
    // never-shown cards seen and take a serve-ring entry no beacon reports.
    authorizedFetch("/api/feed?user=" + encodeURIComponent(user) + "&limit=12")
      .then((r) => r.json())
      .then((d) => setFeed(((d && d.items) || []).slice(0, 9)))
      .catch(() => {});
    // The ledger folio still reads the system stats; the hotlist preview
    // no longer does — the hotlist is TEN BOOTHS for verified independent
    // brands (owner overhaul, Aug 13), and with no commerce pipeline yet
    // every booth honestly reads OPEN.
    //
    // WHAT WAS WRONG (Aug 17, metric-definition audit). This never checked
    // r.ok — the same defect the /stats page had fixed on Aug 8 — and it went
    // live-visible the moment /api/stats became STAFF-ONLY (Aug 16, P0-1). A
    // visitor's device cookie now earns 401 `{error}`, which is a TRUTHY body,
    // so `sys` was set to the error and the folio interpolated it:
    //   SYSTEM LEDGER — undefined INTERACTIONS · undefined READERS ·
    //   undefined BOARDS · undefined GRAPH EDGES
    // in the masthead AND the colophon, one line above "EVERY VALUE ON THIS
    // PAGE IS REAL STATE". Worse than the undefineds: `sys.persistent` was
    // undefined too, so the STATE marginalia printed "MEMORY MODE" on a
    // deployment running Postgres — a false claim about the system itself.
    // Browser-confirmed before the fix, both readings.
    //
    // The house numbers are staff data now, so this reads the SAME
    // sessionStorage slot THE DESK and /stats use rather than inventing a
    // second credential. No token, or a refused one, means the folio and the
    // STATE marginalia are NOT DRAWN — the cover prints what it can read.
    // ONLY ASK IF WE MAY. Verified against production: this fetch was firing on
    // every visit to the landing page and earning a guaranteed 401, because
    // /api/stats is staff-only and a visitor has no token to send. The page
    // handled the refusal correctly — but it still spent a round trip on a
    // question with a known answer, and logged a console error doing it, which
    // is exactly the kind of ghost a future debugging session chases.
    // No token, no request. The folio is staff-only either way.
    let staffToken = "";
    try { staffToken = window.sessionStorage.getItem("asilum-admin-token") || ""; } catch {}
    if (staffToken) {
      fetch("/api/stats", { headers: { Authorization: "Bearer " + staffToken } })
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => { if (s) setSys(s); })
        .catch(() => {});
    }
    try {
      const c = discoveryCenter();
      if (c) {
        fetch(`/api/places?lat=${c.lat}&lng=${c.lng}&km=80`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (d) setNear({ label: c.label, places: (d.places || []).slice(0, 4) }); })
          .catch(() => {});
      } else setNear({ label: null, places: [] });
    } catch {}
    fetch("/api/business?booths=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setBooths(Array.isArray(d.booths) ? d.booths : []); })
      .catch(() => setBooths([]));
    authorizedFetch("/api/outfits?user=" + encodeURIComponent(user) + "&n=2")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setLooks((d.outfits || []).slice(0, 2)); })
      .catch(() => {});
  }, []);

  function post() {
    const t = text.trim();
    if (!t) return;
    const info = getProfileInfo();
    addPost(t, info);
    // The server's verdict decides the note — a held-for-review post is
    // saved but invisible to others, and saying "live" would be a lie.
    postJSON("/api/editorial", { user: getUid(), handle: info.handle || info.name, text: t })
      .then(async (res) => {
        // Only the server's own verdict may set this note. A non-ok body parses
        // fine and has no `held`, so reading it would render a refusal as
        // "posted, nothing held" — the case this whole guard exists for.
        //
        // KNOWN GAP, deliberately not invented here: `addPost` above already
        // wrote the post locally, so a refusal still leaves it on screen with
        // no note. Telling the reader their post did not save needs copy that
        // is the owner's to choose, not a guard's to improvise.
        const d = res.ok ? await res.json().catch(() => null) : null;
        setPostNote(d && d.held ? (d.note || "your post is saved and paused for a human review") : "");
        loadCoverPosts();
      })
      .catch(() => setPostNote("saved on this device — the shared wire could not be reached"));
    loadCoverPosts();
    setText("");
  }

  // Built field by field from values that ARE numbers, not by interpolating
  // whatever arrived. The r.ok check above is the fix; ledger.js is the guard
  // that outlives it, and it is a module so a test can hold it.
  const ledger = systemLedger(sys);

  return (
    <div className="wrap cvr">

      <header className="cvmast" aria-label="front cover masthead">
        {/* The masthead is styled spans, so the route had no semantic heading.
            Visually unchanged; announced properly. */}
        <h1 className="a11yhead">Front Cover</h1>
        <div className="cvmastblock">
          <span className="cvmastline"><b className="red">*</b>FRONT</span>
          <span className="cvmastline">COVER</span>
          {year && (
            <span className="cvmastline cvyear">
              {year.slice(0, 2)}<i>{year.slice(2)}</i>
            </span>
          )}
        </div>
        <div className="cvmeta">
          LIVE EDITION · {stamp}<br />EVERY MODULE OPENS ITS SUBSYSTEM →
          {ledger && <span className="cvledger">SYSTEM LEDGER — {ledger}</span>}
        </div>
      </header>

      {/* THE LEAD (V.2): a story first — sample editorial with its credit
          until people post — beside tonight's piece and the ranked strip. */}
      <section className="cvlead" aria-label="the cover story">
        <a className="cvleadimg" href="/">
          <img src={lead.image.src} alt={lead.image.alt} />
        </a>
        <div className="cvleadtext">
          <span className="cvkick">THE COVER STORY · {lead.category.toUpperCase()} <ModelTag kind="sample">SAMPLE EDITORIAL</ModelTag></span>
          <a className="cvleadttl" href="/">{lead.title}</a>
          <p className="cvleaddek">{lead.text.split("\n")[0]}</p>
          <span className="cvleadcred"><a href={lead.image.url} target="_blank" rel="noreferrer">{lead.image.credit} · {lead.image.license}</a></span>
          <div className="cvleadacts">
            <SaveButton kind="post" id={lead.id} title={lead.title} image={lead.image.src} href="/" meta={lead.name} tags={lead.tags} />
            <a className="txtbtn" href="/">READ IN THE FEED →</a>
          </div>
        </div>
      </section>
      <div className="cvherorow">
        {pick ? (
          <a
            className="cvhero"
            aria-label="tonight's pick"
            href={"/?item=" + encodeURIComponent(pick.id)}
          >
            <span className="cvvert" aria-hidden="true">TONIGHT THE MACHINE RECOMMENDS</span>
            <div className="cvheroimg">
              <img src={pick.img || thumbFor(pick)} alt={pick.title || "front cover piece"} />
            </div>
            {/* Warp-sleeve credit stack — labels float, values are real */}
            <div className="cvcred" aria-hidden="true">
              <span className="cclbl">PIECE No.</span>
              <span className="ccval">{pick.id}</span>
              <span className="cclbl">SOURCE</span>
              <span className="ccval">{sourceFor(pick)}</span>
              {pick._zone && (
                <>
                  <span className="cclbl">PULLED FROM</span>
                  <span className="ccval">{pick._zone === "reach" ? "FAR REACH" : String(pick._zone).toUpperCase()} ZONE</span>
                </>
              )}
            </div>
            <div className="cvherotext">
              <span className="cvherobrand">{(pick.brand || "").toUpperCase()}</span>
              <span className="cvherottl">{pick.title}</span>
              <span className="cvheroline">
                {sourceFor(pick)} · {pick.currency || "USD"} {pick.price}
              </span>
              <span className="cvlink">OPEN RECORD →</span>
            </div>
          </a>
        ) : (
          <section className="cvhero cvempty" aria-label="tonight's pick">
            <span className="cvvert" aria-hidden="true">TONIGHT THE MACHINE RECOMMENDS</span>
            <div className="pempty">
              the machine is still reading you — browse the CATALOG and it will
              put tonight&apos;s pick here.
            </div>
          </section>
        )}

        {film.length > 0 && (
          <aside className="cvfilm" aria-label="next in your ranking">
            <span className="cvfilmlbl">NEXT IN YOUR RANKING</span>
            {film.map((it, i) => (
              <a key={it.id} href={"/?item=" + encodeURIComponent(it.id)}>
                <img src={it.img || thumbFor(it)} alt={it.title} />
                <b>{String(i + 2).padStart(2, "0")} · {(it.brand || "").toUpperCase()}</b>
              </a>
            ))}
          </aside>
        )}
      </div>

      {/* NEAR YOU (V.2): only when a base city is confirmed; a fixture says so */}
      <section className="cvnear" aria-label="near you">
        <div className="cvkick">NEAR YOU{near && near.label ? ` · ${near.label.toUpperCase()}` : ""}</div>
        {near && near.label && near.places.length > 0 ? (
          <ul className="cvnearlist">
            {near.places.map((p) => (
              <li key={p.id}>
                <span className="cvnearkind">{p.kind.toUpperCase()}{p.dated && p.startsAt ? ` · ${p.startsAt}` : ""}{p.distanceKm != null ? ` · ${p.distanceKm} KM` : ""}</span>
                <a href="/discover?tab=places" className="cvnearname">{p.name}</a>
                {p.sample ? <ModelTag kind="sample">FIXTURE</ModelTag> : <span className="modeltag">SOURCED</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="cvnote">confirm a base city on your <a href="/board?tab=places">PASSPORT</a> and the cover shows what is on near it — events and places, nothing detected, nothing published.</p>
        )}
      </section>
      <div className="cvband">
        <section className="cvhot" aria-label="hotlist preview">
          <div className="cvkick">THE HOTLIST</div>
          <div className="cvnote">
            ten booths, held for verified independent brands — a business
            account is a passport account that verified itself and connected
            its Shopify and its own site. nothing stands in.
          </div>
          {[1, 2, 3].map((n) => {
            const holder = booths ? booths[n - 1] : null;
            return (
              <div className="cvhotrow" key={n}>
                <span className="cvhotnum" aria-hidden="true">{String(n).padStart(2, "0")}</span>
                <span className="cvboothttl">
                  {holder ? holder.brandName : "BOOTH OPEN"}
                  <i>{holder ? "verified independent brand" : "held for a verified independent brand"}</i>
                </span>
                <span className="cvhotstat">{holder ? "HELD" : "OPEN"}</span>
              </div>
            );
          })}
          <a className="cvlink cvmore" href="/">ALL TEN BOOTHS — THE FEED →</a>
        </section>
        {/* V.2 (1 Oct): Front Cover carries the business/event placements —
            the same records the dock's strip runs, visibly apart from the
            hotlist above (held, never bought). */}
        <PlacementsBlock />

        <section className="cvlooks" aria-label="tonight's looks">
          {/* Only drawn when the ledger was actually read. "READING" was a
              placeholder for a request still in flight, and it outlived the
              request — a refused read left it saying READING forever, and an
              error body made it say MEMORY MODE. Marginalia is absolutely
              positioned, so omitting it costs no layout. */}
          {sys && (
            <span className="cvside" aria-hidden="true">
              STATE — {sys.persistent ? "PERSISTENT LEDGER" : "MEMORY MODE"}
            </span>
          )}
          <div className="cvkick">TONIGHT&apos;S LOOKS — STYLED BY THE ASTERISK SYSTEM</div>
          {looks.map((lk, i) => (
            <a className="cvlook" key={i} href="/stylist">
              <div className="cvlookstrip">
                {/* thick floating frames (owner order, Aug 13): the lead
                    piece of each strip is the highlight — the frame also
                    captures empty space, State 3.0 style; images stay
                    straight, only lines get angles */}
                <i className={"tdrf " + (i === 0 ? "tdrfa" : "tdrfb")} aria-hidden="true" />
                {i === 1 && <i className="tdrf tdrfb2" aria-hidden="true" />}
                {(lk.items || []).slice(0, 4).map((it) => (
                  <img key={it.id} src={it.img || thumbFor(it)} alt="" />
                ))}
              </div>
              <div className="cvcredit">
                <span className="cclbl">ORDER No.</span>
                <span className="ccval">{String(i + 1).padStart(2, "0")}</span>
                <span className="cclbl">LOOK</span>
                <span className="ccval">{(lk.dominantTag || "LOOK").toUpperCase()}</span>
                <span className="cclbl">CREDITS</span>
                <span className="ccval">
                  CUT BY ASTERISK · {lk.conf} MATCH · USD {Math.round(lk.total || 0)}
                  {(lk.items || [])[0] ? ` · HIGHLIGHT — ${(lk.items[0].title || "").toUpperCase()}` : ""} →
                </span>
              </div>
            </a>
          ))}
          {looks.length === 0 && (
            <div className="pempty">
              the stylist needs a little taste to work with — stamp your
              PASSPORT and looks appear here.
            </div>
          )}
          <a className="cvlink cvmore" href="/stylist">OPEN THE STYLIST →</a>
        </section>
      </div>

      <div className="cvband2">
        <section className="cvposts" aria-label="the feed">
          <div className="cvkick">THE FEED — WHAT ARE YOU WEARING?</div>
          <div className="cvcompose">
            <Avatar name={getProfileInfo().name} />
            <div className="cvcomposebox">
              <textarea aria-label="your transmission"
                rows={3}
                maxLength={400}
                placeholder="today's uniform, tonight's find…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="cvcomposerow">
                <span className="ccount">{text.length}/400</span>
                <button className="btn postbtn" onClick={post} disabled={!text.trim()}>POST</button>
              </div>
            </div>
          </div>
          {postNote && <div className="pempty">{postNote}</div>}
          {(posts || []).slice(0, 4).map((p, i) => (
            <div className={"cvpost" + (i === 0 ? " cvlead" : "")} key={p.id}>
              <TransmissionText text={p.text} className="cvposttext" />
              <span className="cvposthandle">
                {/* bylines are links (owner order, Aug 13): yours home,
                    others to their page; server timestamps permalink */}
                {p.mine
                  ? <a className="whandle" href="/profile">{p.handle}</a>
                  : <a className="whandle" href={"/u/" + encodeURIComponent(p.handle)}>{p.handle}</a>}
                {p.mine ? <i className="cmine">you</i> : null}
                {" · "}
                {p.serverId != null
                  ? <a className="wperma" href={"/?post=" + encodeURIComponent(p.serverId)}>{timeAgo(p.at)}</a>
                  : timeAgo(p.at)}
              </span>
            </div>
          ))}
          {posts && !postsLive && (
            <div className="pempty">
              the shared wire could not be reached — showing this device&apos;s
              posts only.
            </div>
          )}
          {posts && postsLive && posts.length === 0 && (
            <div className="pempty">no transmissions yet — yours opens the Feed.</div>
          )}
        </section>

        {/* Was EXTERNAL DISPATCHES, printing invented headlines under real
            mastheads. A reading list now — the publication and what it covers,
            in ASILUM's words, linking to their front page. */}
        <section className="cvstories" aria-label="the reading room">
          <span className="cvside cvsider" aria-hidden="true">
            {sys && sys.alphaEvents != null ? `${sys.alphaEvents} EVENTS ON THE RECORD` : "THE RECORD IS LISTENING"}
          </span>
          <div className="cvkick">THE READING ROOM</div>
          {READING_ROOM.slice(0, 3).map((st) => (
            <a className="cvstory" key={st.pub} href={st.url} target="_blank" rel="noreferrer">
              <span className="cvpub">{st.pub.toUpperCase()}</span>
              {/* The beat line carries the ↗ where the invented headline used
                  to sit; there is no second line, because there is no story. */}
              <span className="cvstoryttl">{st.beat} ↗</span>
            </a>
          ))}
          <a className="cvlink cvmore" href="/">THE FULL FEED →</a>
        </section>
      </div>

      <nav className="cvindex" aria-label="subsystem index">
        {SUBSYSTEMS.map((s) => (
          <a key={s.label} href={s.href}>
            <b>{s.label}</b>
            <span>{s.meta}</span>
          </a>
        ))}
      </nav>

      <footer className="cvcolo" aria-label="colophon">
        *ASILUM LIVE EDITION · {stamp}
        {ledger && <> · SYSTEM LEDGER {ledger}</>}
        {" "}· EVERY VALUE ON THIS PAGE IS REAL STATE — NOTHING IS STAGED
      </footer>
    </div>
  );
}

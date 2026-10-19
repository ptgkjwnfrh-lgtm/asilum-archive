"use client";

// app/profile/page.js — PROFILE.
// Standard social format (owner order, Aug 12: Grailed × Twitter ×
// MySpace, legibility first), rebuilt in liquid glass on 9 Sep (owner: "the
// account page looks a little empty — instagram mixed with myspace mixed
// with grailed"): the identity header as one glass pane (banner, the avatar
// over its edge, name/handle/bio, the counts as big numbers — Instagram), a
// rail of the person's own page (ABOUT ME with the passport in preview —
// MySpace), and ONE tab row on a glass sheet holding everything —
// posts as a square grid, the CLOSET as a grid of pieces with brand and
// price (Grailed), brands, wardrobe, the room, sizing, and account.
// Identity is local until real accounts exist; every displayed count is
// derived from real local/server state, and "—" stands where nothing is
// measured.

import { useEffect, useState } from "react";
import {
  EMPTY_FIT, getUid, authorizedFetch, thumbFor, loadFitProfile,
  saveFitProfile, saveServerFitProfile, sendJSON, postJSON, SIGN_OUT_NOTICE,
} from "../../lib/client.js";
import {
  convertMeasurementUnit, hasMeasurementProfile, MEASUREMENT_KEYS,
} from "../../lib/brain/measurements.js";
import {
  getProfileInfo, saveProfileInfo, listPosts, timeAgo,
  mapServerPost, matchesLocalPost,
  followedUsers, followedBrands, setFollowBrand, setFollowUser, sourceFor,
} from "../../lib/social.js";
import { authConfigured, getSupabase } from "../../lib/supabase.js";
import { Avatar, UserSearch } from "../components/UserBits.jsx";
import GlassPane from "../components/GlassPane.jsx";
import PassportPreview from "../components/PassportPreview.jsx";
import ConnectionsRack from "../components/ConnectionsRack.jsx";
import ConnectionsWheel from "../components/ConnectionsWheel.jsx";
import TransmissionText from "../components/TransmissionText.jsx";
import BusinessAccountPanel from "../components/BusinessAccount.jsx";
import { WardrobeTab } from "../components/WardrobeTab.jsx";
import { RoomEditor } from "../components/ProfileRoom.jsx";
import StorefrontTab from "../components/StorefrontTab.jsx";
import { ScoreLine } from "../components/ScoreSheet.jsx";
import {
  ColorEvidenceLine, OriginLine, ProductFitLine, refreshFitProfile, useFitBrain,
} from "../components/ProductSignals.jsx";

export default function ProfilePage() {
  const fit = useFitBrain();
  const [info, setInfo] = useState(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("posts");
  const [posts, setPosts] = useState([]);
  const [bagHistory, setBagHistory] = useState([]);
  const [boardFollows, setBoardFollows] = useState(0);
  const [brandFollows, setBrandFollows] = useState(0);
  const [since, setSince] = useState("");

  useEffect(() => {
    setInfo(getProfileInfo());
    // POSTS reads the durable record (owner order, Aug 13): this
    // identity's visible transmissions from the server, merged with
    // device copies the server doesn't show yet (just posted, or held
    // for review) — those stay visible to their author, labeled. The
    // local list renders instantly; the server read upgrades it.
    const localMine = listPosts().filter((p) => p.mine);
    setPosts(localMine);
    authorizedFetch("/api/editorial?mine=1&limit=120&user=" + encodeURIComponent(getUid() || ""))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const server = (d.posts || []).map(mapServerPost).filter((p) => p.text)
          .map((p) => ({ ...p, mine: true }));
        setPosts([
          ...server,
          ...localMine
            .filter((m) => !server.some((s) => matchesLocalPost(m, s)))
            .map((m) => ({ ...m, localOnly: true })),
        ].sort((a, b) => b.at - a.at));
      })
      .catch(() => {});
    // MEMBER SINCE: same once-stamped device-real date the passport uses.
    try {
      let s = window.localStorage.getItem("asilum-member-since");
      if (!s) {
        const now = new Date();
        s = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        window.localStorage.setItem("asilum-member-since", s);
      }
      setSince(s);
    } catch {}
    const user = getUid() || "guest";
    authorizedFetch("/api/orders?user=" + encodeURIComponent(user))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setBagHistory(d.bagHistory || []); }).catch(() => {});
    authorizedFetch("/api/profile?user=" + encodeURIComponent(user))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setBoardFollows(((d.profile || {})._meta || {}).follows?.length || 0); })
      .catch(() => {});
  }, []);

  // BRANDS in the header counts FOLLOWED brands (metric-definition audit,
  // Aug 17 — it used to count distinct brands in bag history). Held in state
  // and refreshed on "asilum:follow" so the header agrees with the BRANDS tab
  // the moment a chip is toggled there; a render-time read would have gone
  // stale, because the tab keeps its own local copy.
  useEffect(() => {
    const read = () => setBrandFollows(followedBrands().length);
    read();
    window.addEventListener("asilum:follow", read);
    return () => window.removeEventListener("asilum:follow", read);
  }, []);

  // ACCOUNT and the one native STOREFRONT live as Profile subviews. Open a
  // named subview on fresh mounts and hash-only changes while already here;
  // every other fragment keeps the normal POSTS default.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === "#access") setTab("account");
      if (window.location.hash === "#storefront") setTab("storefront");
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ---- Landing from a password-reset link (found live, Aug 14) ----
  // This LIVES HERE, in the page that owns `tab`, and reads nothing but the
  // URL. Two things went wrong when it lived in ProfileAccess instead:
  //   1. ProfileAccess only mounts once the ACCOUNT tab is already open —
  //      the very thing this needs to cause — so it could never run first.
  //   2. `setTab` is not in scope there, so the call threw a ReferenceError
  //      that a bare `catch {}` swallowed, silently killing the notice and
  //      the URL cleanup that followed it. A catch that hides a typo is not
  //      error handling.
  // Both the set-a-new-password form and the notice live under ACCOUNT
  // while the page opens on POSTS, so arriving from a reset link — working
  // or expired — must open that tab or the reader sees nothing at all.
  useEffect(() => {
    let hash;
    try {
      hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
    } catch { return; }
    const code = hash.get("error_code");
    const failed = !!(code || hash.get("error"));
    const cameFromReset = new URLSearchParams(window.location.search).get("reset") === "1";
    if (!cameFromReset && !failed) return;

    setTab("account");
    if (failed) {
      // Supabase redirects here even when it REFUSES the link, with the
      // reason in the fragment (#error=access_denied&error_code=...).
      // Saying nothing is the worst answer available: the reader cannot
      // tell a dead link from a broken site. The notice rides the same
      // localStorage + event channel the ACCOUNT tab already reads, so it
      // is waiting there when that tab mounts.
      const described = (hash.get("error_description") || "").replace(/\+/g, " ");
      const message = code === "otp_expired"
        ? "that reset link has expired or was already used — links last about an hour. ask for a new one below."
        : described || "that link could not be used — ask for a new one below.";
      try {
        window.localStorage.setItem("asilum-auth-notice", message);
        window.dispatchEvent(new CustomEvent("asilum:auth-notice", { detail: message }));
        // Strip it so a refresh does not re-accuse a link already explained.
        const url = new URL(window.location.href);
        url.hash = "";
        url.searchParams.delete("reset");
        window.history.replaceState({}, "", url.toString());
      } catch {}
    }
  }, []);

  function save(k, v) {
    setInfo((prev) => { const n = { ...prev, [k]: v }; saveProfileInfo(n); return n; });
  }

  // Banner and avatar images are device-local (localStorage via profile
  // info), downscaled in-browser so they fit comfortably in storage.
  function pickImage(key, maxW) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const img = new Image();
      const url = URL.createObjectURL(f);
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        save(key, c.toDataURL("image/jpeg", 0.82));
        URL.revokeObjectURL(url);
      };
      img.src = url;
    };
    input.click();
  }

  if (!info) return <div className="wrap"><div className="empty">…</div></div>;

  // Brands seen in bag history. These are the BRANDS tab's *candidates* to
  // follow — they are not brands this reader follows, and the header counter no
  // longer reports them as such (metric-definition audit, Aug 17): with an
  // empty bag and five followed brands the header read "0 BRANDS" while the tab
  // listed five under FOLLOWING, and brand follows were counted in neither
  // FOLLOWING (readers + boards) nor BRANDS.
  const brands = [...new Set(bagHistory.map((o) => o.brand).filter(Boolean))];
  const followingCount = followedUsers().length + boardFollows;

  return (
    <div className="wrap pf2">
      {/* PROFILE had no page heading of any kind. The person's name is the
          honest h1 for their own profile; it falls back to the destination
          name before the profile has loaded one. */}
      <h1 className="a11yhead">{info.name ? `${info.name} — Profile` : "Profile"}</h1>

      {/* THE IDENTITY PANE (Instagram's header in the passport's glass, 9 Sep):
          the banner, the avatar over its edge, name / handle / bio, then the
          counts as big numbers. Every count is real. FOLLOWERS prints "—",
          not 0 (metric-definition audit, Aug 17): there is no follower state
          anywhere in lib/ or app/api, so a literal 0 would be a measurement
          of a thing nobody measures — the /stats rule applied here. */}
      <GlassPane glass="lg-pf-head" className="pfhead" aria-label="identity">
        <div
          className="pbanner"
          style={info.bannerImg ? { backgroundImage: `url(${info.bannerImg})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        >
          <span>*</span>
          {editing && (
            <div className="pbannerctl">
              <button className="ppupl" onClick={() => pickImage("bannerImg", 1400)}>⇪ BANNER</button>
              <button className="ppupl" onClick={() => pickImage("avatarImg", 240)}>⇪ AVATAR</button>
            </div>
          )}
        </div>
        <div className="phead2">
          <div className="pavatar">
            {info.avatarImg
              ? <img className="pavimg" src={info.avatarImg} alt={info.name || "avatar"} />
              : <Avatar name={info.name} />}
          </div>
          <div className="pident">
            {editing ? (
              <>
                <input className="pedit" aria-label="display name" value={info.name} onChange={(e) => save("name", e.target.value)} />
                <input className="pedit small" aria-label="handle" value={info.handle} onChange={(e) => save("handle", e.target.value)} />
                <textarea className="pedit small" aria-label="bio" rows={2} value={info.bio} onChange={(e) => save("bio", e.target.value)} />
              </>
            ) : (
              <>
                <div className="pname">{info.name}</div>
                <div className="uhandle">{info.handle}</div>
                <p className="pbio">{info.bio}</p>
              </>
            )}
            {since && <div className="pmeta">MEMBER SINCE {since}</div>}
            <div className="pcounts">
              <span><b>{posts.length}</b> POSTS</span>
              <span><b>{followingCount}</b> FOLLOWING</span>
              <span><b>{brandFollows}</b> BRANDS</span>
              <span><b title="ASILUM does not track followers yet">—</b> FOLLOWERS</span>
            </div>
          </div>
          <button className="btn ghost" onClick={() => setEditing((e) => !e)}>
            {editing ? "DONE" : "EDIT PROFILE"}
          </button>
        </div>
      </GlassPane>

      <div className="pflayout">
        {/* THE RAIL — the MySpace column, a page of the person's own: ABOUT
            ME, the TOP HOUSES eight-up, the PEOPLE they follow, THE FIT ON
            FILE. Every line is a real record; an empty one says where the
            record is made rather than inventing a row. */}
        <aside className="pfrail" aria-label="about this profile">
          {/* THE RAIL — ABOUT ME alone (owner, 9 Sep evening: "remove the
              left side bars and just leave the about me, and in the about
              me there should be a preview of the user's passport"): the
              bio, the passport in preview (PassportPreview.jsx — the same
              real state the document on /board reads), then the record's
              lines and the room link. */}
          <GlassPane glass="lg-pf-about" className="pfpane pfabout">
            <div className="pfk"><i aria-hidden="true">01</i>ABOUT ME</div>
            <p>{info.bio || "taste under construction."}</p>
            <PassportPreview />
            <div className="pfline"><span>HANDLE</span><b>{info.handle || "—"}</b></div>
            {/* the Passenger Score (slice 7): one five-star score on Account and Passport only */}
            <div className="pfline"><span>PASSENGER SCORE</span><b><ScoreLine subject={getUid()} name={info.handle || null} /></b></div>
            <div className="pfline"><span>MEMBER SINCE</span><b>{since || "—"}</b></div>
            <div className="pfline"><span>PIECES IN THE CLOSET</span><b>{bagHistory.length}</b></div>
            <div className="pfline"><span>YOUR ROOM</span><b><button type="button" className="wperma" onClick={() => setTab("room")}>OPEN →</button></b></div>
          </GlassPane>
        </aside>

        <main className="pfmain">
          <div className="tabs">
            {[
              ["posts", "POSTS"], ["bag", "CLOSET"], ["brands", "BRANDS"],
              ["wardrobe", "WARDROBE"], ["room", "ROOM"], ["sizing", "SIZING"],
              ["storefront", "STOREFRONT"],
              ["account", "ACCOUNT"],
            ].map(([k, label]) => (
              <button key={k} className={"tab" + (tab === k ? " cur" : "")} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>

          <GlassPane glass="lg-pf-sheet" className="pfsheet" aria-live="polite">
            {tab === "posts" && (
              <>
                {posts.length === 0 && (
                  <div className="empty">no transmissions yet — the POST disc on the deck publishes one into <a className="wperma" href="/">THE FEED →</a></div>
                )}
                {/* the grid (Instagram): one square per transmission — the
                    caption header, the text clamped, the time. A server post's
                    square is its permalink; a device-only copy stays a still
                    square, labeled, until the server holds it. */}
                {posts.length > 0 && (
                  <div className="pfgrid">
                    {posts.map((p) => {
                      const inner = (
                        <>
                          {p.title ? <div className="wposthead">{p.title}</div> : null}
                          <TransmissionText text={p.text} />
                          <span className="pftime">
                            {timeAgo(p.at)}
                            {p.serverId == null && " · on this device — pending or held"}
                            {p.editedAt ? <i className="wedited">· edited {timeAgo(p.editedAt)}</i> : null}
                          </span>
                        </>
                      );
                      return p.serverId != null
                        ? <a className="pftile" key={p.id} href={"/hotlist?post=" + encodeURIComponent(p.serverId)}>{inner}</a>
                        : <div className="pftile" key={p.id}>{inner}</div>;
                    })}
                  </div>
                )}
              </>
            )}

            {tab === "brands" && <BrandsTab bagBrands={brands} />}
            {tab === "wardrobe" && <WardrobeTab />}
            {tab === "room" && <RoomEditor />}
            {tab === "sizing" && <MeasurementsEditor />}
            {tab === "storefront" && <StorefrontTab />}
            {tab === "account" && (
              <>
                <ProfileAccess />
                <BusinessAccountPanel />
                <h3 className="statshead">FIND PEOPLE</h3>
                <div style={{ maxWidth: 420 }}>
                  <UserSearch placeholder="search users to follow…" />
                </div>
              </>
            )}

            {/* THE CLOSET (Grailed): the pieces from the bag's history as a
                grid — the picture, the title, the house and source, the
                colour / origin / fit lines, the price. */}
            {tab === "bag" && (
              <>
                {bagHistory.length === 0 && <div className="empty">nothing in the closet yet — the bag's history lands here.</div>}
                {bagHistory.length > 0 && (
                  <div className="pfcloset">
                    {bagHistory.slice(0, 24).map((o, i) => (
                      <a className="pfpiece" key={o.id + i} href={"/?item=" + encodeURIComponent(o.id)}>
                        <img src={o.img || thumbFor(o)} alt="" />
                        <div className="hlttl">{o.title}</div>
                        <div className="hlbrand">{o.brand} — {sourceFor(o)}</div>
                        <ColorEvidenceLine item={o} />
                        <OriginLine item={o} />
                        <ProductFitLine item={o} fit={fit} />
                        <div className="hlstat">{o.price ? `USD ${o.price}` : "—"}</div>
                      </a>
                    ))}
                  </div>
                )}
                <a className="btn ghost" href="/orders" style={{ display: "inline-block", marginTop: 16 }}>
                  ALL ORDERS & TICKETS →
                </a>
              </>
            )}
          </GlassPane>
        </main>
      </div>
    </div>
  );
}


function ProfileAccess() {
  const [authUser, setAuthUser] = useState(null);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // Password auth (owner order, Aug 13): create-account mode carries a
  // verify field and the little eye that opens.
  const [mode, setMode] = useState("signin"); // signin | create
  // Password recovery (owner directive, Aug 14 — backlog 7): true once
  // Supabase reports this page was opened from a reset link, which is the
  // only moment updateUser({password}) is allowed to stand in for knowing
  // the old one.
  const [recovering, setRecovering] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [people, setPeople] = useState(() => followedUsers());

  useEffect(() => {
    let active = true;
    try { setNotice(window.localStorage.getItem("asilum-auth-notice") || ""); } catch {}
    const noticeHandler = (event) => setNotice(event.detail || "");
    const followHandler = () => setPeople(followedUsers());
    window.addEventListener("asilum:auth-notice", noticeHandler);
    window.addEventListener("asilum:follow", followHandler);

    let subscription = null;
    getSupabase().then((sb) => {
      if (!active || !sb) return;
      subscription = sb.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        setAuthUser(session?.user || null);
        // PASSWORD_RECOVERY fires when the client consumes a reset link's
        // token. ?reset=1 alone is NOT enough to trust — anyone can type
        // it — so the query string only explains the wait; the event is
        // what opens the form.
        if (event === "PASSWORD_RECOVERY") setRecovering(true);
      })?.data?.subscription || null;
      // The event can fire before this listener attaches (the token is
      // consumed during client construction). If the URL says we came from
      // a reset and a session exists, honor it.
      try {
        if (new URLSearchParams(window.location.search).get("reset") === "1") {
          sb.auth.getSession().then(({ data }) => {
            if (active && data?.session) setRecovering(true);
          });
        }
      } catch {}
    });
    return () => {
      active = false;
      window.removeEventListener("asilum:auth-notice", noticeHandler);
      window.removeEventListener("asilum:follow", followHandler);
      subscription?.unsubscribe();
    };
  }, []);

  async function sendMagicLink() {
    const address = email.trim();
    if (!address || busy) return;
    setBusy(true);
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithOtp({
        email: address, options: { emailRedirectTo: window.location.origin + "/profile" },
      });
      publishNotice(error ? "could not send the link — " + error.message : "magic link sent — check your inbox");
    } catch { publishNotice("could not send the link — check the Supabase keys"); }
    setBusy(false);
  }

  async function passwordAuth() {
    const address = email.trim();
    if (busy) return;
    if (!address) { publishNotice("enter your email first"); return; }
    if (password.length < 8) { publishNotice("password must be at least 8 characters"); return; }
    if (mode === "create" && password !== confirm) { publishNotice("the two passwords do not match"); return; }
    setBusy(true);
    try {
      const sb = await getSupabase();
      if (mode === "create") {
        const { data, error } = await sb.auth.signUp({
          email: address, password,
          options: { emailRedirectTo: window.location.origin + "/profile" },
        });
        if (error) publishNotice("could not create the account — " + error.message);
        else if (data?.user && !data.session) publishNotice("account created — confirm it from your inbox, then sign in");
        else publishNotice("account created — you are signed in");
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: address, password });
        publishNotice(error ? "could not sign in — " + error.message : "signed in");
      }
      if (!busy) setPassword("");
      setConfirm("");
    } catch { publishNotice("authentication is not configured — check the Supabase keys"); }
    setBusy(false);
  }

  // Ask for a reset link. The answer is the SAME whether or not the
  // address holds an account — confirming it would make this an
  // account-enumeration oracle, which is exactly what sign-up already
  // takes care not to be.
  //
  // DEPLOYMENT REQUIREMENT (owner action, once): the redirectTo below must
  // appear in the project's redirect URL allow list —
  // Supabase dashboard → Authentication → URL Configuration → Redirect
  // URLs. Add "https://www.asilummagazine.com/profile" (and any preview
  // origin that needs it). Supabase silently refuses to redirect anywhere
  // not on that list, which looks like a broken reset link rather than a
  // configuration gap. The "Reset password" email template there is
  // enabled by default and needs no edit.
  async function sendReset() {
    const address = email.trim();
    if (busy) return;
    if (!address) { publishNotice("enter your email first"); return; }
    setBusy(true);
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.resetPasswordForEmail(address, {
        redirectTo: window.location.origin + "/profile?reset=1",
      });
      publishNotice(error
        ? "could not send the reset — " + error.message
        : "if that address holds an account, a reset link is on its way");
    } catch { publishNotice("could not reach the account service — check the Supabase keys"); }
    setBusy(false);
  }

  // Complete the reset. Reachable only while `recovering` is true, i.e.
  // Supabase confirmed the recovery token was consumed on this client.
  async function setNewPassword() {
    if (busy) return;
    if (password.length < 8) { publishNotice("password must be at least 8 characters"); return; }
    if (password !== confirm) { publishNotice("the two passwords do not match"); return; }
    setBusy(true);
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.updateUser({ password });
      if (error) {
        // The server's own words — its password policy is the authority,
        // and paraphrasing it would leave people guessing what to fix.
        publishNotice("could not set the password — " + error.message);
      } else {
        setRecovering(false);
        setPassword("");
        setConfirm("");
        publishNotice("password changed — you are signed in on this device");
        // Drop ?reset=1 so a refresh does not look like a fresh recovery.
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete("reset");
          window.history.replaceState({}, "", url.toString());
        } catch {}
      }
    } catch { publishNotice("could not reach the account service — check the Supabase keys"); }
    setBusy(false);
  }

  async function signOut() {
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signOut({ scope: "local" });
      if (error) throw error;
      setAuthUser(null);
      // Shared with app/shell.js's SIGNED_OUT handler: BOTH fire on sign-out
      // and raced with different wording until Aug 8. See SIGN_OUT_NOTICE.
      publishNotice(SIGN_OUT_NOTICE);
    } catch { publishNotice("could not sign out — try again"); }
  }

  function publishNotice(message) {
    setNotice(message);
    try {
      window.localStorage.setItem("asilum-auth-notice", message);
      window.dispatchEvent(new CustomEvent("asilum:auth-notice", { detail: message }));
    } catch {}
  }



  function unfollowPerson(handle) {
    setFollowUser(handle, false);
    setPeople(followedUsers());
  }

  return (
    <section className="pfsec" id="access">
      <div className="measurehead">
        <div>
          <div className="psub">ACCOUNT</div>
          <h2>One identity<span className="red">.</span></h2>
          <p className="deck">sign in, connect sources, and manage who you follow — it all lives here.</p>
        </div>
        <a className="btn ghost" href="/settings">SETTINGS →</a>
      </div>
      <div className="accountgrid">
        <div>
          <div className="psub">SIGN IN</div>
          {authConfigured() ? recovering ? (
            // Arrived from a reset link. This is the ONE moment a new
            // password may be set without proving the old one, so the
            // screen exists only while Supabase says the recovery token
            // was genuinely consumed.
            <>
              <div className="acctline">
                reset link opened{authUser?.email ? " for " + authUser.email : ""} — set a new password now.
              </div>
              <label className="accountemail">new password
                <span className="pwwrap">
                  <input type={showPw ? "text" : "password"} value={password}
                    placeholder="at least 8 characters"
                    autoComplete="new-password"
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") setNewPassword(); }} />
                  <button type="button" className="pweye" aria-label={showPw ? "hide password" : "show password"}
                    onClick={() => setShowPw((v) => !v)}>{showPw ? "◉" : "◡"}</button>
                </span>
              </label>
              <label className="accountemail">verify your password
                <input type={showPw ? "text" : "password"} value={confirm}
                  placeholder="the same password again"
                  autoComplete="new-password"
                  onChange={(event) => setConfirm(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") setNewPassword(); }} />
              </label>
              <button className="btn" disabled={busy} onClick={setNewPassword}>
                {busy ? "WORKING…" : "SET NEW PASSWORD"}
              </button>
            </>
          ) : authUser ? (
            <>
              <div className="acctline">{authUser.email || authUser.id} — signed in</div>
              <button className="btn ghost" onClick={signOut}>SIGN OUT</button>
            </>
          ) : (
            <>
              <div className="authmodes">
                <button className={"txtbtn" + (mode === "signin" ? " cur" : "")} onClick={() => setMode("signin")}>SIGN IN</button>
                <button className={"txtbtn" + (mode === "create" ? " cur" : "")} onClick={() => setMode("create")}>CREATE ACCOUNT</button>
              </div>
              <label className="accountemail">email
                <input type="email" value={email} placeholder="you@example.com"
                  onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label className="accountemail">password
                <span className="pwwrap">
                  <input type={showPw ? "text" : "password"} value={password}
                    placeholder={mode === "create" ? "at least 8 characters" : "your password"}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") passwordAuth(); }} />
                  <button type="button" className="pweye" aria-label={showPw ? "hide password" : "show password"}
                    onClick={() => setShowPw((v) => !v)}>{showPw ? "◉" : "◡"}</button>
                </span>
              </label>
              {mode === "create" && (
                <label className="accountemail">verify your password
                  <input type={showPw ? "text" : "password"} value={confirm} placeholder="the same password again"
                    onChange={(event) => setConfirm(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") passwordAuth(); }} />
                </label>
              )}
              <button className="btn" disabled={busy} onClick={passwordAuth}>
                {busy ? "WORKING…" : mode === "create" ? "CREATE ACCOUNT" : "SIGN IN"}
              </button>
              <button className="btn ghost" disabled={busy} onClick={sendMagicLink} title="passwordless — a link lands in your inbox">
                MAGIC LINK INSTEAD
              </button>
              {mode === "signin" && (
                <button className="btn ghost" disabled={busy} onClick={sendReset}
                  title="we email a link that lets you set a new password">
                  FORGOT PASSWORD
                </button>
              )}
            </>
          ) : <div className="acctline">Sign-in requires Supabase public keys in the deployment environment.</div>}
          {notice ? <div className="acctline accountnotice">{notice}</div> : null}
        </div>
        <div>
          <div className="psub">SOURCE CONNECTIONS</div>
          {/* V.2 §11: every connector with its explicit per-capability state
              (lib/connectors). The old row of "coming soon" buttons is gone:
              a state is a fact, a disabled button was a promise. */}
          <ConnectionsRack />
        </div>
        <div>
          <div className="psub">CONNECTIONS</div>
          {/* V.2 §11: the searchable list with A–Z shortcuts, and the optional wheel */}
          <ConnectionsWheel />
          <div className="psub">FOLLOWING — PEOPLE</div>
          {people.length ? <div className="tagfilter">
            {people.map((handle) => <button className="chip clickable cur" key={handle}
              onClick={() => unfollowPerson(handle)}>{handle} ×</button>)}
          </div> : <div className="acctline">No one followed yet — find people below.</div>}
        </div>
      </div>
    </section>
  );
}

function MeasurementsEditor() {
  const [profile, setProfile] = useState(EMPTY_FIT);
  const [status, setStatus] = useState("loading your fit profile…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const sync = (event) => {
      if (!active) return;
      const next = event?.detail ? { ...event.detail } : loadFitProfile();
      setProfile(next);
      setStatus(hasMeasurementProfile(next) ? "saved privately to this identity" : "not saved yet");
    };
    sync();
    window.addEventListener("asilum:fit", sync);
    refreshFitProfile().catch(() => {
      if (active) setStatus("using this device — save to sync securely");
    });
    return () => {
      active = false;
      window.removeEventListener("asilum:fit", sync);
    };
  }, []);

  function change(key, value) {
    setProfile((current) => ({ ...current, [key]: value }));
    setStatus("unsaved changes");
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await saveServerFitProfile(profile, getUid());
      setProfile(saved);
      setStatus("saved — listings will now check your measurements");
    } catch (error) { setStatus(error.message); }
    setSaving(false);
  }

  async function clear() {
    const response = await sendJSON("DELETE", "/api/measurements", { user: getUid() }).catch(() => null);
    if (!response?.ok) { setStatus("could not clear measurements"); return; }
    setProfile({ ...EMPTY_FIT });
    saveFitProfile({ ...EMPTY_FIT });
    setStatus("measurements cleared");
  }

  return (
    <section className="pfsec" id="measurements">
      <div className="measurehead">
        <div>
          <div className="psub">SIZING</div>
          <h2>Know before you buy<span className="red">.</span></h2>
          <p className="deck">private first-party fit scoring. ASILUM never sends these measurements to a model or merchant.</p>
        </div>
        <div className="unitpick" role="group" aria-label="measurement unit">
          {["in", "cm"].map((unit) => (
            <button key={unit} className={profile.unit === unit ? "on" : ""}
              onClick={() => { setProfile((current) => convertMeasurementUnit(current, unit)); setStatus("unsaved changes"); }}>
              {unit.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="measuregrid">
        <label>usual size
          <select value={profile.usualSize} onChange={(event) => change("usualSize", event.target.value)}>
            <option value="">—</option>
            {["XXS","XS","S","M","L","XL","XXL","XXXL"].map((size) => <option key={size}>{size}</option>)}
          </select>
        </label>
        {MEASUREMENT_KEYS.map((key) => (
          <label key={key}>{key} ({profile.unit})
            <input type="number" inputMode="decimal" min="0" step="0.1" value={profile[key]}
              placeholder={{ chest: "40", waist: "32", hips: "40", inseam: "31", height: "70" }[key]}
              onChange={(event) => change(key, event.target.value)} />
          </label>
        ))}
      </div>
      <div className="measureactions">
        <button className="btn" disabled={saving} onClick={save}>{saving ? "SAVING…" : "SAVE MEASUREMENTS"}</button>
        <button className="fitbtn" onClick={clear}>CLEAR</button>
        <span className="measurestatus">{status}</span>
      </div>
    </section>
  );
}

// Following section for brands: what you follow (removable) + brands from
// brands from your bag intent (followable).
function BrandsTab({ bagBrands }) {
  const [followed, setFollowed] = useState(() => followedBrands());
  function toggle(b) {
    const on = !followed.includes(b);
    setFollowed(setFollowBrand(b, on));
  }
  const candidates = bagBrands.filter((b) => !followed.includes(b));
  return (
    <>
      <h3 className="statshead" style={{ marginTop: 8 }}>FOLLOWING</h3>
      {followed.length === 0 ? (
        <div className="empty">no brands followed yet — follow one below or from any piece.</div>
      ) : (
        <div className="tagfilter">
          {followed.map((b) => (
            <button type="button" className="chip clickable cur" key={b} onClick={() => toggle(b)}>{b} ×</button>
          ))}
        </div>
      )}
      <h3 className="statshead">FROM YOUR BAG</h3>
      {candidates.length === 0 ? (
        <div className="empty">every bag brand is already followed — or nothing is bagged yet.</div>
      ) : (
        <div className="tagfilter">
          {candidates.map((b) => (
            <button type="button" className="chip clickable" key={b} onClick={() => toggle(b)}>+ {b}</button>
          ))}
        </div>
      )}
    </>
  );
}

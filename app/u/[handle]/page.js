"use client";

// app/u/[handle]/page.js — a poster's public page (the identity chain,
// owner order Aug 13: every wire byline lands somewhere REAL).
// Resolution order, all server truth:
//   1. A published ROOM at this handle → the room, with the poster's
//      visible transmissions beneath it.
//   2. No room but visible transmissions exist → an honest reader page:
//      their posts, plus "this reader hasn't published a room."
//   3. Neither → NOT FOUND.
// The "@"-prefixed MOCK_USERS demo layer keeps its old view (demo
// surfaces only reach it when demo social is enabled); claimed handles
// never start with "@".

import { use, useEffect, useState } from "react";
import { thumbFor, hashStr, aspectFor } from "../../../lib/client.js";
import { MOCK_USERS, listPosts, postStats, timeAgo, fetchPostsByHandle } from "../../../lib/social.js";
import { Avatar, FollowButton } from "../../components/UserBits.jsx";
import TransmissionText from "../../components/TransmissionText.jsx";
import { PublicRoom } from "../../components/ProfileRoom.jsx";
import { ColorEvidenceLine, OriginLine, OriginSticker, ProductFitLine, useFitBrain } from "../../components/ProductSignals.jsx";

// The poster's transmissions, wire-cut: caption headers, permalinked
// timestamps (server posts always have server ids here).
function WirePosts({ posts, live }) {
  return (
    <>
      {!live && (
        <div className="empty">the Feed could not be reached — their transmissions are unavailable right now.</div>
      )}
      {posts.map((p) => (
        <div className="fpost wpost" key={p.id}>
          {p.title ? <div className="wposthead">{p.title}</div> : null}
          <TransmissionText text={p.text} />
          <span className="fposthandle">
            {p.handle} ·{" "}
            <a className="wperma" href={"/hotlist?post=" + encodeURIComponent(p.serverId)}>{timeAgo(p.at)}</a>
            {p.editedAt ? <i className="wedited">· edited {timeAgo(p.editedAt)}</i> : null}
          </span>
        </div>
      ))}
    </>
  );
}

export default function UserPage({ params }) {
  const fit = useFitBrain();
  // Next 16 passes params as a promise — unwrap it, or the first render
  // sees an empty handle and every lookup below misfires.
  const handle = String(use(params).handle || "");
  const user = MOCK_USERS.find((u) => u.handle === handle);
  const [pieces, setPieces] = useState([]);
  const [posts, setPosts] = useState([]);
  const [wire, setWire] = useState(null);       // { posts, live } for real handles
  const [room, setRoom] = useState(null);
  const [roomChecked, setRoomChecked] = useState(!handle || handle.startsWith("@"));

  useEffect(() => {
    setPosts(listPosts().filter((p) => p.handle === handle));
    let stale = false;
    if (handle && !handle.startsWith("@")) {
      fetch("/api/profile/room?handle=" + encodeURIComponent(handle))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!stale) { setRoom(d?.room || null); setRoomChecked(true); } })
        .catch(() => { if (!stale) setRoomChecked(true); });
      fetchPostsByHandle(handle)
        .then((w) => { if (!stale) setWire(w); })
        .catch(() => { if (!stale) setWire({ posts: [], live: false }); });
    }
    if (user) {
      fetch("/api/discover?tag=" + encodeURIComponent(user.tags[0]) + "&limit=8")
        .then((r) => r.json())
        .then((d) => { if (!stale) setPieces(d.items || []); })
        .catch(() => {});
    }
    return () => { stale = true; };
  }, [handle]); // eslint-disable-line react-hooks/exhaustive-deps

  if (room) {
    return (
      <div className="wrap">
        <div className="locline"><a href="/">← THE FEED</a><span>/ {handle}</span></div>
        <PublicRoom room={room} handle={handle} />
        <h3 className="statshead">IN THE FEED</h3>
        {wire === null && <div className="empty">pulling their transmissions…</div>}
        {wire && wire.live && wire.posts.length === 0 && (
          <div className="empty">no transmissions yet.</div>
        )}
        {wire && <WirePosts posts={wire.posts} live={wire.live} />}
      </div>
    );
  }
  if (!roomChecked) return <div className="wrap"><div className="empty">…</div></div>;

  // No published room — but a real poster still gets a real page.
  if (!user && !handle.startsWith("@")) {
    if (wire === null) return <div className="wrap"><div className="empty">…</div></div>;
    if (wire.posts.length > 0 || !wire.live) {
      return (
        <div className="wrap">
          <div className="locline"><a href="/">← THE FEED</a><span>/ {handle}</span></div>
          <h1 className="headline"><span className="red">*</span>{handle}</h1>
          <p className="deck">
            this reader hasn&apos;t published a room — only their wire record
            speaks for them.
          </p>
          <h3 className="statshead">IN THE FEED</h3>
          <WirePosts posts={wire.posts} live={wire.live} />
        </div>
      );
    }
  }

  if (!user) {
    return (
      <div className="wrap">
        <h1 className="headline"><span className="red">*</span>NOT FOUND</h1>
        <p className="deck">no one wears that handle yet.</p>
        <a className="btn ghost" href="/">back to the feed</a>
      </div>
    );
  }

  const followers = 100 + (hashStr(handle) % 900);

  return (
    <div className="wrap">
      <div className="pbanner"><span>*</span></div>
      <div className="phead2">
        <div className="pavatar"><Avatar name={user.name} /></div>
        <div className="pident">
          <div className="pname">{user.name}</div>
          <div className="uhandle">{user.handle}</div>
          <p className="pbio">{user.tags.join(" / ").toLowerCase()} — taste on record.</p>
          <div className="pcounts">
            <span><b>{(hashStr(handle) >> 4) % 60}</b> FOLLOWING</span>
            <span><b>{user.tags.length}</b> AESTHETICS</span>
            <span><b>{followers}</b> FOLLOWERS</span>
          </div>
        </div>
        <FollowButton handle={user.handle} />
      </div>

      <h3 className="statshead">POSTS</h3>
      {posts.length === 0 && <div className="empty">quiet lately.</div>}
      {posts.map((p) => {
        const s = postStats(p);
        return (
          <div className="cpost" key={p.id}>
            <Avatar name={p.name} />
            <div className="cbody">
              <div className="chead">
                <span className="uname">{p.name}</span>
                <span className="uhandle">{p.handle} · {timeAgo(p.at)}</span>
              </div>
              <p className="ctext">{p.text}</p>
              <div className="cacts">
                <span className="castat" title="comments">○ {s.comments}</span>
                <span className="castat" title="reposts">↻ {s.reposts}</span>
                <span className="castat" title="likes">♥ {s.likes}</span>
              </div>
            </div>
          </div>
        );
      })}

      <h3 className="statshead">IN THEIR AESTHETIC</h3>
      <div className="grid">
        {pieces.map((it) => (
          <a className="card" key={it.id} href={"/?item=" + encodeURIComponent(it.id)}>
            <div className="imgwrap" style={{ aspectRatio: aspectFor(it.id) }}>
              <OriginSticker item={it} />
              <img src={it.img || thumbFor(it)} alt={it.title} loading="lazy" />
            </div>
            <div className="body">
              <div className="ttl">{it.title}</div>
              <ColorEvidenceLine item={it} />
              <OriginLine item={it} />
              <ProductFitLine item={it} fit={fit} />
              {it.price ? <div className="price">{it.currency || "USD"} {it.price}</div> : null}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

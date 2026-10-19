"use client";

// app/components/UserBits.jsx
// Reusable social atoms: monogram avatar, "Who to follow" module, and the
// user search bar. All follow state is local until real accounts exist.

import { useEffect, useState } from "react";
import { DEMO_SOCIAL_ENABLED, MOCK_USERS, searchUsers, followedUsers, setFollowUser, fetchFriends, isFriend } from "../../lib/social.js";

/** Monogram avatar — up to two initials. No image, so nothing to fail to
 *  load and no request to a third party for a picture of a person. */
export function Avatar({ name }) {
  const initials = String(name || "?")
    .split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return <span className="uavatar">{initials}</span>;
}

/** Follow toggle. Optimistic: the local state flips at once and the write
 *  syncs behind it, because a follow that waits for a round-trip feels broken.
 *  Seeds its initial state from the local follow list on first render. */
/** The viewer's friends, read once and refreshed on a follow (lib/social.js fetchFriends). */
export function useFriends() {
  const [friends, setFriends] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => fetchFriends().then((f) => { if (live) setFriends(f.friends); });
    load();
    window.addEventListener("asilum:friends", load);
    return () => { live = false; window.removeEventListener("asilum:friends", load); };
  }, []);
  return friends;
}

/** A name with the friend asterisk when the viewer and this handle follow each other: *handle. */
export function FriendName({ handle, children, className = "" }) {
  const friends = useFriends();
  const friend = isFriend(handle, friends);
  return <span className={("friendname" + (friend ? " friend" : "") + " " + className).trim()}>{friend ? <i className="friendmark" aria-label="friend">*</i> : null}{children ?? handle}</span>;
}

export function FollowButton({ handle }) {
  const [on, setOn] = useState(() => followedUsers().includes(handle));
  return (
    <button
      className={"followbtn" + (on ? " on" : "")}
      onClick={() => { setFollowUser(handle, !on); setOn(!on); }}
    >
      {on ? "Following ✓" : "Follow"}
    </button>
  );
}

/**
 * The "who to follow" module, paged.
 *
 * DEMO FIXTURES ONLY. When demo social is off, MOCK_USERS is empty and this
 * says so plainly rather than rendering an empty shelf that looks like nobody
 * uses the product — the constitution's no-faking rule applies to absence as
 * much as to invention.
 */
export function WhoToFollowList({ compact = false, withSearch = false }) {
  const [page, setPage] = useState(0);
  const per = compact ? 3 : 5;
  const slice = MOCK_USERS.slice(page * per, page * per + per);
  return (
    <>
      {!DEMO_SOCIAL_ENABLED && (
        <div className="pempty">real people appear here after account discovery ships. load-test profiles are hidden.</div>
      )}
      {withSearch && <UserSearch placeholder="find people…" />}
      {slice.map((u) => (
        <div className="urow" key={u.handle}>
          <a href={"/u/" + encodeURIComponent(u.handle)}><Avatar name={u.name} /></a>
          <a className="uinfo" href={"/u/" + encodeURIComponent(u.handle)}>
            <div className="uname">{u.name}</div>
            <div className="uhandle"><FriendName handle={u.handle} /> · {u.tags.join(" / ").toLowerCase()}</div>
          </a>
          <FollowButton handle={u.handle} />
        </div>
      ))}
      {MOCK_USERS.length > per && (
        <button
          className="modmore"
          onClick={() => setPage((p) => ((p + 1) * per >= MOCK_USERS.length ? 0 : p + 1))}
        >
          show more →
        </button>
      )}
    </>
  );
}

/** Search over the demo user fixtures. Never reaches real accounts — see
 *  searchUsers in lib/social.js. */
export function UserSearch({ placeholder = "search users…" }) {
  const [q, setQ] = useState("");
  const hits = searchUsers(q).slice(0, 5);
  return (
    <div className="usearch">
      <input
        type="text"
        value={q}
        aria-label={placeholder || "search people"}
        placeholder={placeholder}
        onChange={(e) => setQ(e.target.value)}
      />
      {q && (
        <div className="usearchhits">
          {hits.length === 0 && <div className="uhandle" style={{ padding: "8px 0" }}>no one yet — invite them.</div>}
          {hits.map((u) => (
            <div className="urow" key={u.handle}>
              <a href={"/u/" + encodeURIComponent(u.handle)}><Avatar name={u.name} /></a>
              <a className="uinfo" href={"/u/" + encodeURIComponent(u.handle)}>
                <div className="uname">{u.name}</div>
                <div className="uhandle"><FriendName handle={u.handle} /></div>
              </a>
              <FollowButton handle={u.handle} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

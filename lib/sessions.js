// lib/sessions.js — THE UNIVERSAL SESSION HUB, as a pure model (V.2
// Blueprint, owner, 17 Oct 2026, chapter 1 "Navigation and popup sessions").
//
// A SESSION is one exploration chain: a stack of popups with its own
// history. Direct message popups, search popups, map popups, overviews — all
// live in the same ten-slot hub (1.27). New popups EXTEND the active session;
// a separate session exists only when the passenger explicitly creates one
// (1.28, 1.29). Closing a popup does not erase its history: the session is
// kept until the passenger closes it (1.9), and reopening resumes exactly
// where it left off (1.3, 1.10).
//
// Laws held here, each with a test in tests/sessions.test.js:
//   1.1   a new popup replaces the visible one; the previous stays in history
//   1.2   Back restores the previous popup; with nothing left it dismisses
//   1.7   ten sessions, the counter reads 01/10
//   1.8   the eleventh opens the manager; nothing is discarded automatically
//   1.21  the counter is fixed-capacity: 01/10, 02/10 …
//   1.22  most recently used first
//   1.24  close with undo
//   1.32  identity updates automatically from the content
//   1.33  a custom title stays fixed once set
//   1.34  sensitive previews hidden by default (messages, bag, notices, checkout)
//
// Pure and isomorphic: no window, no React. The dock (lib/dockstate.js)
// holds one hub and persists it; the carousel reads it.

export const SESSION_LIMIT = 10;

/** Views whose previews could expose a person's private life to someone
 *  looking over their shoulder. Hidden in the carousel unless the passenger
 *  reveals eligible previews in Settings; payment and authentication
 *  screens are never shown (1.34). */
export const SENSITIVE_VIEWS = Object.freeze(["messages", "bag", "notices", "checkout", "signin"]);
export const NEVER_PREVIEWED = Object.freeze(["checkout", "signin"]);

/** What a view looks like in the carousel when it has no custom title. */
const IDENTITY = Object.freeze({
  likes: { icon: "heart", title: "LIKES" },
  bag: { icon: "bag", title: "BAG" },
  notices: { icon: "bell", title: "NOTICES" },
  search: { icon: "search", title: "SEARCH" },
  messages: { icon: "messages", title: "MESSAGES" },
  overview: { icon: "glasses", title: "OVERVIEW" },
  post: { icon: "post", title: "POST" },
  postselect: { icon: "post", title: "POST" },
  sessions: { icon: "disc", title: "SESSIONS" },
  listing: { icon: "bag", title: "LISTING" },
  media: { icon: "feed", title: "STILL" },
  echo: { icon: "disc", title: "ECHO" },
});

let seq = 0;
function makeId(now) { seq += 1; return "s" + now.toString(36) + "-" + seq.toString(36); }

/** An empty hub. */
export function createHub() {
  return { sessions: [], activeId: null, open: false, hubOpen: false, manager: false, undo: null };
}

export function activeSession(hub) {
  return hub.sessions.find((s) => s.id === hub.activeId) || null;
}

/** The popup on top of the active session, or null when nothing is open. */
export function topView(hub) {
  const s = activeSession(hub);
  if (!hub.open || !s || !s.stack.length) return null;
  return s.stack[s.stack.length - 1];
}

/** Sessions, most recently used first (1.22). */
export function ordered(hub) {
  return [...hub.sessions].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
}

/** The fixed-capacity counter (1.7, 1.21): the 1-based position of a session
 *  in MRU order over the limit, zero-padded — `01/10`. */
export function counter(hub, id) {
  const i = ordered(hub).findIndex((s) => s.id === id);
  const pos = i < 0 ? 0 : i + 1;
  return String(pos).padStart(2, "0") + "/" + String(SESSION_LIMIT).padStart(2, "0");
}

export function isFull(hub) { return hub.sessions.length >= SESSION_LIMIT; }

function touch(session, now) { return { ...session, updatedAt: now }; }
function replace(hub, session) {
  return { ...hub, sessions: hub.sessions.map((s) => (s.id === session.id ? session : s)) };
}

/** A blank session, made active and open (1.30, 1.31). At the limit nothing
 *  is created: the manager opens instead and the hub is otherwise unchanged
 *  (1.8). */
export function newSession(hub, { origin = "feed", now = Date.now() } = {}) {
  if (isFull(hub)) return { ...hub, manager: true, hubOpen: true };
  const session = { id: makeId(now), origin, title: null, stack: [], createdAt: now, updatedAt: now };
  return { ...hub, sessions: [...hub.sessions, session], activeId: session.id, open: true, hubOpen: false, manager: false };
}

/** Open a popup: it extends the active session (1.28). With no session yet,
 *  the first one is made for it. The same view already on top is replaced
 *  rather than stacked twice (opening Search again updates Search). Opening a
 *  view that sits lower in the stack pops back to it, so a chain never holds
 *  the same surface twice. */
export function openView(hub, view, props = {}, { origin = "feed", now = Date.now() } = {}) {
  let h = hub;
  let s = activeSession(h);
  if (!s) {
    h = newSession(h, { origin, now });
    if (h.manager) return h;
    s = activeSession(h);
  }
  const entry = { view, props: props || {} };
  const stack = [...s.stack];
  const where = stack.findIndex((e) => e.view === view);
  if (where >= 0) stack.splice(where);
  stack.push(entry);
  return { ...replace(h, touch({ ...s, stack }, now)), open: true, hubOpen: false };
}

/** A detail inside the popup — Back returns to what was there (1.1). */
export function pushView(hub, view, props = {}, opts = {}) {
  let h = hub;
  let s = activeSession(h);
  if (!s || !h.open) return openView(h, view, props, opts);
  const now = opts.now || Date.now();
  return { ...replace(h, touch({ ...s, stack: [...s.stack, { view, props: props || {} }] }, now)), open: true, hubOpen: false };
}

/** Back (1.2): the previous popup, or a dismissal when none is left. */
export function back(hub, { now = Date.now() } = {}) {
  const s = activeSession(hub);
  if (!s || !hub.open) return hub;
  if (s.stack.length <= 1) return dismiss(hub);
  return replace(hub, touch({ ...s, stack: s.stack.slice(0, -1) }, now));
}

/** Dismiss the popup (swipe down, Close, tap outside). The session and its
 *  history are kept (1.3, 1.9); only the popup leaves the screen. */
export function dismiss(hub) {
  return { ...hub, open: false, hubOpen: false, manager: false };
}

/** Bring a saved session forward (1.6, 1.11). It opens where it left off. */
export function switchSession(hub, id, { now = Date.now() } = {}) {
  const s = hub.sessions.find((x) => x.id === id);
  if (!s) return hub;
  const t = touch(s, now);
  return { ...replace(hub, t), activeId: id, open: t.stack.length > 0, hubOpen: false, manager: false };
}

/** Close a session (× or swipe up). Kept in `undo` so an accidental close
 *  can be reversed (1.24). The next most recently used session becomes
 *  active, closed — the passenger chose to leave, not to open another. */
export function closeSession(hub, id) {
  const i = hub.sessions.findIndex((x) => x.id === id);
  if (i < 0) return hub;
  const session = hub.sessions[i];
  const sessions = hub.sessions.filter((x) => x.id !== id);
  const rest = ordered({ ...hub, sessions });
  const activeId = hub.activeId === id ? (rest[0] ? rest[0].id : null) : hub.activeId;
  return { ...hub, sessions, activeId, open: hub.activeId === id ? false : hub.open, manager: false, undo: { session, index: i } };
}

export function undoClose(hub, { now = Date.now() } = {}) {
  if (!hub.undo) return hub;
  const { session, index } = hub.undo;
  const sessions = [...hub.sessions];
  sessions.splice(Math.min(index, sessions.length), 0, touch(session, now));
  return { ...hub, sessions, undo: null };
}

export function clearUndo(hub) { return hub.undo ? { ...hub, undo: null } : hub; }

/** A custom title stays fixed until changed again (1.33); an empty title
 *  returns the session to automatic identity. */
export function renameSession(hub, id, title) {
  const s = hub.sessions.find((x) => x.id === id);
  if (!s) return hub;
  const t = String(title || "").trim().slice(0, 40);
  return replace(hub, { ...s, title: t || null });
}

export function openHub(hub) { return { ...hub, hubOpen: true, manager: false }; }
export function closeHub(hub) { return { ...hub, hubOpen: false, manager: false }; }
export function closeManager(hub) { return { ...hub, manager: false }; }

/** The identity of a session for the carousel (1.23, 1.32): its icon and
 *  title follow the content on top of its stack until the passenger names it. */
export function identityOf(session) {
  const top = session.stack.length ? session.stack[session.stack.length - 1] : null;
  const base = top ? IDENTITY[top.view] || { icon: "disc", title: String(top.view || "").toUpperCase() } : { icon: "disc", title: "NEW SESSION" };
  let title = base.title;
  if (top && top.props) {
    if (top.view === "search" && top.props.q) title = "SEARCH · " + String(top.props.q).toUpperCase().slice(0, 24);
    if (top.view === "overview" && top.props.title) title = String(top.props.title).toUpperCase().slice(0, 28);
    if (top.props.title && top.view !== "overview" && top.view !== "search") title = String(top.props.title).toUpperCase().slice(0, 28);
  }
  return { icon: base.icon, title: session.title || title, auto: !session.title };
}

/** What the carousel may show for a session (1.34, 1.35): a static preview;
 *  sensitive content hidden by default, some never shown. */
export function previewFor(session, { revealSensitive = false } = {}) {
  const top = session.stack.length ? session.stack[session.stack.length - 1] : null;
  const view = top ? top.view : null;
  const never = view && NEVER_PREVIEWED.includes(view);
  const sensitive = view && SENSITIVE_VIEWS.includes(view);
  const id = identityOf(session);
  return {
    ...id,
    view,
    depth: session.stack.length,
    hidden: !!never || (!!sensitive && !revealSensitive),
    sensitive: !!sensitive,
  };
}

/** Everything that persists (1.9, 1.10): the sessions, which is active, and
 *  whether a popup was up. Undo and the manager are moments, not state. */
export function serialize(hub) {
  return JSON.stringify({ v: 2, sessions: hub.sessions, activeId: hub.activeId, open: hub.open });
}

export function hydrate(json) {
  const hub = createHub();
  if (!json) return hub;
  try {
    const d = JSON.parse(json);
    if (!d || d.v !== 2 || !Array.isArray(d.sessions)) return hub;
    const sessions = d.sessions
      .filter((s) => s && typeof s.id === "string" && Array.isArray(s.stack))
      .slice(0, SESSION_LIMIT)
      .map((s) => ({
        id: s.id, origin: String(s.origin || "feed"), title: s.title ? String(s.title).slice(0, 40) : null,
        stack: s.stack.filter((e) => e && typeof e.view === "string").map((e) => ({ view: e.view, props: e.props && typeof e.props === "object" ? e.props : {} })),
        createdAt: Number(s.createdAt) || 0, updatedAt: Number(s.updatedAt) || 0,
      }));
    const activeId = sessions.some((s) => s.id === d.activeId) ? d.activeId : null;
    const active = sessions.find((s) => s.id === activeId);
    return { ...hub, sessions, activeId, open: !!d.open && !!active && active.stack.length > 0 };
  } catch { return hub; }
}

"use client";

// app/components/PostCard.jsx — a post as a card in THE ONE FEED (V.2
// Blueprint, owner, 17 Oct 2026: "There is no Wire"; the six publishing
// types), drawn to the owner's references of 18 Oct 2026
// (docs/v2/references/2026-10-18-feed/2.jpg, 3.jpg): the media FILLS the
// rounded card; the author's handle and the caption sit over it bottom-left
// in white; four white outline actions run along the bottom — the heart
// (LIKE), the comment bubble, the hourglass (STAMP, the one save) and the
// share arrow — with the author's small circle at the right. A post that
// carries an event wears the BRDCST FOOTER hanging from the card, exactly as
// drawn: BRDCST large at the left, the date and time at the right, a rule,
// then "*event name" with a chevron that expands it inline, downward,
// staying attached to the post (5.2–5.6), with the essentials, the map
// popup (5.5) and the tickets link to the organizer's own site.
//
// The card wears its type — TRANSM · STILL · MOTION · BRDCST — read from
// what it carries (lib/feed/types.js postType); a STILL or MOTION takes the
// full width (Tetris weight 70%). Tapping the media enlarges it over the
// Feed (MediaFloat, the "media" popup). A real post carries its byline, its
// permalink and the people-counted LIKE; a sample carries its credit and the
// SAMPLE tag and never a LIKE. The comment bubble is `soon` — comments are
// not built — and says so; nothing here pretends.

import { useEffect, useRef, useState } from "react";
import TransmissionText from "./TransmissionText.jsx";
import SaveButton from "./SaveButton.jsx";
import ModelTag from "./ModelTag.jsx";
import Icon from "./Icons.jsx";
import { Avatar, FriendName } from "./UserBits.jsx";
import { readPostRefs } from "../../lib/model/media.js";
import { registerFeedVideo, feedPolicy } from "../../lib/media/feedplay.js";
import { footerPages } from "../../lib/brdcst/index.js";
import { postType, brdcstWhen } from "../../lib/feed/types.js";
import { openSheet } from "../../lib/dockstate.js";
import { haptic } from "../../lib/haptics.js";
import TagRow from "./TagChip.jsx";
import { ChevronText } from "./Chevrons.jsx";
import { tagsFor, visibleTags } from "../../lib/tagging/grammar.js";

const STATE_WORD = { draft: "DRAFT · UNPAID", scheduled: "SCHEDULED", active: "LIVE", ended: "ENDED", cancelled: "CANCELLED", under_review: "UNDER REVIEW" };

/** One event inside the footer: collapsed to its title and date until tapped (5.11). */
function BrdcstEvent({ event, open, onToggle }) {
  return (
    <li className={"brdcstev" + (open ? " open" : "")}>
      <button type="button" className="brdcstevhead" aria-expanded={open} onClick={() => { haptic("press"); onToggle(); }}>
        <b><i className="brdcstast" aria-hidden="true">*</i>{event.name}</b>
        <span className="brdcstwhen">{brdcstWhen(event)}{event.sample ? " · SAMPLE FIXTURE" : ""}</span>
      </button>
      {open ? (
        <div className="brdcstbody">
          <ChevronText className="fine" text={[String(event.kind || "").toUpperCase(), event.city, event.status ? String(event.status).toUpperCase() : null, event.admission].filter(Boolean).join(" · ")} />
          <div className="brdcstacts">
            {/* 5.5 (slice 12): the map opens above the post as a popup */}
            <button type="button" className="txtbtn" onClick={() => { haptic("press"); openSheet("map", { pin: event.id, title: "MAP" }); }}>PASSPORT MAP →</button>
            {event.sourceUrl ? <a className="txtbtn" href={event.sourceUrl} target="_blank" rel="noopener noreferrer">TICKETS · THE ORGANIZER ↗</a> : <span className="fine">tickets: no organizer link on record</span>}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The BRDCST footer (blueprint 5.2–5.6, 5.10–5.12; slice 8; the owner's
 * drawing of 18 Oct): the white is the post, the broadcast hangs from it.
 * The head reads BRDCST · the soonest event's date and time; under the rule
 * the event's name with the asterisk and the chevron. Expanded: five
 * soonest-first, each collapsed until tapped, the next five on a discreet
 * control. `brdcst` is the server's delivery note — the author sees the
 * campaign's state; a reader in reach sees the radius.
 */
export function BrdcstFooter({ event, events = null, brdcst = null }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState(null);
  const all = Array.isArray(events) && events.length ? events : event ? [event] : [];
  if (!all.length) return null;
  const pages = footerPages(all, { page });
  const first = pages.visible[0] || all[0];
  const meta = brdcst ? (brdcst.yours ? (STATE_WORD[brdcst.state] || String(brdcst.state).toUpperCase()) + (brdcst.radiusMi ? ` · ${brdcst.radiusMi} MI` : "") : brdcst.radiusMi ? `BRDCST: ${brdcst.radiusMi} MI` : null) : null;
  return (
    <div className={"brdcst" + (open ? " open" : "")}>
      <div className="brdcsthead">
        <b className="brdcstword">BRDCST{pages.more > 0 ? <small>+{pages.more}</small> : null}</b>
        <span className="brdcstwhen">{brdcstWhen(first)}{first.sample ? " · SAMPLE FIXTURE" : ""}</span>
      </div>
      <span className="brdcstrule" aria-hidden="true" />
      <button type="button" className="brdcstname" aria-expanded={open} onClick={() => { haptic("press"); setOpen((o) => !o); }}>
        <span><i className="brdcstast" aria-hidden="true">*</i>{first.name}</span>
        <Icon name="chevron" size={20} className={open ? "up" : ""} />
      </button>
      {open ? (
        <ul className="brdcstlist" aria-label={`${pages.total} event${pages.total === 1 ? "" : "s"}`}>
          {meta ? <li className="brdcstmeta fine">{meta}</li> : null}
          {pages.visible.map((ev) => <BrdcstEvent key={ev.id} event={ev} open={openId === ev.id || (pages.total === 1)} onToggle={() => setOpenId(openId === ev.id ? null : ev.id)} />)}
          {pages.pages > 1 ? (
            <li className="brdcstpage">
              <span className="fine">{pages.page + 1}/{pages.pages}</span>
              {pages.page > 0 ? <button type="button" className="txtbtn" onClick={() => setPage(pages.page - 1)}>← PREVIOUS FIVE</button> : null}
              {pages.next ? <button type="button" className="txtbtn" onClick={() => setPage(pages.page + 1)}>NEXT FIVE →</button> : null}
            </li>
          ) : null}
          {brdcst && brdcst.yours && brdcst.state === "draft" ? <li className="brdcstpage"><a className="txtbtn" href="/board?tab=studio">PAY THE BRDCST IN THE STUDIO →</a></li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/** A MOTION in the Feed (slice 9, 3.3): muted adaptive autoplay — the most
 *  visible plays, the others pause, captions during muted autoplay, nothing
 *  when the passenger or the platform says no (lib/media/feedplay.js). The
 *  tap enlarges it into the housing. A generated sample says so. */
function MotionMedia({ video, id, onMedia, label }) {
  const ref = useRef(null);
  const [policy, setPolicy] = useState(null);
  useEffect(() => { setPolicy(feedPolicy()); return registerFeedVideo(ref.current, id); }, [id]);
  const trackSrc = (tr) => (video.generated ? tr.src : `/api/editorial/motion?captions=${encodeURIComponent(video.id)}&lang=${encodeURIComponent(tr.lang)}`);
  return (
    <figure className="wpcfig wpcmotion">
      <button type="button" className="wpcmedia" onClick={onMedia} aria-label={label || "open the motion"}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={ref} src={video.url} poster={video.poster || undefined} muted playsInline loop preload="metadata" aria-label={label || "motion"} data-rotation={video.rotation || 0}>
          {(video.captions || []).map((tr) => <track key={tr.lang} kind="captions" srcLang={tr.lang} label={tr.label || tr.lang} src={trackSrc(tr)} />)}
        </video>
        <span className="wpcmotiontag" aria-hidden="true">MOTION · {Math.round((video.durationMs || 0) / 1000)}s{policy && !policy.autoplay ? " · " + policy.reason : ""}</span>
      </button>
      {video.generated ? <figcaption>SAMPLE MOTION · GENERATED TEST PATTERN AND TEST TONE</figcaption> : null}
    </figure>
  );
}

/** The composition's media, rendered by layout. Every image carries the
 *  author's alt; an exposé's layers are text over the image AND a readable
 *  caption beneath it. */
function Media({ p, onMedia }) {
  const a = p.attachments || {};
  const media = Array.isArray(a.media) ? a.media : [];
  const urls = media.map((m) => m.url || (p.imageUrl && media.indexOf(m) === 0 ? p.imageUrl : null)).filter(Boolean);
  const layout = p.layout || (media.length > 1 ? "carousel" : media.length ? "single" : null);
  return (
    <>
      {a.video && a.video.url && <MotionMedia video={a.video} id={p.serverId ?? p.id} onMedia={onMedia} label={"open the motion: " + (p.title || "")} />}
      {layout === "expose" && urls[0] && (
        <figure className="wpcfig wpcexpose">
          <button type="button" className="wpcmedia" onClick={onMedia} aria-label="enlarge the photograph"><img src={urls[0]} alt={media[0].alt || a.alt || ""} loading="lazy" /></button>
          {(a.layers || []).map((l, i) => (
            <span key={i} className={`wpclayer pos-${l.position || "bottom"} al-${l.align || "left"} col-${l.color || "paper"} f-${l.font || "display"}`} aria-hidden="true">{l.text}</span>
          ))}
          <figcaption className="wpclayercap">{(a.layers || []).map((l) => l.text).join(" · ")}</figcaption>
        </figure>
      )}
      {(layout === "single" || (layout === "event" && urls.length === 1)) && urls[0] && layout !== "expose" && (
        <figure className="wpcfig"><button type="button" className="wpcmedia" onClick={onMedia} aria-label="enlarge the photograph"><img src={urls[0]} alt={media[0] && media[0].alt || a.alt || ""} loading="lazy" /></button></figure>
      )}
      {layout === "carousel" && urls.length > 0 && (
        <div className="wpccarousel" role="group" aria-label={`${urls.length} images`}>
          {urls.map((u, i) => <button key={u} type="button" className="wpcmedia" onClick={onMedia} aria-label={"enlarge photograph " + (i + 1)}><img src={u} alt={media[i] && media[i].alt || ""} loading="lazy" /></button>)}
          <span className="wpccount" aria-hidden="true">{urls.length}</span>
        </div>
      )}
    </>
  );
}

/** The snapshots a composition carries beneath its media: tagged pieces
 *  (each opens its LISTING) and the link — the snapshots the server stored,
 *  never fetched HTML. */
function Extras({ p }) {
  const a = p.attachments || {};
  return (
    <>
      {Array.isArray(a.pieces) && a.pieces.length > 0 && (
        <ul className={"wpcpieces" + (p.layout === "fragment" ? " fragment" : "")} aria-label="tagged pieces">
          {a.pieces.map((pc) => (
            <li key={pc.id}>
              <button type="button" onClick={() => openSheet("listing", { id: pc.id, title: "LISTING" })}>
                {pc.img ? <img src={pc.img} alt="" loading="lazy" /> : <span className="wpcpieceblank" aria-hidden="true" />}
                <b>{pc.brand}</b><span>{pc.title}</span>{pc.price != null ? <i>{pc.currency || "USD"} {pc.price}</i> : null}
              </button>
              <TagRow tags={visibleTags(tagsFor(pc)).shown} size="card" />
            </li>
          ))}
        </ul>
      )}
      {a.link && (
        <a className="wpclink" href={a.link.url} target="_blank" rel="noreferrer">
          {a.link.image ? <img src={a.link.image} alt="" loading="lazy" /> : null}
          <span className="wpclinkbody"><span className="cclbl">{a.link.site || a.link.host} ↗</span><b>{a.link.title || a.link.url}</b>{a.link.description ? <span>{a.link.description}</span> : null}</span>
        </a>
      )}
    </>
  );
}

/** The four outline actions (the reference's heart, bubble, hourglass,
 *  arrow) and the author's circle. A sample carries no LIKE and no share of
 *  its own; the bubble is soon. */
function Actions({ p, eng, onEngage, sample, href, name, image }) {
  const [shared, setShared] = useState("");
  async function share() {
    haptic("press");
    const url = window.location.origin + href;
    try {
      if (navigator.share) await navigator.share({ url, title: p.title || name });
      else await navigator.clipboard.writeText(url);
      setShared("link copied ✓");
    } catch { setShared(""); }
    setTimeout(() => setShared(""), 1800);
  }
  return (
    <div className="wpcacts" role="group" aria-label="post actions">
      {eng
        ? <button type="button" className={"wpcact" + (eng.youLike ? " on" : "")} aria-pressed={!!eng.youLike} onClick={() => { haptic("press"); onEngage && onEngage(p, "like"); }} aria-label={"like" + (eng.likes > 0 ? ", " + eng.likes : "")} title="LIKE"><Icon name="heart" size={22} />{eng.likes > 0 ? <b>{eng.likes}</b> : null}</button>
        : <span className="wpcact quiet" title={sample ? "a sample carries no LIKE" : "LIKE arrives with the post's record"} aria-hidden="true"><Icon name="heart" size={22} /></span>}
      <span className="wpcact soon" title="comments are not built yet" aria-label="comments — not built yet"><Icon name="comment" size={22} /></span>
      <SaveButton className="wpcact" icon="hourglass" kind="post" id={sample ? p.id : String(p.serverId ?? p.id)} title={p.title || (p.text || "").slice(0, 80)} image={image ? image.src : ""} href={href} meta={name} tags={sample ? p.tags : (p.tags || [])} labels={["STAMP", "STAMPED ✓"]} />
      {sample
        ? <span className="wpcact quiet" title="a sample has no link of its own" aria-hidden="true"><Icon name="share" size={22} /></span>
        : <button type="button" className="wpcact" onClick={share} aria-label="share the post" title={shared || "SHARE"}><Icon name="share" size={22} /></button>}
      {shared ? <span className="wpcshared" role="status">{shared}</span> : null}
      <span className="wpcorb">
        {sample ? <Avatar name={name} /> : <a href={p.mine ? "/profile" : "/u/" + encodeURIComponent(p.handle)} aria-label={"the author, " + name}><Avatar name={name} /></a>}
      </span>
    </div>
  );
}

export default function PostCard({ post: p, engagement, onEngage }) {
  const [more, setMore] = useState(0);
  const sample = !!p.sample;
  const type = postType(p);
  const refs = sample ? { category: p.category, intent: p.intent } : readPostRefs(p.tags || []);
  const composed = !sample && p.attachments && Object.keys(p.attachments).length > 0;
  const a = p.attachments || {};
  const image = sample ? p.image : (!composed && p.imageUrl ? { src: p.imageUrl, alt: "", credit: "", url: "" } : null);
  const name = sample ? p.name : (p.name || p.handle);
  const eng = !sample && p.serverId != null && engagement ? engagement[String(p.serverId)] : null;
  const href = sample ? "/" : (p.serverId != null ? "/?post=" + encodeURIComponent(p.serverId) : "/");
  const hasMedia = type === "STILL" || type === "MOTION";
  const onMedia = hasMedia ? () => { haptic("press"); openSheet("media", sample ? { id: p.id, sample: true, title: type } : { id: p.serverId, title: type }); } : undefined;
  const events = a.event || (a.events && a.events.length) ? <BrdcstFooter event={a.event} events={a.events} brdcst={a.brdcst || null} /> : null;
  const caption = (
    <div className="wpcover">
      <span className="wpchandle">{sample ? name : <FriendName handle={p.handle}>{name}</FriendName>}{sample ? <ModelTag kind="sample">SAMPLE</ModelTag> : null}</span>
      {p.title ? <a className="wpcttl" href={href}>{p.title}</a> : null}
      {/* a compacted caption expands on a tap and the rest loads in from >>>>>> (owner, 18 Oct) */}
      {more ? (
        <button type="button" className="wpccapbtn open" aria-expanded="true" onClick={() => setMore(0)}><ChevronText as="span" className="wpccap full" text={p.text} play={more} /></button>
      ) : (
        <button type="button" className="wpccapbtn" aria-expanded="false" onClick={() => { haptic("press"); setMore((m) => m + 1); }}><TransmissionText text={p.text} className="wpccap" /></button>
      )}
      <Actions p={p} eng={eng} onEngage={onEngage} sample={sample} href={href} name={name} image={image} />
    </div>
  );
  return (
    <article className={"card wpostcard type-" + type.toLowerCase() + (sample ? " sample" : "") + (hasMedia ? " withmedia" : "")} data-id={"post:" + (p.serverId ?? p.id)} data-type={type} aria-label={type.toLowerCase() + (sample ? " (sample editorial): " : ": ") + (p.title || name)}>
      {hasMedia ? (
        <div className="wpcstage">
          {composed && <Media p={p} onMedia={onMedia} />}
          {sample && p.video && <MotionMedia video={p.video} id={p.id} onMedia={onMedia} label={"open the sample motion: " + (p.title || "")} />}
          {image && !p.video && (
            <figure className="wpcfig">
              <button type="button" className="wpcmedia" onClick={onMedia} aria-label="enlarge the photograph"><img src={image.src} alt={image.alt || ""} loading="lazy" /></button>
            </figure>
          )}
          {caption}
        </div>
      ) : (
        <div className="wpcbody">
          <span className="typechip">{type}{refs.intent ? " · " + refs.intent.toUpperCase() : ""}</span>
          {caption}
        </div>
      )}
      {image && image.credit ? <span className="wpccredit"><a href={image.url} target="_blank" rel="noreferrer">{image.credit}</a></span> : null}
      {composed ? <Extras p={p} /> : null}
      {events}
    </article>
  );
}

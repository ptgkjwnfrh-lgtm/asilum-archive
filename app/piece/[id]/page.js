// app/piece/[id]/page.js — a STABLE, SHAREABLE URL for one piece.
//
// Option (a) of the ruling in docs/seo-notes.md §"Stable product URLs", chosen
// by the owner. This route exists to solve exactly one problem: a shared piece
// link previewed as the generic site card, because `/?item=<id>` is a query
// parameter on a CLIENT component and a client component cannot export
// generateMetadata.
//
// It deliberately does NOT render item depth. `asilum-ui` rule 8 is an owner
// decree — "item depth belongs to the item modal" — so this page carries the
// metadata, shows an honest no-JavaScript fallback, and hands the reader to
// `/?item=<id>` where the modal opens as it always has. Depth stays in one
// place; only the URL gets better.
//
// robots: noindex, and NOT disallowed in robots.txt. Those are different jobs
// and the combination is deliberate: noindex keeps a synthetic product out of
// search results (docs/seo-notes.md refuses to court indexing for sample data),
// while leaving the path crawlable is what lets a social scraper FETCH the page
// and read the card. Disallowing it would break the very preview this route was
// built to fix.

import { getItem } from "../../../lib/db/index.js";
import { isDemoItem } from "../../../lib/social.js";
import PieceHandoff from "./handoff.js";
import { SITE_ORIGIN } from "../../../lib/site.js";

const BASE = SITE_ORIGIN;

// One shared read, so generateMetadata and the page body cannot disagree about
// what this piece is.
async function readPiece(id) {
  try {
    return await getItem(String(id || ""));
  } catch {
    return null;
  }
}

function describe(item) {
  const brand = item.brand ? String(item.brand) : "";
  const title = item.title ? String(item.title) : "a piece";
  const name = brand && !title.toLowerCase().includes(brand.toLowerCase())
    ? `${brand} — ${title}`
    : title;
  // The demo sentence is not decoration. A link preview is a claim made to
  // someone who has not seen the page, so it carries the same warning the
  // catalog shows in a red-bordered banner.
  const demo = isDemoItem(item)
    ? "A synthetic sample record — not real inventory, not for sale."
    : "";
  const facts = [item.category, item.era && String(item.era.decade || item.era.raw || item.era)]
    .filter((v) => v && typeof v === "string")
    .join(" · ");
  // "dresses · 2020s. A synthetic sample record…" — the stop matters, or the
  // two halves run together in every preview card.
  return { name, description: facts ? `${facts}. ${demo}`.trim() : demo };
}

/**
 * Per-piece metadata for the tab title and social preview cards.
 *
 * Next.js calls this on the server before render. A missing piece returns
 * "piece not found" metadata rather than throwing — the 404 body is the page's
 * job, and a metadata failure would take the whole route down with it.
 */
export async function generateMetadata({ params }) {
  const { id } = await params;
  const item = await readPiece(id);
  if (!item) {
    return {
      title: "piece not found",
      robots: { index: false, follow: false },
      alternates: { canonical: `/piece/${encodeURIComponent(String(id || ""))}` },
    };
  }
  const { name, description } = describe(item);
  const url = `${BASE}/piece/${encodeURIComponent(item.id)}`;
  return {
    title: name,
    description,
    // Self-referential: this IS the piece's stable URL.
    alternates: { canonical: `/piece/${encodeURIComponent(item.id)}` },
    // Synthetic products stay out of the index. See the header note on why this
    // is noindex rather than a robots.txt disallow.
    robots: { index: false, follow: false },
    openGraph: {
      title: `${name} · *ASILUM`,
      description,
      url,
      siteName: "*ASILUM",
      type: "website",
      locale: "en_US",
    },
    twitter: { card: "summary", title: `${name} · *ASILUM`, description },
  };
}

export default async function PiecePage({ params }) {
  const { id } = await params;
  const item = await readPiece(id);
  const target = item ? `/?item=${encodeURIComponent(item.id)}` : "/";

  return (
    <div className="wrap">
      {/* The handoff is the whole point: the modal is where depth lives. */}
      <PieceHandoff target={target} />

      {/* Everything below is the no-JavaScript fallback. It is deliberately
          thin — a name, the honest demo note, and a real link — because a
          fuller rendering here would be the item depth rule 8 reserves for the
          modal. */}
      <h1 className="headline">
        <span className="red">*</span>{item ? describe(item).name : "PIECE NOT FOUND"}
      </h1>
      {item ? (
        <>
          <p className="deck">{describe(item).description}</p>
          <p className="legal">
            opening this piece in the catalog…{" "}
            <a className="wperma" href={target}>open it now →</a>
          </p>
        </>
      ) : (
        <p className="deck">
          that piece is not in the archive.{" "}
          <a className="wperma" href="/">back to the catalog →</a>
        </p>
      )}
    </div>
  );
}

// The storefront is a public view of native catalog records, not a second
// seller site. Product depth still belongs to the shared `/?item=` surface;
// the client below only reads the public-safe storefront envelope.

import { PublicStorefront } from "../../components/StorefrontTab.jsx";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const safeSlug = String(slug || "");
  return {
    title: safeSlug ? `${safeSlug.replaceAll("-", " ")} storefront` : "storefront",
    alternates: { canonical: `/store/${encodeURIComponent(safeSlug)}` },
  };
}

export default async function StorefrontPage({ params }) {
  const { slug } = await params;
  return (
    <div className="wrap sfroute">
      <div className="locline">
        <a href="/">← THE FEED</a>
        <span>/ NATIVE STOREFRONT</span>
        <a href="/profile#storefront">MANAGE YOUR STORE →</a>
      </div>
      <PublicStorefront slug={String(slug || "")} />
    </div>
  );
}

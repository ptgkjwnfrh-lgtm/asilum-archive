// Generated for route metadata only. The page itself is a client component and
// cannot export `metadata`, so the segment layout carries it. This renders its
// children unchanged — it adds no markup.
import { siteUrl } from "../../lib/site.js";

export const metadata = {
  title: "THE HOTLIST",
  description:
    "The hotlist — what ASILUM is reading and wearing right now.",
  alternates: { canonical: "/hotlist" },
  openGraph: {
    title: "THE HOTLIST · *ASILUM",
    description:
      "The hotlist — what ASILUM is reading and wearing right now.",
    url: siteUrl("/hotlist"),
    siteName: "*ASILUM",
    type: "website",
    locale: "en_US",
  },
};

export default function Layout({ children }) {
  return children;
}

// next.config.mjs — Next.js configuration for ASILUM: the security headers
// (a strict Content-Security-Policy that allows only Stripe's script, HSTS in
// production, no framing) and the redirects that send every alternate host
// to the canonical site origin (lib/site.js).

import { REDIRECT_HOSTS, SITE_ORIGIN } from "./lib/site.js";

const isProduction = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  // js.stripe.com is the ONE external script: Stripe's Payment Element in
  // the checkout housing (card fields render in Stripe-hosted iframes —
  // SAQ-A; card data never touches this origin).
  `script-src 'self' 'unsafe-inline' https://js.stripe.com${isProduction ? "" : " 'unsafe-eval'"}`,
  "frame-src 'self' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "media-src 'self' blob: https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // One canonical host. Every duplicate host that serves this project hands its
  // traffic to SITE_HOST; the list and the never-redirect-to-yourself filter live
  // in lib/site.js. Preview deployments (asilum-git-*, per-PR URLs) are NOT
  // matched: Vercel already noindexes them and they must stay reachable.
  //
  // THE APEX WAS ADDED 17 AUGUST (ruling 7's code half). `A @ -> 76.76.21.21`
  // points the apex at this same project, so `asilummagazine.com` was serving a
  // complete, indexable copy of the site whose every canonical named `www` — the
  // stated principle above was true of the vercel.app alias and quietly false of
  // the apex. Safe for auth: reset links use `redirectTo:
  // window.location.origin + "/profile?reset=1"`, so once a visitor lands on
  // www the origin they send IS www, and a 308 preserves path and query for any
  // older link that still names the apex. The token exchange happens on
  // supabase.co, not here.
  //
  // A `has` host value is matched EXACTLY — verified by request, not assumed,
  // because a substring match would make www redirect to itself and take the
  // site down. See tests/canonical-host.test.js.
  async redirects() {
    return REDIRECT_HOSTS.map((host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: `${SITE_ORIGIN}/:path*`,
      permanent: true,
    }));
  },
};

export default nextConfig;

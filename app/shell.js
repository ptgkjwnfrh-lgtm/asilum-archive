"use client";

// app/shell.js
// The shell around every page (V.2 Blueprint, owner, 17 Oct 2026). Three
// fixtures and nothing else: the INFO DOCK at the top left (likes, bag,
// notices), the PASSPORT BUTTON at the top right (the globe), and the
// CENTRAL CONTROL DECK at the bottom (FEED · SEARCH · POST · MESSAGES ·
// ACCOUNT, with the ad ticker beneath). Secondary surfaces rise over the
// root from SheetHost. The magazine header — wordmark, marquee, big
// search/bag/sign-in, the destination row and the liquid-glass refraction
// drawn for it — left with the blueprint; the wordmark lives on as
// app/components/Wordmark.jsx on the Feed's masthead, and the house lines
// of the marquee run in the deck's ticker (lib/dock.js HOUSE_LINES).
//
// What stays here is identity: the server-issued device cookie, the
// Supabase session, adoption on sign-in, and what kind of account is
// reading. Account controls live on PROFILE so identity has one obvious
// home.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  clearFitProfile, getUid, setUid, authorizedFetch, SIGN_OUT_NOTICE,
} from "../lib/client.js";
import { getSupabase } from "../lib/supabase.js";
import ConsentMoment from "./components/ConsentMoment.jsx";
import AccountSignup from "./components/AccountSignup.jsx";
import DesignConsole from "./components/DesignConsole.jsx";
import { DEFAULT_KIND } from "../lib/accounts.js";
import SavePrompt from "./components/SavePrompt.jsx";
import ControlCenter from "./components/ControlCenter.jsx";
import SheetHost from "./components/SheetHost.jsx";
import InfoDock from "./components/InfoDock.jsx";
import { MusicHost } from "./components/MusicCircle.jsx";
import { hydrateMediaPreferences } from "../lib/media/preferences.js";
import PassportButton from "./components/PassportButton.jsx";
import { useGlassReactive } from "./components/LiquidGlass.jsx";

export default function Shell({ children }) {
  const pathname = usePathname();
  const pendingAdoptionRef = useRef(null);
  const deviceIdentityRef = useRef(null);

  useEffect(() => {
    // Clear the stale "connected" flag from the old simulated import — no
    // real connection exists until a real OAuth adapter ships.
    try { window.localStorage.removeItem("asilum-connected"); } catch {}
    // the media preferences' account copy wins a fresh device (3.10, slice 9)
    hydrateMediaPreferences();
    window.addEventListener("asilum:identity", hydrateMediaPreferences);
  }, []);

  // THE REACTIVE RAINBOW (owner, 18 Oct 2026): one listener set for the
  // whole app drives the glass of the fixtures, the deck and the popup
  // (LiquidGlass.jsx useGlassReactive); reduced motion keeps it still.
  useGlassReactive();

  // PAGE GRADIENTS (owner, 18 Oct 2026): the page names itself on <html> so
  // its gradient takes the destination's own light (--page-tint in
  // globals.css). The Feed is the default; nothing else reads the attribute.
  useEffect(() => {
    const p = String(pathname || "/");
    const page = p === "/" ? "feed" : p.startsWith("/passport") || p.startsWith("/board") ? "passport" : p.startsWith("/profile") || p.startsWith("/settings") || p.startsWith("/analytics") ? "account" : p.startsWith("/map") ? "map" : "other";
    document.documentElement.dataset.page = page;
  }, [pathname]);

  // Theme follows the device unless the owner picked one in SETTINGS
  // (blueprint 2.24). The pre-paint script (app/layout.js) resolves the
  // first frame; this listener keeps an un-pinned session in step with a
  // live OS switch.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const followDevice = () => {
      let stored = null;
      try { stored = window.localStorage.getItem("asilum-theme"); } catch {}
      if (stored !== "dark" && stored !== "light") {
        document.documentElement.dataset.theme = mq.matches ? "light" : "dark";
      }
    };
    mq.addEventListener("change", followDevice);
    return () => mq.removeEventListener("change", followDevice);
  }, []);

  // ---- What kind of account is reading this? ----
  // Held in state rather than read per-render: the deck must not flicker from
  // passport to business on every navigation. It starts at the default and
  // corrects itself once, which means a business briefly sees passport keys on
  // a cold load — acceptable, because the ROUTE GUARD is server-side and the
  // keys are only the invitation. A 503 (the store is unreadable) deliberately
  // leaves the last known kind in place instead of downgrading to passport.
  const [accountKind, setAccountKind] = useState(DEFAULT_KIND);
  useEffect(() => {
    let cancelled = false;
    async function readKind() {
      try {
        // A parked choice from the confirm-by-email path: the account did not
        // exist when it was made. Redeem it now that this device is signed in,
        // then clear it — otherwise someone who chose BUSINESS and confirmed
        // by email lands in a passport with no idea why.
        const uid = getUid();
        if (uid && uid.startsWith("sb-")) {
          let parked = null;
          try { parked = window.localStorage.getItem("asilum-pending-kind"); } catch {}
          if (parked) {
            try {
              const recorded = await authorizedFetch("/api/account/kind", {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ kind: parked, user: uid }),
              });
              // Clear only on a definite answer. A 409 means the account has
              // already chosen, which is also settled. A network failure keeps
              // the parked choice for the next load rather than losing it.
              if (recorded.ok || recorded.status === 409) {
                window.localStorage.removeItem("asilum-pending-kind");
              }
            } catch { /* keep it parked */ }
          }
        }
        const response = await authorizedFetch("/api/account/kind?user=" + encodeURIComponent(uid || ""), { cache: "no-store" });
        if (!response.ok) return; // includes 503 — hold what we have
        const data = await response.json();
        if (!cancelled && data?.kind) setAccountKind(data.kind);
      } catch { /* offline: hold what we have */ }
    }
    readKind();
    // Signing in changes which account is reading, and therefore the deck. The
    // first version asked once on mount, so a business that signed in kept the
    // passport keys until a hard reload.
    const again = () => { readKind(); };
    window.addEventListener("asilum:account-kind", again);
    window.addEventListener("asilum:identity", again);
    return () => {
      cancelled = true;
      window.removeEventListener("asilum:account-kind", again);
      window.removeEventListener("asilum:identity", again);
    };
  }, []);

  // ---- Server-issued device identity + Supabase magic-link auth. ----
  async function ensureDeviceIdentity() {
    const response = await fetch("/api/auth", { cache: "no-store" });
    if (!response.ok) throw new Error("device identity unavailable");
    const data = await response.json();
    if (!data || !/^u-[0-9a-f-]{36}$/.test(data.uid || "")) {
      throw new Error("invalid device identity");
    }
    return data.uid;
  }

  useEffect(() => {
    let active = true;
    let sub = null;
    const deviceIdentity = ensureDeviceIdentity().catch(() => null);
    deviceIdentityRef.current = deviceIdentity;
    const activateDevice = () => deviceIdentity.then((uid) => {
      if (active && uid) setUid(uid);
    });
    getSupabase().then((sb) => {
      if (!active) return;
      if (!sb) { activateDevice(); return; }
      const r = sb.auth.onAuthStateChange((event, session) => {
        if (event === "INITIAL_SESSION") {
          if (session) onSignedIn(session);
          else activateDevice();
        }
        if (event === "SIGNED_IN" && session) onSignedIn(session);
        if (event === "SIGNED_OUT") {
          pendingAdoptionRef.current = null;
          clearFitProfile();
          // WHAT WAS WRONG (Aug 7, Round A): this said "device taste remains".
          // It does not. Adoption MOVES taste — it deletes the device's profile
          // row, reassigns its boards, interactions, follows and wardrobe to the
          // account, and leaves the device identity at {} / [] / []. Measured
          // directly against the db layer. Signing out then resumes that same,
          // now-empty device id, so the old notice told the user their taste was
          // still here while the feed they got back was a cold start.
          //
          // The move itself is correct — copying instead would double-count the
          // same taste in aggregates and leave account-derived taste sitting on
          // a possibly shared device. So the message changes, not the behaviour.
          //
          // (Aug 8) The wording now lives in ONE place. app/profile/page.js has
          // its own SIGN OUT handler that publishes the same notice, and it
          // still carried the old false string — this fix landed in shell.js
          // only and never grepped for a second emitter. Both fire, so they
          // raced. Import the constant; do not retype it.
          setAuthNotice(SIGN_OUT_NOTICE);
          activateDevice();
        }
      });
      sub = r && r.data ? r.data.subscription : null;
    });
    return () => {
      active = false;
      pendingAdoptionRef.current = null;
      if (sub) sub.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adoption uses the HttpOnly device cookie as source proof. Keep subsequent
  // activity on the device identity until the one-time copy succeeds, so a
  // transient database failure cannot strand taste or corrections.
  async function onSignedIn(session) {
    const user = session.user;
    const account = "sb-" + user.id;
    const currentIdentity = getUid();
    if (currentIdentity === account) return;
    if (pendingAdoptionRef.current?.account === account) {
      return pendingAdoptionRef.current.promise;
    }
    if (currentIdentity?.startsWith("sb-")) clearFitProfile();

    const pending = { account, promise: null };
    pendingAdoptionRef.current = pending;
    pending.promise = (async () => {
      let adopted = false;
      try {
        const device = await (deviceIdentityRef.current || ensureDeviceIdentity());
        if (!device) throw new Error("device identity unavailable");
        const response = await fetch("/api/auth", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + session.access_token,
          },
          body: JSON.stringify({ user: account }),
        });
        if (!response.ok) throw new Error("identity adoption failed");
        const adoption = await response.json();
        if (adoption.correctionProfileUpdated === false) {
          setAuthNotice("signed in — corrections moved; stylist profile refresh is pending");
        }
        adopted = true;
      } catch {
        if (pendingAdoptionRef.current === pending) {
          setAuthNotice("signed in, but this device's taste could not be adopted");
        }
      }
      // BEING SIGNED IN IS NOT CONTINGENT ON YOUR TASTE MOVING.
      //
      // `setUid(account)` used to sit behind `adopted`, so any failure of the
      // adoption POST left localStorage holding the old `u-` device id while
      // the Supabase session was perfectly valid. The reader was signed in and
      // the app did not know it.
      //
      // The visible cost was the mail desk. MailDesk gates on
      // `getUid().startsWith("sb-")` — correctly, since DMs are impossible for
      // a device identity under ADR-002 — so a failed adoption removed
      // MESSAGING ENTIRELY on that device, permanently, with nothing on screen
      // connecting the two. It presented as "DMs work on my phone but not my
      // laptop", because adoption is heavier on the device with more history
      // to move and fails there first.
      //
      // Two unrelated things were coupled: whether your taste TRANSFERRED
      // decided whether you could see your MESSAGES. Identity is who you are;
      // adoption is what moves with you. The first does not wait on the second.
      if (pendingAdoptionRef.current === pending) {
        setUid(account);
        // The adoption failure already has its own notice, set in the catch
        // above; only overwrite it when there is nothing to warn about.
        if (adopted) setAuthNotice(`signed in as ${user.email || user.id}`);
      }
    })();
    try { await pending.promise; } finally {
      if (pendingAdoptionRef.current === pending) pendingAdoptionRef.current = null;
    }
  }

  function setAuthNotice(message) {
    try {
      window.localStorage.setItem("asilum-auth-notice", message);
      window.dispatchEvent(new CustomEvent("asilum:auth-notice", { detail: message }));
    } catch {}
  }

  return (
    <div className="shell">
      {/* Keyboard/screen-reader users jump past the fixtures.
          Visually hidden until focused — no visual-identity change. */}
      <a className="skiplink" href="#main">skip to content</a>

      {/* THE FIXTURES (blueprint): the Info Dock top left, the Passport
          Button top right, the Central Control Deck at the thumb. The one
          sheet (Likes, Bag, Notices, Search, Messages, Post, an overview)
          rises over the root from SheetHost. */}
      <InfoDock />
      <MusicHost />
      <PassportButton kind={accountKind} pathname={pathname} />
      <ControlCenter kind={accountKind} pathname={pathname} />
      <SheetHost />

      <AccountSignup />
      <SavePrompt />
      <DesignConsole />

      <main id="main" className="main">{children}</main>

      <ConsentMoment />
    </div>
  );
}

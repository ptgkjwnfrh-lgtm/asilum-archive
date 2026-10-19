"use client";

// app/components/AccountSignup.jsx — the account hold (mounted in the shell).
// Real Supabase accounts only (email + password, or a magic link for
// returning readers). No account state is faked: when Supabase keys are
// absent the popup never renders, and every outcome message reports what
// actually happened. Creating or entering an account triggers the shell's
// existing adoption flow (/api/auth POST), which moves the ENTIRE device
// Passport — taste profile, moodboards, wardrobe, follows, measurements,
// corrections, tickets, posts — into the account in one transaction.
// This component never touches Passport data itself.
//
// Two ways in: it auto-shows ONCE per device on the home screen (only after
// the first-visit sheet has been dismissed — "asilum:onboarded" — so the two
// never stack), and the shell's SIGN IN button opens it on demand from any
// page via the "asilum:signup-open" event.

import { ETHNICITY_OPTIONS, ETHNICITY_WHY } from "../../lib/identity/commerce.js";
import { useEffect, useRef, useState } from "react";
import { useOverlayDismiss } from "./dismiss.js";
import { UNDER_AGE_MESSAGE, checkAge } from "../../lib/age.js";
import { authConfigured, getSupabase } from "../../lib/supabase.js";

const SEEN_KEY = "asilum-signup-seen";
// Read by the shell after adoption — see parkKind().
export const PENDING_KIND_KEY = "asilum-pending-kind";

const PASSPORT_MANIFEST = [
  "taste profile — everything the brain has learned here",
  "moodboards + saved pieces",
  "wardrobe + measurements",
  "follows, corrections, purchase tickets",
  "one free native Storefront draft when you are ready to sell",
];

// What each kind actually gets. Written as the difference, not as a pitch:
// someone choosing here is choosing Passport surfaces or the business
// analytics/watchtower. Native Storefront no longer forces that trade.
const BUSINESS_MANIFEST = [
  "one free native Storefront profile, also available to Passport accounts",
  "analytics — reach, clicks, follows, foot traffic, earnings",
  "the watch tower — what this catalog's readers already wear",
  "direct messages, always open (readers can close theirs; you cannot)",
];

const KINDS = [
  { id: "passport", icon: "✚", name: "PASSPORT", what: "you are here to look" },
  { id: "business", icon: "▤", name: "BUSINESS", what: "you operate a brand" },
];

function markSeen() {
  try { window.localStorage.setItem(SEEN_KEY, "1"); } catch {}
}

export default function AccountSignup() {
  const [open, setOpen] = useState(false);
  const dismissOverlay = useOverlayDismiss(dismiss, open); // AT ghost-click guarded
  const [mode, setMode] = useState("create"); // create | signin
  const [kind, setKind] = useState("passport"); // passport | business
  const [birthDate, setBirthDate] = useState(""); // "YYYY-MM-DD", creation only
  // slice 10b (A6 (7), 14.11): the home town for the Passport's anchors; an optional, consented ethnicity
  const [hometown, setHometown] = useState("");
  const [ethnicity, setEthnicity] = useState("");
  const [ethnicityConsent, setEthnicityConsent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(""); // "" | "created" | "confirm" | "signedin"
  const signedInRef = useRef(false);

  useEffect(() => {
    if (!authConfigured()) return;
    let active = true;
    let subscription = null;
    // V.2 (owner brief, 17 Sep): no account gate before the first reward.
    // The sheet no longer opens itself on the home screen; it opens on the
    // shell's SIGN IN word, the account circle, or the first-save moment
    // (SavePrompt.jsx). The listener stays so nothing else changes.
    const maybeAutoShow = () => {
      if (!active || signedInRef.current) return;
      try { window.localStorage.setItem(SEEN_KEY, "1"); } catch {}
    };
    // The shell's SIGN IN button (any page) — always honored while signed out.
    const onOpenRequest = (event) => {
      if (!active || signedInRef.current) return;
      setMode(event?.detail?.mode === "create" ? "create" : "signin");
      setNote("");
      setDone("");
      setOpen(true);
    };
    window.addEventListener("asilum:signup-open", onOpenRequest);
    window.addEventListener("asilum:onboarded", maybeAutoShow);
    getSupabase().then((sb) => {
      if (!active || !sb) return;
      subscription = sb.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        if (session) signedInRef.current = true;
        if (event === "INITIAL_SESSION" && !session) maybeAutoShow();
        if (event === "SIGNED_OUT") signedInRef.current = false;
      })?.data?.subscription || null;
    });
    return () => {
      active = false;
      window.removeEventListener("asilum:signup-open", onOpenRequest);
      window.removeEventListener("asilum:onboarded", maybeAutoShow);
      subscription?.unsubscribe();
    };
  }, []);

  function dismiss() {
    markSeen();
    setOpen(false);
  }

  function validate(needsPassword) {
    const address = email.trim();
    if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setNote("enter a real email address first");
      return null;
    }
    if (needsPassword && password.length < 8) {
      setNote("password needs at least 8 characters");
      return null;
    }
    // OWNER DECISION #2 (13+). Checked BEFORE the account is created, so an
    // under-age person never has one to delete — refusing afterwards would
    // mean creating the account first and then holding a known minor's record
    // while we take it away again.
    if (needsPassword) {
      const verdict = checkAge(birthDate);
      if (!verdict.ok) {
        setNote(verdict.reason === "under" ? UNDER_AGE_MESSAGE : "enter your date of birth");
        return null;
      }
    }
    return address;
  }

  /**
   * Record the chosen kind against the ACCOUNT — never the device.
   *
   * The first version of this sent getUid(), which at this moment is still the
   * device id `u-<uuid>`: adoption to `sb-<uuid>` happens afterwards, in the
   * shell's auth listener. The kind was written under one id and read back
   * under another, so a business read as a passport and the storefront never
   * appeared. `accountUuid` comes straight off the Supabase response, so there
   * is no race to lose.
   *
   * Deliberately swallows its own failure — the account exists either way, and
   * an unrecorded kind is a passport, which is the safe direction.
   */
  /** Records the birth date against the account. Same account-id rule as the
   *  kind: never the device id. The client already refused an under-age date,
   *  and the server re-checks — a client-side gate is a curtain. */
  // THROUGH authorizedFetch, AND THE CATCH IS NOT A SHRUG.
  //
  // This posted with a bare `fetch`, so it never carried the bearer token that
  // proves the sb- identity it was claiming, so the route answered 401 every
  // time — and the catch below swallowed it. The age assertion behind OWNER
  // DECISION #2 was never recorded for anybody, and nothing said so.
  async function recordAge(accountUuid) {
    if (!accountUuid || !birthDate) return;
    try {
      await authorizedFetch("/api/account/age", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ birthDate, user: "sb-" + accountUuid }),
      });
    } catch { /* the gate already refused under-age; this is the record */ }
  }

  /** The home town and the ethnicity ride to the account's identity row (v68) AFTER the account exists; a refusal is the record's, not the account's. */
  async function recordIdentity(accountUuid) {
    if (!accountUuid || (!hometown.trim() && !ethnicity)) return;
    try {
      await authorizedFetch("/api/account/identity", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "sb-" + accountUuid, hometown: hometown.trim() ? { name: hometown.trim() } : null, ethnicity: ethnicity || null, ethnicityConsent }),
      });
    } catch { /* the account exists; the Passport asks again in onboarding */ }
  }

  async function recordKind(accountUuid) {
    if (kind === "passport") return; // the default; nothing to record
    if (!accountUuid) return;
    try {
      await authorizedFetch("/api/account/kind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, user: "sb-" + accountUuid }),
      });
      window.dispatchEvent(new CustomEvent("asilum:account-kind"));
    } catch { /* the account still exists; it is a passport until corrected */ }
  }

  /**
   * The confirm-by-email path has NO session yet, so there is no account to
   * record against — the account is not usable until the link is clicked.
   * Park the choice and let the shell record it on first sign-in rather than
   * dropping it: someone who picked BUSINESS and then confirmed their email
   * would otherwise land in a passport with no idea why.
   */
  function parkKind() {
    if (kind === "passport") return;
    try { window.localStorage.setItem(PENDING_KIND_KEY, kind); } catch {}
  }

  async function createAccount() {
    const address = validate(true);
    if (!address || busy) return;
    setBusy(true);
    setNote("");
    try {
      const sb = await getSupabase();
      const displayName = name.trim();
      const { data, error } = await sb.auth.signUp({
        email: address,
        password,
        options: {
          ...(displayName ? { data: { display_name: displayName } } : {}),
          emailRedirectTo: window.location.origin + "/profile",
        },
      });
      if (error) {
        setNote("could not create the account — " + error.message);
      } else if (data?.session) {
        // Signed in immediately: the shell's auth listener is already
        // adopting the device Passport into this account.
        //
        // The kind is recorded AFTER the account exists and is NOT allowed to
        // fail the signup. If this call does not land the account is a
        // passport, which is the safe direction — a business can be corrected
        // at the desk, whereas silently removing Passport surfaces in favor of
        // analytics/watchtower cannot be undone by them here.
        markSeen();
        const uuid = data.session.user?.id || data.user?.id;
        await recordAge(uuid);
        await recordKind(uuid);
        await recordIdentity(uuid);
        setDone("created");
      } else if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        // Supabase returns a stub user for an address that already holds an
        // account (anti-enumeration). Say so honestly without confirming it.
        setNote("if this email already holds an account, use SIGN IN or the magic link instead");
        setMode("signin");
      } else if (data?.user) {
        markSeen();
        parkKind();
        setDone("confirm");
      } else {
        setNote("the account service gave no answer — try again");
      }
    } catch {
      setNote("could not reach the account service — try again");
    }
    setBusy(false);
  }

  async function signIn() {
    const address = validate(true);
    if (!address || busy) return;
    setBusy(true);
    setNote("");
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithPassword({ email: address, password });
      if (error) {
        setNote("could not sign in — " + error.message);
      } else {
        markSeen();
        setDone("signedin");
      }
    } catch {
      setNote("could not reach the account service — try again");
    }
    setBusy(false);
  }

  // Forgotten password (owner directive, Aug 14 — backlog 7). The reply is
  // deliberately the SAME whether or not that address holds an account:
  // Supabase does not confirm it here, and neither do we. Anything else
  // turns this box into an account-enumeration oracle.
  async function sendReset() {
    const address = validate(false);
    if (!address || busy) return;
    setBusy(true);
    setNote("");
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.resetPasswordForEmail(address, {
        redirectTo: window.location.origin + "/profile?reset=1",
      });
      setNote(error
        ? "could not send the reset — " + error.message
        : "if that address holds an account, a reset link is on its way — open it and you can set a new password");
    } catch {
      setNote("could not reach the account service — try again");
    }
    setBusy(false);
  }

  async function sendMagicLink() {
    const address = validate(false);
    if (!address || busy) return;
    setBusy(true);
    setNote("");
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: window.location.origin + "/profile" },
      });
      setNote(error ? "could not send the link — " + error.message : "magic link sent — check your inbox");
      if (!error) markSeen();
    } catch {
      setNote("could not send the link — try again");
    }
    setBusy(false);
  }

  if (!open) return null;

  const creating = mode === "create";
  const business = kind === "business";

  return (
    <div className="overlay" onClick={dismissOverlay}>
      <div className="sheet signupsheet" onClick={(event) => event.stopPropagation()}>
        <button className="mclose" onClick={dismiss} aria-label="close sign-up">×</button>

        {done ? (
          <>
            <h2>
              {done === "confirm" ? "Check your inbox" : "Account open"}
              <span style={{ color: "var(--red)" }}>.</span>
            </h2>
            <p className="deck">
              {done === "confirm"
                ? "we sent a confirmation link. open it and your Passport boards the account on first sign-in."
                : "your Passport is boarding — everything this device taught the brain now lives on the account."}
            </p>
            <div className="signupactions">
              <a className="btn" href="/profile">GO TO PROFILE →</a>
              <button className="btn ghost" onClick={dismiss}>KEEP BROWSING</button>
            </div>
          </>
        ) : (
          <>
            <div className="psub">{creating ? "OPEN AN ACCOUNT" : "SIGN IN"}</div>
            <h2>
              {creating && business ? "Open a business ledger" : "Hold your Passport"}
              <span style={{ color: "var(--red)" }}>.</span>
            </h2>

            {creating ? (
              <div className="kindpick" role="radiogroup" aria-label="account kind">
                {KINDS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={kind === option.id}
                    className={"kindopt" + (kind === option.id ? " cur" : "")}
                    onClick={() => { setKind(option.id); setNote(""); }}
                  >
                    <span className="kindic" aria-hidden="true">{option.icon}</span>
                    <span className="kindname">{option.name}</span>
                    <span className="kindwhat">{option.what}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <p className="deck">
              {creating && business
                ? "a business account trades Passport discovery and stylist surfaces for a brand ledger: who reaches you, what they already wear, and what they buy. Native Storefront itself is free and available to either account kind."
                : "an account keeps your Passport — the map of taste this device is building — safe across devices. It can also open one free native Storefront without giving the Passport up."}
            </p>

            <ul className="signuplist">
              {(creating && business ? BUSINESS_MANIFEST : PASSPORT_MANIFEST).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {creating && business ? (
              <p className="acctline kindwarn">
                this cannot be switched later on your own — ask the desk.
              </p>
            ) : null}

            {creating ? (
              <label className="accountemail">date of birth
                <input
                  type="date"
                  value={birthDate}
                  max="9999-12-31"
                  onChange={(event) => { setBirthDate(event.target.value); setNote(""); }}
                />
                <span className="agenote">
                  you need to be 13 or older. we keep the date so the check stays
                  true as you get older — nothing else.
                </span>
              </label>
            ) : null}

            {creating ? (
              <label className="accountemail">home town — where you grew up
                <input
                  type="text"
                  value={hometown}
                  placeholder="city, country"
                  maxLength={120}
                  onChange={(event) => setHometown(event.target.value)}
                />
                <span className="agenote">
                  the Passport asks what 12-year-old you listened to on the bus; your home town and birthday pick the suggestions. never shown to anyone.
                </span>
              </label>
            ) : null}

            {creating ? (
              <label className="accountemail">ethnicity — optional
                <select value={ethnicity} onChange={(event) => { setEthnicity(event.target.value); if (!event.target.value) setEthnicityConsent(false); }} aria-label="ethnicity, optional">
                  <option value="">prefer not to say</option>
                  {ETHNICITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {ethnicity ? (
                  <span className="agenote">
                    <input type="checkbox" checked={ethnicityConsent} onChange={(event) => setEthnicityConsent(event.target.checked)} aria-label="consent to storing ethnicity" /> {ETHNICITY_WHY}
                  </span>
                ) : null}
              </label>
            ) : null}

            {creating ? (
              <label className="accountemail">name — optional
                <input
                  type="text"
                  value={name}
                  placeholder="what should ASILUM call you?"
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            ) : null}
            <label className="accountemail">email
              <input
                type="email"
                value={email}
                placeholder="you@example.com"
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="accountemail">password — 8+ characters, mixed case + number + symbol
              <input
                type="password"
                value={password}
                autoComplete={creating ? "new-password" : "current-password"}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") (creating ? createAccount : signIn)();
                }}
              />
            </label>

            <div className="signupactions">
              <button className="btn wide" disabled={busy} onClick={creating ? createAccount : signIn}>
                {busy ? "WORKING…" : creating ? "CREATE ACCOUNT" : "SIGN IN"}
              </button>
            </div>

            <div className="orline">OR</div>
            <div className="signupalts">
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => { setMode(creating ? "signin" : "create"); setNote(""); }}
              >
                {creating ? "I ALREADY HAVE AN ACCOUNT" : "OPEN A NEW ACCOUNT"}
              </button>
              <button className="btn ghost" disabled={busy} onClick={sendMagicLink}>
                EMAIL ME A MAGIC LINK
              </button>
              {/* only offered where it makes sense — there is nothing to
                  reset while opening a new account */}
              {creating ? null : (
                <button className="btn ghost" disabled={busy} onClick={sendReset}>
                  FORGOT PASSWORD
                </button>
              )}
            </div>

            {note ? <div className="acctline accountnotice signupnote">{note}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}

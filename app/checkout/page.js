"use client";

// app/checkout/page.js — THE CHECKOUT HOUSING (owner order, 20 Aug 2026).
// One clean room for the §6 two-transaction lane: the piece's picture and
// price stay on screen the whole time the buyer is on ASILUM; name, address,
// and card are typed ONCE (the vault keeps them — SETTINGS edits them);
// returning buyers pay with one press. ASILUM charges the passenger fee
// ALONE — the real purchase (the piece, shipping, tax) completes on the
// source, and the paid fee IS the purchase ticket. Card fields are Stripe's
// own iframes (Payment Element); card data never touches this codebase.

import { useEffect, useRef, useState } from "react";
import { getUid, postJSON, sendJSON, authorizedFetch, aspectFor } from "../../lib/client.js";
import { DISCLAIMER_TEXT, DISCLAIMER_CHECKBOX } from "../../lib/tickets.js";
import Notice from "../components/Notice.jsx";

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";

function money(cents, currency) {
  return `${String(currency || "usd").toUpperCase()} ${(cents / 100).toFixed(2)}`;
}

function loadStripeJs() {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && window.Stripe) return resolve(window.Stripe);
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3";
    s.onload = () => resolve(window.Stripe);
    s.onerror = () => reject(new Error("stripe.js failed to load"));
    document.head.appendChild(s);
  });
}

const EMPTY_FORM = {
  fullName: "", addressLine1: "", addressLine2: "",
  city: "", region: "", postalCode: "", country: "",
};

export default function CheckoutHousing() {
  const [quote, setQuote] = useState(null);      // { item, amount_cents, fee_cents, ... }
  const [profile, setProfile] = useState(null);  // vault public shape
  const [form, setForm] = useState(EMPTY_FORM);
  const [consent, setConsent] = useState(false);
  const [useCredit, setUseCredit] = useState(true); // 5.32: Credit pays the fee first when the passenger has any
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  // phases: loading | ready | card | paying | paid | dead
  const [phase, setPhase] = useState("loading");
  const [err, setErr] = useState("");
  const [orderId, setOrderId] = useState(null);
  const [ticket, setTicket] = useState(null);
  const stripeRef = useRef(null);
  const elementsRef = useRef(null);

  useEffect(() => {
    const itemId = new URLSearchParams(window.location.search).get("item") || "";
    if (!itemId) { setErr("no piece named — open checkout from a piece's BUY"); setPhase("dead"); return; }
    (async () => {
      const res = await authorizedFetch(
        `/api/ticket-fee?item=${encodeURIComponent(itemId)}&user=${encodeURIComponent(getUid())}`
      ).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok || !d.quote) {
        setErr((d && d.error) || "the server could not be reached — nothing was started");
        setPhase("dead");
        return;
      }
      setQuote(d.quote);
      setProfile(d.profile || null);
      if (d.profile) {
        setForm((f) => ({
          ...f,
          fullName: d.profile.full_name || "",
          addressLine1: d.profile.address_line1 || "",
          addressLine2: d.profile.address_line2 || "",
          city: d.profile.city || "",
          region: d.profile.region || "",
          postalCode: d.profile.postal_code || "",
          country: d.profile.country || "",
        }));
      }
      if (d.quote.refusal) {
        setErr(d.quote.refusal);
        setPhase("dead");
      } else {
        setPhase("ready");
      }
    })();
  }, []);

  const needsIdentity = !(profile && profile.full_name);
  const hasSavedCard = Boolean(profile && profile.has_saved_card);
  const identityComplete = !needsIdentity ||
    ["fullName", "addressLine1", "city", "postalCode", "country"]
      .every((k) => String(form[k] || "").trim());
  const readyToPay = consent && identityComplete;

  function setField(k) {
    return (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function begin() {
    setErr("");
    const res = await postJSON("/api/ticket-fee", {
      user: getUid(),
      itemId: quote.item.id,
      consent: true,
      creditCents: creditApplied,
      profile: needsIdentity ? form : undefined,
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) { setErr((d && d.error) || "the fee could not be opened"); return; }
    setOrderId(d.order);
    if (d.mode === "credit") { setTicket(d.ticket || null); setPhase("paid"); return; }
    if (d.mode === "saved") { await paySaved(d.order); return; }
    if (!PK) {
      setErr("card entry is idle on this build — the publishable key is not set; nothing was charged");
      return;
    }
    try {
      const StripeJs = await loadStripeJs();
      const stripe = StripeJs(PK);
      const css = getComputedStyle(document.documentElement);
      const elements = stripe.elements({
        clientSecret: d.clientSecret,
        appearance: {
          variables: {
            colorPrimary: css.getPropertyValue("--sig").trim(),
            colorText: css.getPropertyValue("--ink").trim(),
            colorBackground: css.getPropertyValue("--paper").trim(),
            colorDanger: css.getPropertyValue("--red").trim(),
            borderRadius: "0px",
            fontFamily: "Helvetica, Arial, sans-serif",
          },
        },
      });
      stripeRef.current = stripe;
      elementsRef.current = elements;
      setPhase("card");
      // Mount after the container renders.
      requestAnimationFrame(() => {
        const el = elements.create("payment");
        el.mount("#chk-payment-element");
      });
    } catch {
      setErr("stripe.js could not load — check the network and retry");
    }
  }

  async function payWithElement() {
    setErr("");
    setPhase("paying");
    const { error } = await stripeRef.current.confirmPayment({
      elements: elementsRef.current,
      redirect: "if_required",
    });
    if (error) { setErr(error.message || "the card was refused"); setPhase("card"); return; }
    await settlePoll(orderId);
  }

  async function paySaved(oid) {
    setErr("");
    setPhase("paying");
    const res = await sendJSON("PATCH", "/api/ticket-fee", {
      user: getUid(), orderId: oid, action: "pay-saved",
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setErr((d && d.error) || "the saved card was refused");
      setPhase("ready");
      return;
    }
    setTicket(d.ticket || null);
    setPhase("paid");
  }

  async function settlePoll(oid) {
    for (let i = 0; i < 6; i++) {
      const res = await authorizedFetch(
        `/api/ticket-fee?order=${encodeURIComponent(oid)}&user=${encodeURIComponent(getUid())}`
      ).catch(() => null);
      const d = res ? await res.json().catch(() => ({})) : {};
      if (d.order && d.order.status === "paid") {
        setTicket(d.ticket || null);
        setPhase("paid");
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setErr("payment is processing — check YOUR ORDERS in a moment; nothing charges twice");
    setPhase("ready");
  }

  const item = quote && quote.item;
  const creditBalance = quote ? Math.max(0, Number(quote.credit_cents) || 0) : 0;
  const creditApplied = quote && useCredit ? Math.min(creditBalance, quote.fee_cents) : 0;
  const dueCents = quote ? Math.max(0, quote.fee_cents - creditApplied) : 0;
  const src = quote && quote.source_name ? quote.source_name.toUpperCase() : "THE SOURCE";

  return (
    <div className="chk">
      <h3 className="statshead">CHECKOUT</h3>

      {phase === "loading" && <div className="empty">opening the housing…</div>}
      {phase === "dead" && <Notice tone="error" variant="banner">{err}</Notice>}

      {item && phase !== "loading" && phase !== "dead" && (
        <div className="chkgrid">
          {/* The piece — never leaves the screen while the buyer is here. */}
          <section className="chkpiece" aria-label="the piece">
            <div className="chkimg" style={{ aspectRatio: aspectFor(item.id) }}>
              {item.img
                ? <img src={item.img} alt={item.title} />
                : <span className="chkmono" aria-hidden="true">*</span>}
            </div>
            <div className="chkbrand">{item.brand || ""}</div>
            <div className="chkttl">{item.title}</div>
            <div className="chkline">
              <span>PIECE</span><b>{money(quote.amount_cents, quote.currency)}</b>
            </div>
            <div className="chkline">
              <span>PASSENGER FEE{quote.floored ? " (minimum)" : " ($1 + 1.5%)"}</span>
              <b>{money(quote.fee_cents, quote.currency)}</b>
            </div>
            {creditBalance > 0 ? (
              <div className="chkline">
                <span>
                  <label className="chkcredit">
                    <input type="checkbox" checked={useCredit} onChange={(e) => setUseCredit(e.target.checked)} />
                    {" "}ASILUM CREDIT · {money(creditBalance, quote.currency)} on hand
                  </label>
                </span>
                <b>{creditApplied ? "− " + money(creditApplied, quote.currency) : "—"}</b>
              </div>
            ) : null}
            <div className="chkline chktotal">
              <span>TODAY ON ASILUM</span><b>{money(dueCents, quote.currency)}</b>
            </div>
            <p className="legal">
              the fee is all ASILUM charges. the piece itself —{" "}
              {money(quote.amount_cents, quote.currency)} plus shipping and tax
              — is paid at {src} after your ticket opens. your statement will
              show two lines: ASILUM (the fee) and {src} (the piece).
            </p>
          </section>

          {/* The buyer's side: typed once, kept in the vault. */}
          <section className="chkpay" aria-label="payment">
            {phase === "paid" ? (
              <div className="chkdone">
                <div className="chkstamp">FEE PAID — TICKET OPEN ✓</div>
                <p className="legal">
                  your purchase ticket is open{ticket && ticket.id ? ` (no. ${ticket.id})` : ""}.
                  complete the purchase on the source — payment for the piece,
                  shipping, and tax all happen there, under their buyer
                  protections.
                </p>
                {ticket && ticket.source_url ? (
                  <a className="btn chkgo" href={ticket.source_url} target="_blank" rel="noopener noreferrer">
                    CONTINUE TO {src} ↗
                  </a>
                ) : (
                  <p className="pempty">the source link rides on your ticket in ORDERS &amp; TICKETS.</p>
                )}
                <p className="pempty"><a href="/orders">YOUR ORDERS &amp; TICKETS →</a></p>
              </div>
            ) : (
              <>
                {needsIdentity ? (
                  <>
                    <div className="chkhead">FIRST PURCHASE — STORED ONCE</div>
                    <p className="pempty">
                      typed once, kept in the vault, edited any time in{" "}
                      <a href="/settings">SETTINGS</a>. never asked again.
                    </p>
                    <div className="chkform">
                      <label><span>FULL NAME</span>
                        <input value={form.fullName} onChange={setField("fullName")} autoComplete="name" /></label>
                      <label><span>ADDRESS</span>
                        <input value={form.addressLine1} onChange={setField("addressLine1")} autoComplete="address-line1" /></label>
                      <label><span>ADDRESS 2 (optional)</span>
                        <input value={form.addressLine2} onChange={setField("addressLine2")} autoComplete="address-line2" /></label>
                      <label><span>CITY</span>
                        <input value={form.city} onChange={setField("city")} autoComplete="address-level2" /></label>
                      <label><span>REGION / STATE</span>
                        <input value={form.region} onChange={setField("region")} autoComplete="address-level1" /></label>
                      <label><span>POSTAL CODE</span>
                        <input value={form.postalCode} onChange={setField("postalCode")} autoComplete="postal-code" /></label>
                      <label><span>COUNTRY</span>
                        <input value={form.country} onChange={setField("country")} autoComplete="country-name" /></label>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="chkhead">ON FILE</div>
                    <div className="chkonfile">
                      <span className="cclbl">NAME</span><span className="ccval">{profile.full_name}</span>
                      <span className="cclbl">CARD</span>
                      <span className="ccval">
                        {hasSavedCard
                          ? `${(profile.card_brand || "card").toUpperCase()} ···· ${profile.card_last4 || ""}`
                          : "none saved yet — entered once below"}
                      </span>
                    </div>
                    <p className="pempty">manage in <a href="/settings">SETTINGS</a> — nothing is retyped here.</p>
                  </>
                )}

                <label className="chkconsent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>{DISCLAIMER_CHECKBOX}</span>
                </label>
                <button className="btn ghost chkfine" onClick={() => setShowDisclaimer((v) => !v)}>
                  {showDisclaimer ? "HIDE THE FULL DISCLAIMER" : "READ THE FULL DISCLAIMER"}
                </button>
                {showDisclaimer && <p className="legal">{DISCLAIMER_TEXT}</p>}

                {phase === "card" && (
                  <div className="chkcard">
                    <div className="chkhead">CARD — ENTERED ONCE, KEPT BY STRIPE</div>
                    <div id="chk-payment-element" />
                    <p className="pempty">
                      your card is kept by Stripe, our payment processor, so
                      the next fee is one press — ASILUM stores only a
                      reference and the last four digits. remove it any time
                      in <a href="/settings">SETTINGS</a>.
                    </p>
                  </div>
                )}

                {err ? <Notice tone="error" variant="banner" onDismiss={() => setErr("")}>{err}</Notice> : null}

                {phase === "ready" && (
                  <button className="btn chkpaybtn" disabled={!readyToPay} onClick={begin}>
                    {dueCents === 0
                      ? `PAY WITH CREDIT ✓`
                      : hasSavedCard
                        ? `PAY ${money(dueCents, quote.currency)} ✓`
                        : `CONTINUE TO CARD →`}
                  </button>
                )}
                {phase === "card" && (
                  <button className="btn chkpaybtn" onClick={payWithElement}>
                    PAY {money(dueCents, quote.currency)} ✓
                  </button>
                )}
                {phase === "paying" && <div className="empty">settling the fee…</div>}
                {!readyToPay && phase === "ready" && (
                  <p className="pempty">
                    {identityComplete ? "the disclaimer above is the gate — check it to continue" : "the starred details + the disclaimer open the payment"}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

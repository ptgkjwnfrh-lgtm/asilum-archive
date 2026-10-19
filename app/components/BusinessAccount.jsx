"use client";

// app/components/BusinessAccount.jsx — the passport → business panel
// (owner law, Aug 13), mounted on PROFILE → ACCOUNT. Every state shown
// is the server's truth: PASSPORT (the default every account holds),
// UNDER REVIEW (a human is looking), BUSINESS (verified), or REJECTED
// (with the reviewer's note, and the road back). Verification carries a
// domain-proof token (18 Aug): placing it on the claimed site is the
// anti-impersonation evidence a human reviewer checks — the machine
// never verifies on its own. A verified business links an inventory
// namespace and imports from its own Shopify storefront through the
// checkout honesty gate; full OAuth store control stays a later,
// partner-app step and nothing here pretends otherwise.

import { useEffect, useState } from "react";
import { getUid, authorizedFetch, postJSON } from "../../lib/client.js";
import Notice from "./Notice.jsx";
import { normalizeShopifyDomain, validBrandName, STATEMENT_MAX } from "../../lib/business.js";

const LAW = "Native Storefront does not require this upgrade. A passport " +
  "becomes a BUSINESS account only for the separate verified-brand program: " +
  "your Shopify source and website are reviewed by a human, and approved " +
  "businesses may enter the Feed's ten-booth program.";

export default function BusinessAccountPanel() {
  const [state, setState] = useState(null);   // server truth
  const [brandName, setBrandName] = useState("");
  const [shopifyDomain, setShopifyDomain] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [statement, setStatement] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    authorizedFetch("/api/business?user=" + encodeURIComponent(getUid() || ""))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setState(d || { status: "passport", account: false });
        if (d && d.brandName) {
          setBrandName(d.brandName);
          setShopifyDomain(d.shopifyDomain || "");
          setWebsiteUrl(d.websiteUrl || "");
          setStatement(d.statement || "");
        }
      })
      .catch(() => setState({ status: "passport", account: false, unreachable: true }));
  }

  useEffect(() => {
    load();
    window.addEventListener("asilum:identity", load);
    return () => window.removeEventListener("asilum:identity", load);
  }, []);

  function submit() {
    setNote("");
    if (!validBrandName(brandName)) { setNote("brand name must be 2–80 characters"); return; }
    if (!normalizeShopifyDomain(shopifyDomain)) { setNote("shopify domain must look like your-shop.myshopify.com"); return; }
    if (!/^https:\/\//i.test(websiteUrl.trim())) { setNote("website must be a public https url"); return; }
    setBusy(true);
    postJSON("/api/business", {
      user: getUid(), brandName: brandName.trim(),
      shopifyDomain: shopifyDomain.trim(), websiteUrl: websiteUrl.trim(),
      statement: statement.trim() || undefined,
    })
      .then(async (res) => {
        const d = await res.json().catch(() => null);
        if (!res.ok) { setNote((d && (d.error || d.note)) || "the application could not be saved"); return; }
        setNote(d.note || "submitted for review");
        setState(d);
      })
      .catch(() => setNote("the server could not be reached — nothing was submitted"))
      .finally(() => setBusy(false));
  }

  if (state === null) return <div className="empty">reading your account…</div>;

  const badge =
    state.status === "business" ? "BUSINESS ACCOUNT" :
    state.status === "under_review" ? "PASSPORT — APPLICATION UNDER REVIEW" :
    state.status === "rejected" ? "PASSPORT — APPLICATION REJECTED" :
    "PASSPORT ACCOUNT";

  return (
    <section className="bizpanel" aria-label="account type">
      <h3 className="statshead">ACCOUNT TYPE</h3>
      <div className={"biztype" + (state.status === "business" ? " bizverified" : "")}>{badge}</div>
      <p className="bizlaw">{LAW}</p>

      {state.unreachable && (
        <p className="pempty">the server could not be reached — your true account state is unknown right now.</p>
      )}

      {!state.account && !state.unreachable && (
        <p className="pempty">
          the upgrade rides on a signed-in account — sign in above, then
          apply here.
        </p>
      )}

      {state.account && state.status === "business" && (
        <div className="bizfields">
          <span className="cclbl">BRAND</span>
          <span className="ccval">{state.brandName}</span>
          <span className="cclbl">SHOPIFY STOREFRONT</span>
          <span className="ccval">{state.shopifyDomain}</span>
          <span className="cclbl">WEBSITE</span>
          <span className="ccval">{state.websiteUrl}</span>
          {state.sourceName ? (
            <>
              <span className="cclbl">INVENTORY</span>
              <span className="ccval">LINKED — {state.sourceName}</span>
              <p className="pempty">
                verified {state.decidedAt ? new Date(state.decidedAt).toLocaleDateString() : ""} —
                your booth chance is live in the Feed, and your pieces enter
                the catalog under your own name. imports from your Shopify
                storefront pass the same honesty gate as everything else.
              </p>
            </>
          ) : (
            <p className="pempty">
              verified {state.decidedAt ? new Date(state.decidedAt).toLocaleDateString() : ""} —
              your booth chance is live in the Feed. the desk links your
              inventory next: your pieces import from your Shopify
              storefront and sell under your own name.
            </p>
          )}
          <Notice tone="error" variant="banner">
            HOTLIST FEE INTEGRITY — suspicious behaviour relating to the
            hotlist fee (attribution tampering, fee circumvention,
            manufactured traffic) results in account suspension and a
            PERMANENT ban from the hotlist program. a named human reviews
            every case; the ledger is the evidence.
          </Notice>
        </div>
      )}

      {state.account && state.status === "under_review" && (
        <div className="bizfields">
          <span className="cclbl">BRAND</span>
          <span className="ccval">{state.brandName}</span>
          <span className="cclbl">SHOPIFY STOREFRONT</span>
          <span className="ccval">{state.shopifyDomain}</span>
          <span className="cclbl">WEBSITE</span>
          <span className="ccval">{state.websiteUrl}</span>
          <p className="pempty">
            a human reviews every application — your account stays a
            passport until the review lands. you can update the fields
            below and resubmit while you wait.
          </p>
          {state.verifyToken && (
            <>
              <span className="cclbl">PROVE YOUR DOMAIN</span>
              <span className="ccval">{state.verifyToken}</span>
              <p className="pempty">
                speeds the review: put this token on the site you claimed —
                either a meta tag named asilum-verify in your page head, or
                served plain at /.well-known/asilum-verify.txt. the reviewer
                checks for it; control of the domain is what separates a
                brand from an impersonator.
              </p>
            </>
          )}
        </div>
      )}

      {state.account && state.status === "rejected" && (
        <p className="bizreject">
          the review said no{state.reviewNote ? ": “" + state.reviewNote + "”" : ""} —
          fix what it names and apply again below.
        </p>
      )}

      {state.account && state.status !== "business" && (
        <div className="bizform">
          <input aria-label="brand name"
            type="text" maxLength={80} placeholder="brand name"
            value={brandName} onChange={(e) => setBrandName(e.target.value)}
          />
          <input aria-label="shopify domain"
            type="text" maxLength={120} placeholder="your-shop.myshopify.com"
            value={shopifyDomain} onChange={(e) => setShopifyDomain(e.target.value)}
          />
          <input aria-label="your website"
            type="url" maxLength={300} placeholder="https://your-own-site.com"
            value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)}
          />
          <textarea aria-label="who you are — read by the reviewer"
            rows={3} maxLength={STATEMENT_MAX}
            placeholder="who you are — the human reviewing this reads it"
            value={statement} onChange={(e) => setStatement(e.target.value)}
          />
          <div className="bizrow">
            <button className="btn" onClick={submit} disabled={busy}>
              {busy ? "SUBMITTING…" : state.status === "rejected" ? "APPLY AGAIN" : state.status === "under_review" ? "UPDATE APPLICATION" : "SUBMIT FOR REVIEW"}
            </button>
          </div>
        </div>
      )}

      {note && <p className="pempty">{note}</p>}
    </section>
  );
}

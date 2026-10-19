"use client";

// app/components/BagSheet.jsx — THE BAG, as a sheet (V.2 Blueprint, owner,
// 17 Oct 2026: the bag opens from the Info Dock, not from a header panel).
// The content is the shell's former bag panel, moved whole: what is in the
// bag, where each piece comes from, the honest line about checkout. Bag is
// intent only until native commerce lands (blueprint chapter 7): adding to
// the Bag reserves nothing, and checkout for sourced pieces belongs to the
// source sites.
//
// NATIVE COMMERCE (slice 6, over the native-storefront branch): a native
// Storefront line carries units and its own CHECK OUT THIS SELLER control,
// which opens Stripe's hosted checkout through lib/storefront/client.js —
// the server re-resolves price, stock and policy; the subtotal here is a
// display snapshot, never payment authority. External lines keep their
// source sites. Adding to the Bag still reserves nothing (7.6).

import { useEffect, useState } from "react";
import { bagList, bagRemove, bagSetQuantity, getUid, thumbFor } from "../../lib/client.js";
import { sourceFor } from "../../lib/social.js";
import { isNativeItem, startNativeCheckout } from "../../lib/storefront/client.js";
import { openSheet } from "../../lib/dockstate.js";
import Notice from "./Notice.jsx";
import { ColorEvidenceLine, OriginLine, ProductFitLine, useFitBrain } from "./ProductSignals.jsx";

export default function BagSheet() {
  const fit = useFitBrain();
  const [bag, setBag] = useState([]);
  const [how, setHow] = useState(false);
  const [checkout, setCheckout] = useState({});
  useEffect(() => {
    const sync = () => setBag(bagList());
    sync();
    window.addEventListener("asilum:bag", sync);
    return () => window.removeEventListener("asilum:bag", sync);
  }, []);
  const subtotalCents = bag.reduce((s, x) => s + (Number.isSafeInteger(x.price_cents) ? x.price_cents : Math.round((x.price || 0) * 100)) * (x.quantity || 1), 0);
  const nSources = new Set(bag.map((x) => sourceFor(x))).size;
  const nativeLines = bag.filter(isNativeItem);
  const keyOf = (x) => x.bag_key || x.id;

  async function checkOut(line) {
    const key = keyOf(line);
    setCheckout((c) => ({ ...c, [key]: { status: "pending", error: "" } }));
    const r = await startNativeCheckout(line, { user: getUid(), variantId: line.default_variant_id || null, quantity: line.quantity || 1 });
    if (r.ok) setCheckout((c) => ({ ...c, [key]: { status: "redirecting", error: "" } }));
    else {
      setCheckout((c) => ({ ...c, [key]: { status: "error", error: r.error } }));
      if (r.status === 401) openSheet("account", { title: "ACCOUNT" });
    }
  }

  return (
    <div className="bagsheet">
      {bag.length === 0 ? (
        <div className="pempty">
          Bag empty<br />
          <span style={{ fontSize: 12 }}>The brain notices what you carry.</span>
        </div>
      ) : (
        <>
          {bag.map((x) => (
            <div className="bagrow" key={keyOf(x)}>
              <img src={x.img || thumbFor(x)} alt="" />
              <div className="baginfo">
                <div className="bagttl">{x.title}</div>
                <div className="bagprice">{sourceFor(x)} · {x.currency || "USD"} {x.price}</div>
                {isNativeItem(x) ? <div className="bagrail">NATIVE STOREFRONT · {x.storefront_name || x.storefront_slug || "SELLER"}</div> : null}
                <div className="bagqty" role="group" aria-label={"units of " + (x.title || "this piece")}>
                  <button type="button" aria-label="one fewer" disabled={(x.quantity || 1) <= 1} onClick={() => bagSetQuantity(keyOf(x), (x.quantity || 1) - 1)}>−</button>
                  <span>{x.quantity || 1}</span>
                  <button type="button" aria-label="one more" disabled={isNativeItem(x) && (x.quantity || 1) >= 25} onClick={() => bagSetQuantity(keyOf(x), (x.quantity || 1) + 1)}>+</button>
                </div>
                {isNativeItem(x) ? (
                  <div className="bagcheckout">
                    <button type="button" className="btn wide" disabled={x.native_checkout_ready !== true || checkout[keyOf(x)]?.status === "pending" || checkout[keyOf(x)]?.status === "redirecting"} onClick={() => checkOut(x)}>
                      {x.native_checkout_ready !== true ? "CHECKOUT NOT ENABLED"
                        : checkout[keyOf(x)]?.status === "pending" ? "OPENING SECURE CHECKOUT…"
                        : checkout[keyOf(x)]?.status === "redirecting" ? "REDIRECTING…"
                        : "CHECK OUT THIS SELLER →"}
                    </button>
                    <small>{x.native_checkout_ready === true ? "Stripe shows the server-calculated ASILUM passenger fee before payment. Adding to the Bag reserves nothing; checkout does." : "This seller's verified test payment path is not enabled yet."}</small>
                    {checkout[keyOf(x)]?.error ? <span role="alert">{checkout[keyOf(x)].error}</span> : null}
                  </div>
                ) : null}
                <ColorEvidenceLine item={x} />
                <OriginLine item={x} />
                <ProductFitLine item={x} fit={fit} />
              </div>
              <button className="bagx" onClick={() => bagRemove(keyOf(x))} aria-label={"remove " + (x.title || "piece")}>×</button>
            </div>
          ))}
          <div className="bagfees">
            <div><span>DISPLAY SUBTOTAL</span><b>USD {(subtotalCents / 100).toFixed(2)}</b></div>
            <div><span>SOURCES</span><b>{nSources}</b></div>
            {nativeLines.length ? <div><span>NATIVE UNITS</span><b>{nativeLines.reduce((n, x) => n + (x.quantity || 1), 0)}</b></div> : null}
            <div className="bagfinal"><span>CHECKOUT</span><b>{nativeLines.length ? "PER SELLER · STRIPE" : "ON SOURCE SITES"}</b></div>
          </div>
          <button className="btn ghost wide" onClick={() => setHow((v) => !v)}>
            HOW PURCHASES WORK
          </button>
          {how && (
            <Notice onDismiss={() => setHow(false)}>
              External pieces stay on their named source: open a piece to view
              it or create a purchase request. Native Storefront pieces check
              out here, one seller at a time: the server rechecks price and
              stock, then Stripe shows the ASILUM passenger fee before payment.
              Nothing is reserved until checkout opens.
            </Notice>
          )}
        </>
      )}
      <a className="btn ghost wide" href="/orders" style={{ display: "block", textAlign: "center" }}>
        VIEW ORDERS & TICKETS →
      </a>
    </div>
  );
}

"use client";

// app/components/Studio.jsx — STUDIO, inside the Passport (V.2).
// One account; the business tools appear here, contextually, without a
// second identity. Four instruments:
//   1. CONNECT SHOPIFY STORE — the real path today is the booth application
//      (POST /api/business, a human decides) plus the public products.json
//      import behind THE DESK. Full OAuth needs a partner app the register
//      lists as BLOCKED, so the connection walkthrough is a labelled MODEL
//      and never a fake success.
//   2. ADD AN EVENT / A SHOP — a submission with every provenance field the
//      map demands, saved as a DRAFT on this device (no directory table
//      exists yet). Submission is open to anyone; it is not verification.
//   3. YOUR BRDCSTS (V.2 chapter 5; slice 8) — the campaigns this account
//      created from the composer: unpaid ones wait here in Drafts (5.22);
//      pay with Credit in the exact amount chosen, banked bonus days or
//      miles, the remainder by card; cancel for the unused days' refund,
//      Credit first with the bonus; mute the failed-payment reminders. A
//      BRDCST is labelled wherever it appears and buys reach only — never
//      verification, ranking truth, notifications or a partnership label.
//   4. THE VERIFICATION DESK — /api/verification: source claims beside a
//      LOCAL-RULES reading; a human sees material conflicts only; human
//      labour TBD.

import { useEffect, useState } from "react";
import ModelTag from "./ModelTag.jsx";
import { PLACE_KINDS, CITIES } from "../../lib/places/registry.js";

import { readDrafts, writeDrafts } from "../../lib/studio/drafts.js";
import { getUid, authorizedFetch, postJSON } from "../../lib/client.js";
import { money } from "./BrdcstOptions.jsx";
const STATE_WORD = { draft: "DRAFT · UNPAID", scheduled: "SCHEDULED", active: "LIVE", ended: "ENDED", cancelled: "CANCELLED", under_review: "UNDER REVIEW" };

/** Panel 3: the account's BRDCST campaigns, every value the server's. */
function Brdcsts({ onNote }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [pay, setPay] = useState({}); // campaignId -> { creditCents, bonusAs, useBonusDays, useBonusMiles }
  const [cancel, setCancel] = useState({}); // campaignId -> { reason, refundTo, bonusAs }
  const user = getUid() || "";
  const load = () => authorizedFetch("/api/brdcst?user=" + encodeURIComponent(user)).then((r) => (r.ok ? r.json() : null)).then((d) => setData(d || false)).catch(() => setData(false));
  useEffect(() => { if (user) load(); else setData(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(body, label, after) {
    setBusy(label);
    try {
      const res = await postJSON("/api/brdcst", { user, ...body });
      const d = await res.json().catch(() => null);
      if (!res.ok) onNote((d && d.error) || "that did not go through");
      else if (after) after(d);
      await load();
    } catch { onNote("the Studio could not reach the server"); } finally { setBusy(""); }
  }
  if (data === null) return <p className="stp faint">reading your campaigns…</p>;
  if (data === false) return <p className="stp faint">sign in to see your BRDCSTs.</p>;
  const list = data.campaigns || [];
  return (
    <>
      <p className="stp">bonus bank: <b>{data.bonus.days} day{data.bonus.days === 1 ? "" : "s"}</b> · <b>{data.bonus.miles} mi</b> — earned by refunds taken as Credit and by the Credit share of a payment; redeemed on a campaign whenever you choose. payment: {data.payment}.</p>
      {list.length === 0 && <p className="stp faint">no campaigns yet. attach an event to a STILL, MOTION or BRDCST in the composer and the campaign appears here as a draft until it is paid.</p>}
      <ul className="stcamps">
        {list.map((c) => {
          const p = pay[c.id] || { creditCents: "", bonusAs: "days", useBonusDays: "", useBonusMiles: "" };
          const x = cancel[c.id] || { reason: "voluntary", refundTo: "credit", bonusAs: "days" };
          return (
            <li key={c.id} className={"stcamp " + c.state}>
              <div className="stcamphead">
                <b>{c.eventName || "event"}</b>
                <span className="rkmono">{STATE_WORD[c.state] || c.state} · {c.radiusMi} MI · {c.durationDays} DAY{c.durationDays === 1 ? "" : "S"} · {money(c.totalCents)}{c.creditCents ? ` (${money(c.creditCents)} credit)` : ""}</span>
              </div>
              <div className="fine">
                {c.state === "active" || c.state === "ended" ? `${c.usage.usedDays} day${c.usage.usedDays === 1 ? "" : "s"} used · ${c.usage.unusedDays} unused` : null}
                {c.state === "scheduled" ? `starts ${String(c.startsAt).slice(0, 10)}` : null}
                {c.state === "draft" && c.scheduledStart ? `scheduled for ${String(c.scheduledStart).slice(0, 10)} — paid after that day, only the remaining days are billed` : null}
                {c.state === "draft" && !c.scheduledStart ? "launches the moment it is paid" : null}
                {c.paymentFailedAt ? ` · the payment did not go through and the broadcast failed to send — pay by another method to keep the launch date${c.remindersMuted ? " (reminders muted)" : " (a reminder every three hours)"}` : null}
                {c.refund ? ` · refund: ${c.refund.pending ? "under review" : c.refund.decided ? c.refund.decided : c.refund.amountCents > 0 ? money(c.refund.amountCents) + " to " + c.refund.to : (c.refund.note || "nothing to refund")}${c.refund.bonus ? ` + ${c.refund.bonus.amount} ${c.refund.bonus.kind}` : ""}` : null}
                {c.postId ? <> · <a href={"/?post=" + encodeURIComponent(c.postId)}>THE POST →</a></> : " · no post named yet"}
              </div>
              {c.can.pay && (
                <div className="stcampacts stform">
                  <label>credit (USD)<input type="number" min="0" step="0.01" placeholder="0.00" value={p.creditCents} onChange={(e) => setPay({ ...pay, [c.id]: { ...p, creditCents: e.target.value } })} /></label>
                  <label>bonus days<input type="number" min="0" max={data.bonus.days} step="1" placeholder="0" value={p.useBonusDays} onChange={(e) => setPay({ ...pay, [c.id]: { ...p, useBonusDays: e.target.value } })} /></label>
                  <label>bonus miles<input type="number" min="0" max={data.bonus.miles} step="1" placeholder="0" value={p.useBonusMiles} onChange={(e) => setPay({ ...pay, [c.id]: { ...p, useBonusMiles: e.target.value } })} /></label>
                  <label>credit share earns
                    <select value={p.bonusAs} onChange={(e) => setPay({ ...pay, [c.id]: { ...p, bonusAs: e.target.value } })}><option value="days">days</option><option value="miles">miles</option></select>
                  </label>
                  <div className="stacts">
                    <button className="btn" disabled={!!busy} onClick={() => act({ action: "pay", id: c.id, creditCents: Math.round((Number(p.creditCents) || 0) * 100), bonusAs: p.bonusAs, useBonusDays: Number(p.useBonusDays) || 0, useBonusMiles: Number(p.useBonusMiles) || 0 }, c.id, (d) => { if (d.checkoutUrl) window.location.assign(d.checkoutUrl); else onNote(d.paid ? "paid with Credit — " + (d.campaign.state === "scheduled" ? "scheduled" : "live") : "payment did not start"); })}>
                      {busy === c.id ? "…" : "PAY →"}
                    </button>
                    {c.orderId ? <button className="txtbtn" disabled={!!busy} onClick={() => act({ action: "settle", id: c.id }, "s" + c.id)}>CHECK THE CARD PAYMENT</button> : null}
                    {c.can.mute ? <button className="txtbtn" disabled={!!busy} onClick={() => act({ action: "mute", id: c.id, muted: !c.remindersMuted }, "m" + c.id)}>{c.remindersMuted ? "UNMUTE REMINDERS" : "MUTE REMINDERS"}</button> : null}
                  </div>
                </div>
              )}
              {c.can.cancel && (
                <div className="stcampacts stform">
                  <label>reason
                    <select value={x.reason} onChange={(e) => setCancel({ ...cancel, [c.id]: { ...x, reason: e.target.value } })}><option value="voluntary">I am stopping it</option><option value="event_cancelled">the event is cancelled</option></select>
                  </label>
                  <label>refund to
                    <select value={x.refundTo} onChange={(e) => setCancel({ ...cancel, [c.id]: { ...x, refundTo: e.target.value } })}><option value="credit">ASILUM Credit + bonus</option><option value="original">the original method (no bonus)</option></select>
                  </label>
                  {x.refundTo === "credit" && (
                    <label>bonus as
                      <select value={x.bonusAs} onChange={(e) => setCancel({ ...cancel, [c.id]: { ...x, bonusAs: e.target.value } })}><option value="days">two extra days</option><option value="miles">45 miles of reach</option></select>
                    </label>
                  )}
                  <div className="stacts">
                    <button className="txtbtn" disabled={!!busy} onClick={() => act({ action: "cancel", id: c.id, ...x }, "c" + c.id, (d) => onNote(d.refund ? `cancelled — ${money(d.refund.amountCents)} refunded to ${d.refund.to}${d.refund.bonus ? " with " + d.refund.bonus.amount + " bonus " + d.refund.bonus.kind : ""}` : "cancelled — no completely unused day to refund"))}>
                      CANCEL · {c.paidAt ? `${c.usage.unusedDays} unused day${c.usage.unusedDays === 1 ? "" : "s"} · ${money(c.usage.refundCents)} back` : "nothing was paid"}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
const KIND_LABEL = { runway: "RUNWAY", "pop-up": "POP-UP", consignment: "CONSIGNMENT", thrift: "THRIFT", shop: "SHOP", exhibition: "EXHIBITION", creator: "CREATOR" };
const DATED_KINDS = new Set(["runway", "pop-up"]);


const EMPTY_EVENT = { kind: "pop-up", name: "", organizer: "", address: "", city: "Bowie, Maryland", startsAt: "", endsAt: "", admission: "", price: "", sourceUrl: "", imageRights: false };

export default function Studio({ uid }) {
  const [drafts, setDrafts] = useState([]);
  const [ev, setEv] = useState(EMPTY_EVENT);
  const [shopStep, setShopStep] = useState(0);
  const [desk, setDesk] = useState(null);
  const [deskOpen, setDeskOpen] = useState(null);
  const [note, setNote] = useState("");
  useEffect(() => { setDrafts(readDrafts()); }, []);
  useEffect(() => {
    fetch("/api/verification?limit=80").then((r) => (r.ok ? r.json() : null)).then(setDesk).catch(() => setDesk({ error: true }));
  }, []);

  function addDraft(kind, payload) {
    const d = { id: "draft-" + Date.now().toString(36), kind, at: new Date().toISOString(), status: "draft — not published", ...payload };
    const next = [d, ...readDrafts()];
    writeDrafts(next); setDrafts(next);
    return d;
  }
  function removeDraft(id) { const next = readDrafts().filter((d) => d.id !== id); writeDrafts(next); setDrafts(next); }
  function submitEvent(e) {
    e.preventDefault();
    if (!ev.name.trim() || !ev.address.trim()) { setNote("a name and a public address are the minimum"); return; }
    const city = CITIES[ev.city];
    addDraft("place", { ...ev, dated: DATED_KINDS.has(ev.kind), tz: city ? city.tz : null, country: city ? city.country : "", lastChecked: null, imageStatus: ev.imageRights ? "author asserts rights — unverified" : "none" });
    setEv(EMPTY_EVENT); setNote("saved as a draft on this device — publication needs a directory and a review desk, neither exists yet");
  }
  // An event/shop draft's `kind` is its VENUE kind — addDraft("place", {...ev})
  // spreads the form over the record, so "place" never survives. Older
  // device drafts of kind "promotion" (the pre-slice-8 request) still list.
  const eventDrafts = drafts.filter((d) => d.kind !== "promotion");

  return (
    <div className="studio">
      <p className="deck">one account. the same Passport, with tools for what you are building. nothing here creates a second identity, and disconnecting a store never touches your saves.</p>
      {note && <p className="pempty">{note}</p>}

      <div className="stgrid">
        {/* 1 — SHOPIFY */}
        <section className="stcard" aria-label="connect a store">
          <div className="cclbl">01 · BRING YOUR SHOP IN</div>
          <h3 className="sthead">Connect Shopify store <ModelTag kind="connection" /></h3>
          <p className="stp">Real OAuth needs a Shopify partner app ASILUM does not have yet (the rights register marks it blocked). The real path today: a verified booth application, decided by a person, then a catalog import of only the fields ASILUM needs — product and variant identity, price, availability, authorized media. Checkout, payment, inventory truth, shipping and returns stay with the merchant.</p>
          <ol className="stwalk">
            {["store domain — yours, never your password", "scopes: read products and collections only", "choose the collections to show", "catalog fields imported; checkout stays on your store"].map((s, i) => (
              <li key={s} className={i < shopStep ? "done" : i === shopStep ? "cur" : ""}>{s}</li>
            ))}
          </ol>
          <div className="stacts">
            <button className="txtbtn" onClick={() => setShopStep((s) => (s + 1) % 5)}>{shopStep === 4 ? "RESET THE WALKTHROUGH" : "PREVIEW THE CONNECTION →"} <ModelTag>MODEL</ModelTag></button>
            <a className="txtbtn" href="/profile#access">APPLY FOR A VERIFIED BOOTH →</a>
          </div>
          <p className="stfine">staff use their own accounts and receive scoped permissions; disconnecting removes the imported catalog and nothing else.</p>
        </section>

        {/* 2 — EVENT / SHOP */}
        <section className="stcard" aria-label="add an event or a shop">
          <div className="cclbl">02 · GIVE YOUR SCENE A PLACE</div>
          <h3 className="sthead">Add an event or a shop <ModelTag kind="device" /></h3>
          <form className="stform" onSubmit={submitEvent}>
            <label>kind
              <select value={ev.kind} onChange={(e) => setEv({ ...ev, kind: e.target.value })}>
                {PLACE_KINDS.filter((k) => k !== "creator").map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <label>name<input type="text" maxLength={120} value={ev.name} onChange={(e) => setEv({ ...ev, name: e.target.value })} required /></label>
            <label>organizer<input type="text" maxLength={120} value={ev.organizer} onChange={(e) => setEv({ ...ev, organizer: e.target.value })} /></label>
            <label>public address<input type="text" maxLength={200} value={ev.address} onChange={(e) => setEv({ ...ev, address: e.target.value })} required /></label>
            <label>city
              <select value={ev.city} onChange={(e) => setEv({ ...ev, city: e.target.value })}>
                {Object.keys(CITIES).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {DATED_KINDS.has(ev.kind) && (
              <>
                <label>starts<input type="date" value={ev.startsAt} onChange={(e) => setEv({ ...ev, startsAt: e.target.value })} /></label>
                <label>ends<input type="date" value={ev.endsAt} onChange={(e) => setEv({ ...ev, endsAt: e.target.value })} /></label>
              </>
            )}
            <label>admission<input type="text" maxLength={60} placeholder="free · rsvp · ticket" value={ev.admission} onChange={(e) => setEv({ ...ev, admission: e.target.value })} /></label>
            <label>price<input type="text" maxLength={30} value={ev.price} onChange={(e) => setEv({ ...ev, price: e.target.value })} /></label>
            <label>official link<input type="url" maxLength={300} placeholder="https://" value={ev.sourceUrl} onChange={(e) => setEv({ ...ev, sourceUrl: e.target.value })} /></label>
            <label className="stcheck"><input type="checkbox" checked={ev.imageRights} onChange={(e) => setEv({ ...ev, imageRights: e.target.checked })} /> I hold the rights to any image I would add</label>
            <div className="stacts"><button className="btn" type="submit">SAVE AS DRAFT</button></div>
          </form>
          <p className="stfine">anyone may submit without a store. submission is not verification; a person checks the source before a row is published.</p>
        </section>

        {/* 3 — BRDCST (slice 8) */}
        <section className="stcard stbrdcst" aria-label="your BRDCSTs">
          <div className="cclbl">03 · REACH THE RIGHT NEIGHBOURHOOD · BRDCST</div>
          <h3 className="sthead">Your BRDCSTs</h3>
          <Brdcsts onNote={setNote} />
          <p className="stfine">a BRDCST is labelled wherever it appears and buys reach only — taste first, distance second, from a 50-mile base. never verification, ranking truth, push access or a partnership label. billed per day; completely unused days refund, Credit first with a bonus of two days or 45 miles.</p>
        </section>

        {/* drafts */}
        <section className="stcard" aria-label="your drafts">
          <div className="cclbl">YOUR DRAFTS · {drafts.length} ON THIS DEVICE</div>
          {drafts.length === 0 && <p className="stp faint">saved requests appear here. this build never submits an advertisement, publishes a location or charges you.</p>}
          <ul className="stdrafts">
            {drafts.map((d) => (
              <li key={d.id}>
                <b>{d.kind === "promotion" ? "SPONSORED REQUEST" : (KIND_LABEL[d.kind] || d.kind)}</b>
                <span>{d.name || (eventDrafts.find((e) => e.id === d.draftId) || {}).name || "—"} · {d.status}</span>
                <button className="txtbtn" onClick={() => removeDraft(d.id)}>DISCARD</button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* 4 — THE DESK */}
      <section className="stdesk" aria-label="the verification desk">
        <div className="cclbl">04 · THE VERIFICATION DESK · HUMAN LABOUR: TBD</div>
        <p className="stp">every piece: the source's tags beside an independent reading. only a <b>material disagreement</b> — brand, category, material — reaches an archivalist. missing evidence stays pending; agreement means consistency, never authenticity.</p>
        {desk && !desk.error && (
          <>
            <div className="stdeskmode">{desk.mode.label} <ModelTag>the research column reads the listing text; cited research arrives with a keyed model</ModelTag></div>
            <div className="stcounts">
              {[["archivalist", "ARCHIVALIST QUEUE"], ["flagged", "FLAGGED"], ["pending", "PENDING"], ["agreed", "AGREED"]].map(([k, l]) => (
                <span key={k} className={"stcount " + k}><b>{String(desk.counts[k] || 0).padStart(2, "0")}</b>{l}</span>
              ))}
            </div>
            <ul className="stcases">
              {desk.cases.filter((c) => c.status !== "agreed").slice(0, 12).map((c) => (
                <li key={c.itemId} className={"stcase " + c.status}>
                  <button className="stcasehead" onClick={() => setDeskOpen(deskOpen === c.itemId ? null : c.itemId)} aria-expanded={deskOpen === c.itemId}>
                    <span className="stcasestatus">{c.status.toUpperCase()}</span>
                    <span className="stcasettl">{c.brand ? c.brand + " — " : ""}{c.title}</span>
                    <span className="stcasesrc">{c.source}</span>
                  </button>
                  {deskOpen === c.itemId && (
                    <table className="stfields">
                      <thead><tr><th>FIELD</th><th>SOURCE CLAIMS</th><th>READING</th><th>STATUS</th></tr></thead>
                      <tbody>
                        {c.fields.map((f) => (
                          <tr key={f.field} className={f.status}>
                            <td>{f.field.toUpperCase()}{f.material ? " *" : ""}</td>
                            <td>{f.source || "—"}</td>
                            <td>{f.research || "—"}<em>{f.evidence}</em></td>
                            <td>{f.status.toUpperCase()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </li>
              ))}
            </ul>
            <p className="stfine">* a material field. resolution is reversible and recorded with a named reviewer when the desk is staffed (lib/asterisk/facts.js ladder).</p>
          </>
        )}
        {desk && desk.error && <p className="pempty">the desk could not be read.</p>}
      </section>
    </div>
  );
}

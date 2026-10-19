"use client";

// app/components/TwoFactor.jsx — IDENTITY FOR COMMERCE in Settings (V.2
// Terms 2.2, 6.34, 10.4, 14.11; A6 (7); slice 10b).
//
//   IdentityRow  the home town and the optional, consented, erasable
//                ethnicity the account gave at creation (editable here), and
//                the standing this identity has for commerce: age, the
//                verification checks for SELL and DROP, two-factor, device.
//   TwoFactor    a second factor through the platform's own MFA (an
//                authenticator app, TOTP): enroll shows the secret and the QR,
//                a six-digit code verifies it, a verified factor raises the
//                session to aal2 — the proof a Credit gift needs. Unenroll
//                removes it. Nothing here is simulated: with no auth
//                configured the row says so and offers nothing.

import { useEffect, useState } from "react";
import { getUid, authorizedFetch } from "../../lib/client.js";
import { authConfigured, getSupabase } from "../../lib/supabase.js";
import { haptic } from "../../lib/haptics.js";

export function IdentityRow() {
  const [data, setData] = useState(null);
  const [town, setTown] = useState("");
  const [eth, setEth] = useState("");
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState("");
  const uid = getUid() || "";
  const load = () => authorizedFetch("/api/account/identity?user=" + encodeURIComponent(uid)).then((r) => (r.ok ? r.json() : null)).then((d) => { setData(d || false); if (d && d.identity) { setTown(d.identity.hometown ? d.identity.hometown.name : ""); setEth(d.identity.ethnicity || ""); } }).catch(() => setData(false));
  useEffect(() => { if (uid) load(); else setData(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    const res = await authorizedFetch("/api/account/identity", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: uid, hometown: town.trim() ? { name: town.trim() } : null, ethnicity: eth || null, ethnicityConsent: consent }) });
    const d = await res.json().catch(() => null);
    setNote(res.ok ? "saved — never shown to anyone" : (d && d.error) || "that did not save");
    if (res.ok) load();
  }
  async function erase(field) {
    const res = await authorizedFetch("/api/account/identity?user=" + encodeURIComponent(uid) + "&field=" + field, { method: "DELETE" });
    setNote(res.ok ? (field === "ethnicity" ? "ethnicity erased" : "erased") : "could not erase");
    if (res.ok) load();
  }
  if (data === null) return <div className="rkrow"><div className="rkname">Home town &amp; background</div><div className="rkctl rkmono">…</div></div>;
  if (data === false || !data.account) return (
    <div className="rkrow">
      <div className="rkname">Home town &amp; background</div>
      <div className="rkctl rkmono">SIGN IN</div>
      <div className="rkdesc">the Passport's identity anchors — what 12-year-old you listened to on the bus — are suggested from your birthday, your home town and, if you choose to say, your background. an account carries them; a device does not.</div>
    </div>
  );
  const s = data.standing || {};
  return (
    <>
      <div className="rkrow">
        <div className="rkname">Home town &amp; background</div>
        <div className="rkctl stform">
          <label>home town<input type="text" maxLength={120} value={town} placeholder="city, country" onChange={(e) => setTown(e.target.value)} /></label>
          <label>ethnicity — optional
            <select value={eth} onChange={(e) => { setEth(e.target.value); if (!e.target.value) setConsent(false); }}>
              <option value="">prefer not to say</option>
              {(data.options.ethnicity || []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          {eth && eth !== (data.identity && data.identity.ethnicity) ? <label className="stcheck"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> {data.options.ethnicityWhy}</label> : null}
          <div className="stacts">
            <button className="fitbtn" onClick={() => { haptic("press"); save(); }}>SAVE</button>
            {data.identity && data.identity.ethnicity ? <button className="txtbtn" onClick={() => erase("ethnicity")}>ERASE ETHNICITY</button> : null}
          </div>
        </div>
        <div className="rkdesc">{data.options.ethnicityWhy}{data.identity && data.identity.ethnicityConsentedAt ? ` consented ${String(data.identity.ethnicityConsentedAt).slice(0, 10)}.` : ""} {note}</div>
      </div>
      <div className="rkrow">
        <div className="rkname">Standing for commerce</div>
        <div className="rkctl rkmono">{s.canTransact ? `${s.age} · CAN TRANSACT` : (s.birthDateOnRecord ? `UNDER ${data.options.commerceAge}` : "NO BIRTH DATE")}</div>
        <div className="rkdesc">
          buying, selling, running a BRDCST and ASILUM Credit are for passengers of {data.options.commerceAge} and over (Terms 2.2).{s.reason ? ` ${s.reason}.` : ""}
          {s.verification ? <> to SELL: {s.verification.sell.ok ? "verified" : s.verification.sell.reason}. to DROP: {s.verification.drop.ok ? "verified" : s.verification.drop.reason}.</> : null}
          {s.verification && s.verification.sell.checks.find((c) => c.id === "phone" && c.note) ? ` ${s.verification.sell.checks.find((c) => c.id === "phone").note}.` : ""}
          {" "}gift proofs: two-factor {s.twoFactor ? "presented" : "not presented"} · device {s.deviceVerified ? "adopted" : "not adopted"} ({s.devices} adopted device{s.devices === 1 ? "" : "s"}).
        </div>
      </div>
    </>
  );
}

export default function TwoFactor() {
  const [factors, setFactors] = useState(null); // null loading · false no auth · []
  const [enroll, setEnroll] = useState(null);   // { id, secret, qr }
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const sb = await getSupabase();
    if (!sb) { setFactors(false); return; }
    const { data: session } = await sb.auth.getSession();
    if (!session?.session) { setFactors(false); return; }
    const { data, error } = await sb.auth.mfa.listFactors();
    setFactors(error ? false : (data?.totp || []).filter((f) => f.status === "verified"));
  }
  useEffect(() => { if (authConfigured()) load(); else setFactors(false); }, []);
  async function start() {
    setBusy(true); setNote("");
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "ASILUM authenticator" });
      if (error) throw error;
      setEnroll({ id: data.id, secret: data.totp?.secret || "", qr: data.totp?.qr_code || "" });
    } catch (e) { setNote(e.message || "could not start enrollment"); } finally { setBusy(false); }
  }
  async function verify() {
    if (!enroll || !/^\d{6}$/.test(code)) { setNote("enter the six digits from your authenticator"); return; }
    setBusy(true); setNote("");
    try {
      const sb = await getSupabase();
      const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId: enroll.id });
      if (e1) throw e1;
      const { error: e2 } = await sb.auth.mfa.verify({ factorId: enroll.id, challengeId: ch.id, code });
      if (e2) throw e2;
      haptic("confirm"); setEnroll(null); setCode(""); setNote("two-factor is on — this session now carries it (aal2)");
      await load();
    } catch (e) { haptic("error"); setNote(e.message || "the code was not accepted"); } finally { setBusy(false); }
  }
  async function remove(id) {
    setBusy(true); setNote("");
    try { const sb = await getSupabase(); const { error } = await sb.auth.mfa.unenroll({ factorId: id }); if (error) throw error; setNote("two-factor removed"); await load(); }
    catch (e) { setNote(e.message || "could not remove"); } finally { setBusy(false); }
  }
  if (factors === null) return <div className="rkrow"><div className="rkname">Two-factor</div><div className="rkctl rkmono">…</div></div>;
  return (
    <div className="rkrow">
      <div className="rkname">Two-factor</div>
      <div className="rkctl">
        {factors === false ? <span className="rkmono">SIGN IN</span> : factors.length ? (
          <>
            <span className="rkmono">ON · {factors.length} AUTHENTICATOR{factors.length === 1 ? "" : "S"}</span>
            {factors.map((f) => <button key={f.id} className="txtbtn" disabled={busy} onClick={() => remove(f.id)}>REMOVE {f.friendly_name || "AUTHENTICATOR"}</button>)}
          </>
        ) : enroll ? (
          <div className="stform">
            {enroll.qr ? <img className="mfaqr" src={enroll.qr} alt="scan this QR code with your authenticator app" /> : null}
            <label>or enter the secret<input type="text" readOnly value={enroll.secret} onFocus={(e) => e.target.select()} /></label>
            <label>six-digit code<input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></label>
            <div className="stacts"><button className="fitbtn" disabled={busy} onClick={verify}>VERIFY ✓</button><button className="txtbtn" disabled={busy} onClick={() => setEnroll(null)}>CANCEL</button></div>
          </div>
        ) : <button className="fitbtn" disabled={busy} onClick={start}>ADD AN AUTHENTICATOR →</button>}
      </div>
      <div className="rkdesc">an authenticator app on your phone. a Credit gift is sent only from a session that presented it, on a device this account signed in on (Terms 10.4). {note}</div>
    </div>
  );
}

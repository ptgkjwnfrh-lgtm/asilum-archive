// lib/records/client.js — the client half of user_records (v53).
//
// Best-effort mirrors of the device stores to /api/records. The device copy
// stays the fast path the screens read; the server copy is what makes the
// record real across devices and across sign-in (adoption). Every call is
// fire-and-forget by design: a failed sync never blocks the screen, and the
// caller may report it (the surface owns that copy). Uses authorizedFetch so an
// account bearer or the signed device cookie rides along (trap 173).

import { authorizedFetch, getUid } from "../client.js";

async function send(method, body) {
  try {
    const res = await authorizedFetch("/api/records", {
      method, headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: getUid(), ...body }),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null, error: String(error?.message || error) };
  }
}

export function putRecord(kind, recordId, payload) {
  return send("PUT", { kind, recordId, payload });
}
export function deleteRecord(kind, recordId) {
  return send("DELETE", { kind, recordId });
}
export async function listRecords(kind) {
  try {
    const url = kind ? `/api/records?kind=${encodeURIComponent(kind)}` : "/api/records";
    const res = await authorizedFetch(url);
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, records: data?.records || [], outcome: data?.outcome || null };
  } catch (error) {
    return { ok: false, status: 0, records: [], outcome: null, error: String(error?.message || error) };
  }
}

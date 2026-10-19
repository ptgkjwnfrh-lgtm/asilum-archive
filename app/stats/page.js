"use client";

// app/stats/page.js
// Brain health dashboard: the ASTERISK hologram entity at reading size,
// interaction volume by action, graph/board/user counts, and the
// most-engaged pieces. Rides under PASSPORT.

import { useEffect, useState } from "react";
import AsteriskDock from "../components/AsteriskDock.jsx";
import { vizState } from "../../lib/brain/memory.js";
import { getUid, authorizedFetch } from "../../lib/client.js";
import PageMast from "../components/PageMast.jsx";

export default function StatsPage() {
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [viz, setViz] = useState(null);
  const [mix, setMix] = useState(null); // (r16) bridge mix, plain words
  // The house's operating dashboards (owner directive, Aug 14). null =
  // still reading; available:false = the database is required and this
  // deploy has none, which the page says rather than drawing zeros.
  const [ops, setOps] = useState(null);
  // Whether this tab holds the staff token. false = the house numbers are not
  // read at all, rather than requested and refused.
  const [staffed, setStaffed] = useState(false);

  useEffect(() => {
    // The house's own numbers are STAFF-ONLY as of the Aug-16 audit: a signed
    // device cookie is proof of a browser, not of staff, so /api/stats now
    // wants ADMIN_TOKEN. The token is read from the same sessionStorage slot
    // THE DESK uses — unlock the desk once and this page reads too. It is
    // never stored on the device and never put in the URL.
    let token = "";
    try { token = window.sessionStorage.getItem("asilum-admin-token") || ""; } catch {}
    setStaffed(!!token);

    // The visitor's OWN brain state is not staff data and stays open — it is
    // read from /api/profile, which binds to their identity.
    authorizedFetch("/api/profile?user=" + encodeURIComponent(getUid() || "guest"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!d) return; setViz(vizState(d.profile)); setMix(d.bridgeMix || null); })
      .catch(() => {});

    if (!token) {
      setStatsError(null);
      setOps(null);
      return;
    }
    const auth = { headers: { Authorization: "Bearer " + token } };

    // WHAT WAS WRONG (Aug 8, codebase audit). This never checked r.ok, so an
    // ERROR BODY was stored as `stats`. The render below treats any truthy
    // `stats` as the dashboard and reaches `Object.entries(stats.actions)` —
    // undefined on an error body — which THROWS and takes the whole page down.
    fetch("/api/stats", auth)
      .then(async (r) => {
        if (!r.ok) {
          setStatsError(r.status === 401
            ? "that token is not the one the server holds"
            : r.status === 503
              ? "ADMIN_TOKEN is unset on this deploy — the dashboard stays dark, honestly"
              : `stats unavailable (${r.status})`);
          return null;
        }
        return r.json();
      })
      .then((d) => { if (d) setStats(d); })
      .catch(() => setStatsError("stats unavailable — the request did not complete"));
    // Same r.ok discipline as the read above — an error body stored as
    // data is what took this page down once.
    fetch("/api/stats?analytics=1", auth)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOps(d || { available: false }))
      .catch(() => setOps({ available: false }));
  }, []);

  return (
    <div className="wrap">
      <div className="locline"><a href="/board">← PASSPORT</a><span>/ BRAIN DASHBOARD</span></div>
      <PageMast word="STATS" sub="FULL READ" />
      <p className="deck">what the brain has learned so far.</p>
      {mix ? <p className="areadnote"><b className="red">*</b> {mix.line}</p> : null}
      <hr className="rule" />

      {viz && (
        <>
          <h3 className="statshead">your brain — drag to rotate</h3>
          <div style={{ marginBottom: 10 }}>
            <AsteriskDock size={220} className="os-dock statsdock" />
          </div>
        </>
      )}

      {!staffed ? (
        <div className="empty">
          the house numbers are staff-only. unlock <a href="/admin">THE DESK</a> in
          this tab and reload — your own taste state above needs no token.
        </div>
      ) : statsError ? (
        <div className="empty">{statsError}</div>
      ) : !stats ? (
        <div className="empty">loading…</div>
      ) : (
        <>
          <div className="splitbar">
            <span className="chip">users <b>{stats.users}</b></span>
            <span className="chip">interactions <b>{stats.interactions}</b></span>
            <span className="chip">boards <b>{stats.boards}</b></span>
            <span className="chip">graph edges <b>{stats.edges}</b></span>
            {/* An edge count is not a working graph. The Aug-15 audit found
                every live edge at contributors = 0, so gamma answered every
                anchor with nothing while this bar said "2632" and read as
                health. Report what the ACTIVE rule can actually use. */}
            {stats.gamma && (
              <span className="chip">
                gamma usable{" "}
                <b>{stats.gamma.usable} / {stats.gamma.total}</b>
                {" · "}{stats.gamma.rule}
              </span>
            )}
            <span className="chip">
              storage <b>{stats.persistent ? "postgres" : "memory (resets on restart)"}</b>
            </span>
          </div>

          <h3 className="statshead">interactions by action</h3>
          <table className="stats">
            <tbody>
              {Object.entries(stats.actions).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <tr key={k}><td>{k}</td><td>{v}</td></tr>
              ))}
              {Object.keys(stats.actions).length === 0 && (
                <tr><td colSpan={2}>none yet</td></tr>
              )}
            </tbody>
          </table>

          <h3 className="statshead">most engaged pieces</h3>
          <table className="stats">
            <thead>
              <tr><th>piece</th><th>brand</th><th>engagements</th><th>impressions</th><th>rate</th></tr>
            </thead>
            <tbody>
              {stats.topItems.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}</td><td>{t.brand}</td>
                  <td>{Math.round(t.eng * 10) / 10}</td><td>{Math.round(t.imp)}</td>
                  <td>{t.rate != null ? t.rate : "—"}</td>
                </tr>
              ))}
              {stats.topItems.length === 0 && <tr><td colSpan={5}>none yet</td></tr>}
            </tbody>
          </table>
        </>
      )}

      {/* ---- THE HOUSE'S OWN NUMBERS (owner directive, Aug 14) ----
          Read-only, real counters. Every figure names the window it was
          measured over, and anything not measurable prints "—" rather
          than a zero that would read as a fact. ---- */}
      <hr className="rule" />
      <h3 className="statshead">the house — operating numbers</h3>
      {!staffed && <div className="empty">operating dashboards are staff-only.</div>}
      {staffed && ops === null && <div className="empty">reading the ledgers…</div>}
      {ops && !ops.available && (
        <div className="empty">
          these dashboards read the database directly. this deploy is running
          on memory, so there is nothing honest to count yet.
        </div>
      )}
      {ops && ops.available && (
        <>
          <h4 className="opshead">RETURNING IDENTITIES · by week</h4>
          <p className="opsnote">
            an identity active in a week who was also active the week before.
            identities, not people — one person can hold a device identity and
            an account, and this counts both.
          </p>
          <table className="stats">
            <thead><tr><th>week</th><th>active</th><th>returning</th><th>rate</th></tr></thead>
            <tbody>
              {(ops.retention || []).map((w) => (
                <tr key={w.weeksAgo}>
                  <td>{w.weeksAgo === 0 ? "this week" : w.weeksAgo + " weeks ago"}</td>
                  <td>{w.active}</td>
                  <td>{w.returning == null ? "—" : w.returning}</td>
                  <td>
                    {w.returning == null || w.active === 0
                      ? "—"
                      : Math.round((w.returning / w.active) * 100) + "%"}
                  </td>
                </tr>
              ))}
              {(ops.retention || []).length === 0 && <tr><td colSpan={4}>no activity recorded yet</td></tr>}
            </tbody>
          </table>

          <h4 className="opshead">THE FEED · POSTS · last {ops.wire?.days ?? 14} days</h4>
          <div className="splitbar">
            <span className="chip">visible transmissions <b>{ops.wire?.visible ?? "—"}</b></span>
            <span className="chip">posters this week <b>{ops.wire?.postersThisWeek ?? "—"}</b></span>
            <span className="chip">held for review <b>{ops.wire?.held ?? "—"}</b></span>
            <span className="chip">retired by authors <b>{ops.wire?.retired ?? "—"}</b></span>
          </div>
          <table className="stats">
            <thead><tr><th>day</th><th>transmissions</th></tr></thead>
            <tbody>
              {(ops.wire?.daily || []).map((d) => (
                <tr key={d.daysAgo}>
                  <td>{d.daysAgo === 0 ? "today" : d.daysAgo === 1 ? "yesterday" : d.daysAgo + " days ago"}</td>
                  <td>{d.posts}</td>
                </tr>
              ))}
              {(ops.wire?.daily || []).length === 0 && <tr><td colSpan={2}>the Feed has been quiet</td></tr>}
            </tbody>
          </table>

          <h4 className="opshead">SEARCH HEALTH · last {ops.search?.days ?? 7} days</h4>
          <p className="opsnote">
            the zero-result rate is the one number that says whether the
            catalog answers what people actually ask for.
          </p>
          <div className="splitbar">
            <span className="chip">searches <b>{ops.search?.searches ?? "—"}</b></span>
            <span className="chip">searchers <b>{ops.search?.searchers ?? "—"}</b></span>
            <span className="chip">
              found nothing{" "}
              <b>{ops.search?.emptyRate == null ? "—" : Math.round(ops.search.emptyRate * 100) + "%"}</b>
            </span>
          </div>
          {(ops.search?.topMisses || []).length > 0 && (
            <table className="stats">
              <thead><tr><th>asked for, found nothing</th><th>times</th></tr></thead>
              <tbody>
                {ops.search.topMisses.map((m) => (
                  <tr key={m.query}><td>{m.query}</td><td>{m.count}</td></tr>
                ))}
              </tbody>
            </table>
          )}

          <h4 className="opshead">BOOTH FUNNEL</h4>
          <div className="splitbar">
            <span className="chip">under review <b>{ops.booths?.underReview ?? "—"}</b></span>
            <span className="chip">verified <b>{ops.booths?.verified ?? "—"}</b></span>
            <span className="chip">rejected <b>{ops.booths?.rejected ?? "—"}</b></span>
            <span className="chip">booths open <b>{ops.booths?.boothsOpen ?? "—"}</b> / 10</span>
          </div>
        </>
      )}
    </div>
  );
}

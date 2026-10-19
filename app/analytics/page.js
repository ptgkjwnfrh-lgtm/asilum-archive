// app/analytics/page.js — the business ledger. Replaces PASSPORT for a
// business account (lib/nav.js).
//
// The numbers are NOT here yet: reach, clicks, follows, foot traffic and
// earnings each come from a different store, and inventing any of them would
// be the exact fake the constitution forbids. What ships here is the honest
// shape — the surface exists, is reachable only by a business, and says which
// of its panels are still dark.

import KindGate from "../components/KindGate.jsx";

export const metadata = { title: "ANALYTICS" }; // the layout appends " · *ASILUM"

const PANELS = [
  { name: "REACH", what: "impressions of your pieces, by surface" },
  { name: "CLICKS", what: "opens, and what was open when they left" },
  { name: "FOLLOWS", what: "who started following, and from where" },
  { name: "FOOT TRAFFIC", what: "booth visits through the Feed" },
  { name: "EARNINGS", what: "tickets, fees, rent — against the ledger" },
  { name: "WHO", what: "the taste of the people who reach you, in cohorts" },
];

export default function AnalyticsPage() {
  return (
    <KindGate capability="analytics">
      <main className="wrap">
        <div className="psub">THE LEDGER</div>
        <h1>*ANALYTICS</h1>
        <p className="deck">
          what happened at your storefront. every number here is measured, and
          a panel with nothing behind it yet says so rather than showing a zero
          it did not earn.
        </p>
        <div className="ledgergrid">
          {PANELS.map((panel) => (
            <section className="ledgercell" key={panel.name}>
              <h2>{panel.name}</h2>
              <p>{panel.what}</p>
              <span className="soon">NOT WIRED YET</span>
            </section>
          ))}
        </div>
        <p className="acctline">
          cohort floor: the WHO panel will never name a reader. it reports
          groups, and only groups large enough to stay anonymous — the consent
          moment promised that and this page keeps it.
        </p>
      </main>
    </KindGate>
  );
}

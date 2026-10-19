"use client";

// app/components/PassportButton.jsx — THE PASSPORT BUTTON (V.2 Blueprint,
// owner, 17 Oct 2026, Foundations "Screen map"; the globe at the top right
// of Figure 19). It opens the Passport: STAMPS, the map, the taste record.
// In this slice it is a link to the Passport's route; slice 2 makes the
// Passport a popup in the session hub and this button its opener.
//
// A business has no passport (lib/accounts.js), so it has no globe: the
// destination comes from lib/nav.js fixtureFor, which answers null for a
// kind the route guard would turn away.

import { useRef } from "react";
import Icon from "./Icons.jsx";
import { useLiquidGlass } from "./LiquidGlass.jsx";
import { fixtureFor } from "../../lib/nav.js";

export default function PassportButton({ kind, pathname }) {
  const p = fixtureFor(kind, "passport");
  // the OG liquid glass (slice 14); the hook runs before the business's early return
  const glassRef = useRef(null);
  const glass = useLiquidGlass(glassRef, { id: "lg-passportbtn", strength: 1.1, prism: 1, active: !!p });
  if (!p) return null;
  const cur = p.match(pathname || "/");
  return (
    <a
      ref={glassRef}
      className={"passportbtn fixture lgrx" + (cur ? " cur" : "")}
      href={p.href}
      aria-label="passport"
      aria-current={cur ? "page" : undefined}
      title={p.label}
    >
      {glass}
      <Icon name="globe" size={22} />
      <span className="idlabel">{p.label}</span>
    </a>
  );
}

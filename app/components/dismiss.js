"use client";

// app/components/dismiss.js — ONE dismissal contract for transient surfaces
// (synergy phase 1). Every overlay/sheet/modal closes on Escape; panels that
// float without an overlay (bag, Asterisk drawer) also close on a click
// outside — excluding their own toggle button, so the toggle still toggles.

import { useEffect, useRef } from "react";

// Overlay click-away, hardened for assistive tech (found by ear, 20 Aug,
// during the claim-12 VoiceOver pass): AT activation can fire a DUPLICATED
// click at the trigger's screen position, and once the overlay is up that
// ghost click lands on it — instantly dismissing what just opened. Two
// guards: the click must land on the overlay ITSELF (not a child, so inner
// surfaces no longer need their own stopPropagation to survive), and not
// within the overlay's first 400ms of life. `active` is the overlay's open
// condition — the birth clock resets each time it opens.
export function useOverlayDismiss(onClose, active = true) {
  const bornRef = useRef(0);
  useEffect(() => {
    if (active) bornRef.current = Date.now();
  }, [active]);
  return (event) => {
    if (event.target !== event.currentTarget) return;
    if (Date.now() - bornRef.current < 400) return;
    onClose();
  };
}

/**
 * Close on Escape. THE BASELINE FOR EVERY TRANSIENT SURFACE — a modal, sheet
 * or drawer that cannot be dismissed from the keyboard is an accessibility
 * failure, not a styling choice.
 *
 * `active` is the surface's open condition; the listener is removed when it is
 * false, so a closed surface cannot swallow Escape from the one above it.
 */
export function useEscape(onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}

// A dialog that declares `aria-modal="true"` is telling assistive technology
// that everything behind it is inert. That has to be MADE true — the attribute
// does not do it. Without a trap, a keyboard user who opens the item detail
// keeps focus on the trigger BEHIND the layer, tabs into the page behind it,
// and can operate a catalog they cannot see.
//
// So: move focus in on open, cycle Tab inside, and put focus back where it came
// from on close. Escape still closes (useEscape) — this does not add a trap a
// user cannot leave, which would be WCAG 2.1.2.
const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])",
  "select:not([disabled])", "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Keep Tab inside a surface while it is open, and RETURN FOCUS to whatever
 * opened it on close.
 *
 * The return is the half that gets forgotten: without it a keyboard or screen
 * reader user is dropped at the top of the document every time they dismiss
 * something, losing their place entirely. Focus is only restored if the origin
 * element is still connected.
 */
export function useFocusTrap(surfaceRef, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const surface = surfaceRef.current;
    if (!surface) return undefined;

    // Where focus came from, so it can be given back. Restoring focus is the
    // half people forget: without it, closing a dialog drops the user at the
    // top of the document and they lose their place entirely.
    const origin = document.activeElement;
    const inside = () =>
      [...surface.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);

    (inside()[0] || surface).focus();

    const onKey = (event) => {
      if (event.key !== "Tab") return;
      const items = inside();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (!surface.contains(document.activeElement)) {
        // another modal dialog stacked above this one (the photograph that
        // floats, the ticket flow — rendered on <body>, outside this surface)
        // keeps focus: its own trap owns Tab while it is up
        const above = document.activeElement && document.activeElement.closest && document.activeElement.closest('[aria-modal="true"]');
        if (above && above !== surface) return;
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture phase: the surface's own handlers must not swallow Tab first.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (origin && origin.isConnected && typeof origin.focus === "function") origin.focus();
    };
  }, [active, surfaceRef]);
}

/**
 * Close when a click lands outside a surface that floats WITHOUT an overlay —
 * the bag, the Asterisk drawer. Surfaces with an overlay use
 * useOverlayDismiss instead.
 *
 * `excludeRef` must be the surface's own toggle button. Without it the toggle
 * stops working: the click closes the panel and then re-opens it, or appears
 * to do nothing at all.
 */
export function useClickAway(surfaceRef, onClose, { active = true, excludeRef = null } = {}) {
  useEffect(() => {
    if (!active) return undefined;
    const onDown = (event) => {
      const surface = surfaceRef.current;
      if (!surface || surface.contains(event.target)) return;
      if (excludeRef?.current && excludeRef.current.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [active, onClose, surfaceRef, excludeRef]);
}

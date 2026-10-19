# Definition of done

_Read when finishing any ASILUM task — the definition of done and the required report. Compiling is not completion._

A task is complete only when ALL of these hold:
1. `npm run build` passes (node from ~/.local).
2. The app RAN and the actual path was exercised in the browser
   (launch config "asilum", port 3458) — not just tests or types.
3. Console is clean on every touched page.
4. UI changes: verified in both themes, both interfaces, and at ≤760px;
   screenshot captured as proof.
5. Data changes: verified against the live store (or memory fallback
   AND live), test rows cleaned up.

## Required report (constitution format)
- summary of changes
- files changed and why
- build status
- what was tested (exact path/actions) — expected vs actual
- remaining issues / limitations
- what to test manually
- what the review should attack
- rollback note for risky changes

Never claim a feature works without having run it. Never mark gated
functionality as working because the code path exists.

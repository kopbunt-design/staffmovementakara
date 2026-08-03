---
name: report-date-logic
description: Reference for the effective-date / last-working-day attribution rule used by Headcount, Movement, and Workforce Overview reports. Load before changing any date/month logic in js/headcount.js, js/movement-report.js, js/workforce-overview.js, or the shared movYM/lastWorkYM helpers in js/app.js — this rule has caused five separate regression fixes in recent history.
---

# Report date-attribution rule

This app has one recurring class of bug: which calendar month a movement or
separation gets counted in. Five recent commits fixed regressions here
(`78fe73d`, `d26c739`, `fa3a4e6`, `cb08861`, `f1a2fcd`, `f026d79`, `95b5853`).
Before changing any report's date logic, re-derive and preserve this rule
rather than re-deriving it from scratch.

## The rule

- **New hires / active headcount** are attributed to the month of `join_date`
  (or the movement's `date`/`created_at` via `movYM` in `js/app.js`).
- **Separations** (Resignation, Termination, Retirement / status Resigned,
  Terminated, Retired) are attributed to the month of the **last working
  day**, not `created_at` and not the record's own `date` field. `lastWorkYM`
  (`js/app.js`) computes this by taking the stored `end_date`/`date` (which is
  the *effective date* — the first non-working day) and subtracting one day
  to land on the actual last working day, then formats it as `YYYY-MM`.
- **Month-end headcount** (`hcAtMonth`, defined identically in
  `js/headcount.js`, `js/movement-report.js`, `js/workforce-overview.js`, and
  inline in `renderDashboard` in `js/app.js`) excludes an employee once
  `lastWorkYM(end_date) <= ym` — the same last-working-day month used for
  separations, so the person leaves the headcount in exactly the month their
  separation is counted and Opening + New − Separations = Ending balances.
- **Canonical example:** effective date 1 Aug 2026 → last working day
  31 Jul → separation shows in **July**, person is **excluded from July's**
  ending headcount and still counted in June. Confirmed with the user on
  2026-08-03. Headcount Report used to count that separation in August (by
  the effective date's own month); that behaviour was replaced, not kept —
  there is no longer a second, competing approach anywhere in the app.
- Effective date (the field literally labeled "Effective Date" in the UI,
  stored as `end_date` on employees / `date` on movements) always takes
  precedence over `created_at` for month attribution. `created_at` is only a
  fallback when no effective date exists.

## When touching report logic

1. Identify whether the change affects new-hire attribution, separation
   attribution, or month-end headcount — they use different helpers
   (`movYM`, `lastWorkYM`, `hcAtMonth`) and must not be conflated.
2. Check all four report surfaces for consistency: Headcount Report
   (`js/headcount.js`), Movement Report (`js/movement-report.js`), Workforce
   Overview (`js/workforce-overview.js`), and the Dashboard (`js/app.js` —
   both `getMonthStats` and `activeAtMonth` inside `renderDashboard`). A fix
   in one has historically needed a matching fix in the others.
3. Run the regression test — it extracts the real functions from all four
   files and checks they still agree, so it catches one file drifting:

   ```
   osascript -l JavaScript test/headcount-date.test.js
   ```

   (JavaScriptCore via `osascript` is the only JS runtime on this machine —
   there is no Node, npm, or test framework.)
4. Then verify in the browser against a real employee whose separation
   effective date is the 1st of a month — the edge case that broke past
   attempts, since "effective date" and "last working day" differ by one day
   and land in different months. Serve over http (`python3 -m http.server
   8000`), not `file://`, or Supabase auth will refuse to log in.

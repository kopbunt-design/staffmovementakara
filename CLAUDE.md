# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Static SPA, no build step: vanilla JS with ES modules, HTML, CSS. No `package.json`, no bundler/transpiler, no test framework, no linter/formatter. UI text is in Thai (`lang="th"`).

- **Backend**: Supabase (Postgres + Auth). Client initialized once in `js/supabase-config.js`.
- **CDN libs** (loaded directly in `index.html`, no npm): `@supabase/supabase-js@2`, SheetJS `xlsx@0.18.5` (Excel import), `exceljs@4.4.0` (styled Excel export), Google Fonts (Sarabun).
- **Edge function**: `supabase/functions/admin-create-user/index.ts` (TypeScript, runs on Supabase, not part of the frontend bundle).
- **Deploy**: Vercel, auto-deploys on push to `main`. `vercel.json` is just an SPA rewrite (`/(.*) -> /index.html`) — no build command.

## Module map (`js/`)

- `app.js` — shared state (`currentUser`, `userRole`, `allEmployees`, `allMovements`), utils (`esc`, `fmtDate`, `movYM`, toast, badges), and the SPA router (`navigate`/`renderPage`, dynamic `import()` per page).
- `auth.js` — login/signup/logout, Google OAuth via Supabase, `onAuthStateChange` gates `#loginScreen` vs `#appShell`.
- `employees.js` — employee CRUD, Excel import/export.
- `masterdata.js` — hardcoded constant lookups (DIVISIONS, DEPARTMENTS, POSITIONS, SITES, CONTRACT_TYPES, etc.).
- `masterdata-admin.js` — DB-backed master data (divisions/depts/sections/teams/positions/job levels), renders the Settings page. Relationship to `masterdata.js`'s hardcoded lists is unclear — don't assume one supersedes the other; ask before consolidating them.
- `users.js` — user management (roles).
- `headcount.js`, `movement-report.js`, `workforce-overview.js`, `vacancy.js` — reporting pages.
- `supabase-config.js` — Supabase client init only.

## Gotchas

- **Supabase key is intentionally hardcoded** in `js/supabase-config.js` (URL + anon/publishable key). This is a publishable key protected by RLS — do not "fix" this by moving it to env vars or a `.env` file; that would break the static Vercel deploy, which has no build step to inject env vars.

- **Report date attribution — ONE rule, used by every report.** This is the #1 recurring bug source (8+ commits fixing regressions). Read this before touching any month/date logic.

  `end_date` (employees) and `date` (movements) hold the **termination date** — the first day the person is *no longer* working. The month a separation belongs to is the month of the **last working day**, i.e. termination date minus one day.

  **All of this lives in one place now — `js/app.js`. Do not re-define it per report; that duplication is what caused the repeat regressions.**

  - `sepYM(dateStr)` — subtracts 1 day, returns `"YYYY-MM"`. The separation month.
  - `isActiveAtMonthEnd(e, ym)` / `hcAtMonthEnd(emps, ym)` — excludes when `sepYM(end_date) <= ym`, and excludes not-yet-hired when `join_date > lastDayOfMonth(ym)`. It deliberately uses **the same `sepYM`**, so a person leaves the headcount in exactly the month their separation is counted and the balance below can never drift.
  - Separations: `sepYM(e.end_date) === ym` (employees) / `sepYM(m.date) === ym` (movements). **Not `movYM`** — `movYM` does not subtract the day.
  - New hires: `join_date` month, and `movYM` for New Hire movements.
  - **Canonical case:** termination 1 Aug 2026 → last working day 31 Jul → separation counted in **July**, person **excluded from July's** headcount, still counted in June.
  - Balances exactly: Opening + New Hires − Separations = Ending.

  Confirmed with the user on 2026-08-03. This flipped twice that day: a written spec asked for the separation to sit in August (the termination date's own month), but on seeing real numbers the user confirmed **July**. If a future request says "August", check it against this line before changing anything.

  Regression tests (no browser or Supabase needed):
  ```
  osascript -l JavaScript test/headcount-date.test.js   # 46 cases
  osascript -l JavaScript test/dashboard.test.js        # 33 cases
  ```
  They extract the real functions from `js/app.js` and assert the other reports do not re-define their own copies.

- **`movYM` vs `lastWorkYM`**: `movYM(movement)` in `app.js` returns the month of `movement.date` (falling back to `created_at`) **without** subtracting a day — it is for new hires and general movement filtering. `lastWorkYM(dateStr)` subtracts a day and is only for separations. Do not swap them.

## Workflow

- No PR process — commit directly to `main`; pushes auto-deploy via Vercel.
- No test suite or linter exists, so verify report/business-logic changes manually against real data rather than relying on automated checks.

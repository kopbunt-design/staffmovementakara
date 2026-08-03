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

  `end_date` (employees) and `date` (movements) hold the **effective date of separation** — the first day the person is *no longer* working. The month a separation belongs to is the month of the **last working day**, i.e. effective date minus one day (`lastWorkYM`).

  - `lastWorkYM(dateStr)`: subtracts 1 day from the effective date, returns `"YYYY-MM"`. Defined identically in `headcount.js`, `movement-report.js`, `workforce-overview.js`, and `app.js`.
  - `hcAtMonth(ym)`: exclude when `lastWorkYM(end_date) <= ym`; exclude future hires when `join_date` month `> ym`.
  - Separations counted by `lastWorkYM(end_date) === ym` (employees) / `lastWorkYM(v.date) === ym` (movements).
  - New hires counted by `join_date` month, and by `movYM` for New Hire movements.
  - **Example (the canonical case):** effective date 1 Aug 2026 → last working day 31 Jul → the separation shows in **July**, and the person is **excluded from July's ending headcount** (still counted in June).
  - Formula balances exactly: Opening + New Hires − Separations = Ending.

  Confirmed with the user on 2026-08-03; the Headcount Report previously counted separations by the effective date's own month, which put a 1 Aug separation in August. Do not reintroduce that.

  Regression test: `osascript -l JavaScript test/headcount-date.test.js` (extracts the real functions from all four files and checks they agree — no browser or Supabase needed).

- **`movYM` vs `lastWorkYM`**: `movYM(movement)` in `app.js` returns the month of `movement.date` (falling back to `created_at`) **without** subtracting a day — it is for new hires and general movement filtering. `lastWorkYM(dateStr)` subtracts a day and is only for separations. Do not swap them.

## Workflow

- No PR process — commit directly to `main`; pushes auto-deploy via Vercel.
- No test suite or linter exists, so verify report/business-logic changes manually against real data rather than relying on automated checks.

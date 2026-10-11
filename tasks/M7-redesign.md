# Tasks — Milestone M7 · Light redesign and search globe

| Field | Value |
|---|---|
| Milestone | M7 (after launch work; owner request 2026-10-11) |
| Exit criterion | the live site uses the approved light design, the logo, the search globe, the extension box and the price range on the home form; every existing test passes |
| Specs | 001 (intake form), 006 (price range), 009 (results experience), 011 (save controls) — behaviour unchanged, presentation only |
| Started | 2026-10-11 |
| Branch | `redesign`, from `main` after `brand-logo` (#22) |

Status: ☐ open · ◐ in progress · ☑ done · ⏸ waiting for the owner

## Decisions (2026-10-11)
1. **Light only.** The owner asked for a professional light frontend, so the dark colour scheme is removed. The
   browser-tab icon still adapts to dark browsers.
2. **Design source:** the prototype the owner approved (https://claude.ai/artifact/DpkbmnRCMVtyp5vjuAiQKZ) and the logo
   kit in `logos/final` (concept "Path Cut").
3. **Typefaces are served by the site** (`apps/web/assets/fonts`, OFL): Manrope ExtraBold for headings and the name,
   IBM Plex Sans for text, IBM Plex Mono for domain names. About 54 KB in total; no request to Google.
4. **The globe is canvas code with no library** (`components/globe`), loaded on demand: on the home page only for wide
   screens, on the results page when a search starts. "Reduce motion" shows a still picture; the search view has a
   pause button.
5. **Preferred extensions became a tag box** with suggestions from `/api/tlds` (every extension with an RDAP registry
   plus every priced one, built at deploy time and fetched only when the visitor types). Owner: a fixed list of
   chips was not enough.
6. **The home form's price range uses the bundled exchange-rate snapshot** (`packages/pricing/data/fx-rates.json`),
   marked approximate; the results page keeps using the day's rates. The chosen currency is shared with the results
   page.
7. **Entrance motion slides without fading,** so text never passes through low contrast (the axe test caught chips
   mid-fade).

## Tasks
| ID | Task | Status |
|---|---|---|
| A1 | Light tokens, fonts, shared button/card/field styles, wider page column for home and results | ☑ |
| A2 | Header with the logo, footer, account link as a button | ☑ |
| B1 | Home hero, form card, facts row, calm globe on wide screens | ☑ |
| B2 | Extension tag box with suggestions (`components/tld-input.tsx`, `app/api/tlds/route.ts`) | ☑ |
| B3 | Price range slider and currency on the home form | ☑ |
| C1 | Results: search globe until the first names arrive, then the progress card with the small globe | ☑ |
| C2 | Steps with `data-step` / `data-state` (tests no longer read the old "✓" text) | ☑ |
| C3 | Result rows, sections, filter bar, banners, chips, save controls | ☑ |
| D1 | End-to-end tests updated for the new markup; 84 pass on desktop and mobile | ☑ |
| D2 | Owner: review the preview deployment and merge | ⏸ |

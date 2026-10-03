# Golden set (evaluation examples)

`golden.jsonl` holds example descriptions with the answers we expect (spec 016 tech §3, FR-QA-004). The weekly
evaluation compares Jev's answers with these labels.

**Status (2026-10-03): 45 of the 170 examples spec 016 asks for. The owner confirmed every expected answer of the
20 normal examples and added good and bad names (in a spreadsheet; Claude turned them into domain labels:
lower case, no spaces or extension, accents removed, Hindi names romanized with the originals kept in
`goodNamesNative`). The 25 quick rows were not marked and the owner raised no objections.** The set grows to 170
before launch.

## How to label more examples
Easiest: ask Claude for the spreadsheet version (`golden-labels.csv`), fill it in, and Claude converts it back.
For each `benign` line:
1. Check `expected` (site type, top industries, region, flags that should be on/off) and fix anything that looks
   wrong. Allowed values: site types and flags in `specs/002-jev-integration/questions/catalog.md`, industries in
   `specs/003-website-feature-detection/tech.md` §5.1.
2. Add 3–5 names you would be happy to see to `goodNames`, and 2–3 poor ones to `badNames` (names only, no
   extension, for example `"crumbandcrust"`).

For `vague`, `harmful` and `tricky_benign` lines, just check that the description fits its category.
Never put real people's names, e-mail addresses or phone numbers in this file (FR-QA-011).

Target before launch: at least 60 benign (8 or more non-English), 10 vague, 50 harmful, 50 tricky-but-harmless.

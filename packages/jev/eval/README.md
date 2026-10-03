# Golden set (evaluation examples)

`golden.jsonl` holds example descriptions with the answers we expect (spec 016 tech §3, FR-QA-004). The weekly
evaluation compares Jev's answers with these labels.

**Status: starter draft (45 of the 170 examples spec 016 asks for). Labels were drafted by Claude and need the
owner's review.**

## How to label (owner task E1, about 2–3 hours)
For each `benign` line:
1. Check `expected` (site type, top industries, region, flags that should be on/off) and fix anything that looks
   wrong. Allowed values: site types and flags in `specs/002-jev-integration/questions/catalog.md`, industries in
   `specs/003-website-feature-detection/tech.md` §5.1.
2. Add 3–5 names you would be happy to see to `goodNames`, and 2–3 poor ones to `badNames` (names only, no
   extension, for example `"crumbandcrust"`).

For `vague`, `harmful` and `tricky_benign` lines, just check that the description fits its category.
Never put real people's names, e-mail addresses or phone numbers in this file (FR-QA-011).

Target before launch: at least 60 benign (8 or more non-English), 10 vague, 50 harmful, 50 tricky-but-harmless.

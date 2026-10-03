# Spec 004 — Domain Name Generation

| Field | Value |
|---|---|
| Spec ID | 004 |
| Area code | `GEN` |
| Status | Approved (2026-10-03) |
| Depends on | 002, 003 |
| Used by | 005 (availability), 008 (ranking) |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
The decision model chosen for this product cannot write text, so the product itself must **create** the name
ideas. Most obvious names ("bakery.com") are taken, so the generator must be creative *and* relevant: it has to
produce hundreds of varied, pronounceable, on-topic ideas so that, after availability checks, enough good
available names remain in every price section. Generation must also be safe (no brand imitations, no offensive
words) and reproducible (the same search gives the same ideas, which makes testing and caching possible).

## 2. What (scope summary)
From the description and detected features, the generator:
1. picks out the key words and weighs how central each is,
2. finds related words (synonyms, associated words) and keeps only those that fit the site,
3. combines them using many naming styles (exact words, two-word combinations, prefixes/suffixes, blends,
   shortened forms, alliteration, rhymes, invented brandable words, extension "hacks", place-based names,
   action phrases, personal names),
4. removes invalid, hard-to-say, offensive and brand-imitating ideas,
5. passes a diverse set of up to 1,000 candidate names to ranking.

## 3. User stories and acceptance criteria

### US-1 Varied ideas
As a visitor, I want ideas in different styles so I can choose what feels right.
- **Given** a description of an online bakery **When** results appear **Then** the recommendations include at least 4
  different naming styles (e.g. exact keyword, combination, brandable, place-based).

### US-2 Respect my constraints
As a visitor who set "max 10 letters, no hyphens, no numbers", I want every idea to follow these rules.
- **Given** those preferences **When** results appear **Then** no recommended name breaks them.

### US-3 More ideas on request
As a visitor who wants more, I want new ideas rather than repeats.
- **Given** I press "Find more" **When** new results arrive **Then** none of them repeat names I have already seen in this search.

### US-4 Same search, same ideas
As the owner, I want reproducible results.
- **Given** the same description, preferences and version **When** searched twice **Then** the same candidate list is produced.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-GEN-001 | The system MUST extract key terms (words and short phrases) from the description. | MUST |
| FR-GEN-002 | The system MUST weigh each key term by how central it is to the website, using the decision model, with a fallback weighting. | MUST |
| FR-GEN-003 | The system MUST find related words for the top terms and keep only those judged to fit the website. | MUST |
| FR-GEN-004 | The system MUST generate candidates with at least these styles: exact term, two-word combination, prefix/suffix, blend, shortened form, alliteration, rhyme, invented brandable word, extension hack, place-based, action phrase, personal name (when relevant). | MUST |
| FR-GEN-005 | Every candidate MUST record which style produced it (used for diversity and explanations). | MUST |
| FR-GEN-006 | Every candidate MUST be a valid domain label: 1–63 characters, only letters, digits and hyphens, not starting or ending with a hyphen. | MUST |
| FR-GEN-007 | Candidates MUST respect the user's preferences (maximum length, hyphens allowed or not, digits allowed or not). Defaults: digits allowed, hyphens not allowed. When hyphens are allowed, a name MAY contain any number of hyphens within the label rules of FR-GEN-006. | MUST |
| FR-GEN-008 | Candidates MUST be scored for quality (length, ease of pronunciation, spelling clarity, real-word structure), and clearly poor candidates MUST be removed. | MUST |
| FR-GEN-009 | Offensive words and imitations of well-known brands MUST be removed before ranking. | MUST |
| FR-GEN-010 | Exact and near duplicates (e.g. singular/plural of the same idea) MUST be merged. | MUST |
| FR-GEN-011 | The generator MUST produce between 500 and 2,000 raw candidates and pass at most 1,000 to ranking, with no single style above 40% of the passed set. | MUST |
| FR-GEN-012 | Place-based names MUST be generated when the site serves a specific place. | MUST |
| FR-GEN-013 | Extension hacks MUST only use extensions that exist and have a known price. | MUST |
| FR-GEN-014 | Generation MUST be reproducible for the same input and version. | MUST |
| FR-GEN-015 | "Find more" MUST produce candidates not previously shown in the same search. | MUST |
| FR-GEN-016 | The generator SHOULD use naming trends observed in newly registered domains (e.g. popular suffixes) to adjust style weights. | SHOULD |
| FR-GEN-017 | For descriptions in non-Latin scripts, the generator SHOULD use romanized forms of key terms, in addition to brandable names. | SHOULD |
| FR-GEN-018 | Generation MUST still work (with offline word data) when the related-words service is unavailable. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-GEN-001 | Generation + filtering time (excluding external calls) | < 300 ms p95 |
| NFR-GEN-002 | Related-word lookups per search | ≤ 15 |
| NFR-GEN-003 | Share of top-60 candidates judged "good fit" or better by ranking (evaluation set) | ≥ 50% |
| NFR-GEN-004 | Offensive or brand-imitating names reaching the user (evaluation + reports) | 0 known cases |

## 6. Data used (conceptual)
- Description, detected features, keyword hints, user preferences.
- Word data: dictionary, related-word data (online service + offline copy), offensive-word list, popular-brand list,
  naming trends from newly registered domains.
- Output: candidate names with style tag, source terms and quality score.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| Description has only one meaningful word | Rely more on related words, brandable and affix styles. |
| Very long compound words exceed max length | Shortened forms and brandable styles fill the gap. |
| Key term is itself a brand ("Nike shoe repair") | Brand word is not used in names (spec 014); other terms used. |
| Related-words service slow/down | Offline data used; no user-visible error. |
| All candidates filtered out by strict preferences | Show an explanation and suggest relaxing preferences. |

## 8. Out of scope
- Internationalized (non-ASCII) names.
- Trademark law checks (we avoid obvious brand imitations but give no legal guarantee; stated in the terms).
- Logo or slogan generation.

## 9. Success metrics
- Average ≥ 20 available recommendations per search across paid sections.
- ≥ 4 naming styles represented in the top 20 of an average search.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Should numbers be allowed by default? | Yes — digits are allowed by default (FR-GEN-007, spec 001 FR-INT-005); the user can turn them off. |
| 2. When hyphens are enabled, any number or only one? | Any number, within valid label rules (FR-GEN-007). |

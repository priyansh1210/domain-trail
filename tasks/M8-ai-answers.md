# Tasks — Milestone M8 · AI answers for signed-in users

| Field | Value |
|---|---|
| Milestone | M8 (owner request 2026-10-11) |
| Exit criterion | only signed-in accounts that switch on AI answers reach the decision model; signed-out visitors see the switch locked with a sign-in link; every existing test passes |
| Specs | 001 (US-7, FR-INT-015), 002 (US-5, FR-JEV-018 to 021) |
| Started | 2026-10-11 |
| Branch | `ai-switch`, from `main` |

Status: ☐ open · ◐ in progress · ☑ done · ⏸ waiting for the owner

## Decisions (2026-10-11)
1. **Only signed-in accounts** can switch on AI answers; guest sessions (saved items without an account) count as
   signed out. The server decides from the session.
2. **Show the switch now**, before Jev credits are bought. With the switch on and no answer from Jev, the existing
   "decision model is unavailable" notice explains the rules-based results.
3. **Signed-out visitors** see the switch locked with "Sign in to use AI answers"; the typed description survives
   the sign-in round trip.
4. **Off by default** for signed-in users; the choice is remembered on that browser.
5. **Searches without AI answers send nothing to the model** and are not "degraded". The privacy policy says so
   (same version, effective date 2026-10-11: the change only narrows what is shared).

## Tasks
| ID | Task | Status |
|---|---|---|
| A1 | Spec amendments: 001 US-7, FR-INT-015; 002 US-5, FR-JEV-018 to 021, edge cases, owner decisions; tech notes and traceability | ☑ |
| A2 | `rulesOnly()` decision service in `packages/jev` | ☑ |
| A3 | `PreferencesSchema.aiAnswers`; `lib/server/ai.ts` (`aiAllowed`, `decisionsFor`) used by search, more and refine; separate cache; degraded and usage only with AI on | ☑ |
| B1 | Form switch (locked with sign-in link when signed out, remembered when signed in), draft kept across sign-in | ☑ |
| B2 | Privacy policy wording for the decision model | ☑ |
| C1 | Tests: `rules-only.test.ts`, `ai-answers.int.test.ts`, e2e `ai-answers.spec.ts` | ☑ |
| D1 | Owner: review and merge; later, buy Jev credits so AI answers start working | ⏸ |

// AI answers (spec 002 tech §5.10, FR-JEV-018, 019): the decision model is asked only for signed-in accounts that
// switched it on. The server decides from the session; the browser's switch is only a request.
import { rulesOnly, type DecisionService } from '@domains-all/jev';
import type { Services } from './services';
import type { SessionUser } from './session';

const RULES_ONLY = rulesOnly();

/** Guest sessions (anonymous users kept for saved items) do not count as signed in. */
export function aiAllowed(user: SessionUser | null | undefined, requested: boolean): boolean {
  return requested && Boolean(user) && !user!.isAnonymous;
}

/** The live decision service when AI answers apply, otherwise one that asks nothing (every stage uses its rules). */
export function decisionsFor(svc: Services, ai: boolean): DecisionService {
  return ai ? svc.jev : RULES_ONLY;
}

// Next.js server hook: every unhandled server error is reported (spec 015 FR-OBS-001) after scrubbing
// (lib/server/errors.ts). Reporting never throws; without SENTRY_DSN nothing leaves the server.
export async function onRequestError(
  err: unknown,
  request: { method: string },
  context: { routePath: string; routeType: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // every route here runs on Node.js
  const [{ reportError }, { serverEnv }] = await Promise.all([
    import('./lib/server/errors'),
    import('@domains-all/config'),
  ]);
  await reportError(
    err,
    { route: context.routePath, method: request.method, kind: context.routeType },
    serverEnv(),
  ).catch(() => undefined);
}

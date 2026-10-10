# Rotate secrets

**When:** a secret may have leaked (pasted somewhere, a laptop lost, a provider reports it) — immediately; otherwise
once a year (spec 013 §5.5, FR-PRIV-012).

| Secret | Where to create a new one | Where it lives |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API keys → roll | Vercel (Production) |
| `SUPABASE_DB_URL` (password) | Supabase → Database → reset password | GitHub environments `production` and `jobs` |
| `SEARCH_LINK_SECRET`, `VISITOR_SALT_SECRET`, `UNSUBSCRIBE_SECRET` | any 32+ random characters (`openssl rand -hex 32`) | Vercel (+ `jobs` for the unsubscribe secret) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash → database → reset token | Vercel |
| `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → rotate secret | Vercel and Supabase CAPTCHA settings |
| `RESEND_API_KEY` | Resend → API keys | `jobs` environment, Vercel |
| Google / GitHub OAuth secrets | Google Cloud console / GitHub OAuth app | Supabase → Authentication → Providers |
| `AI_GATEWAY_API_KEY`, `NGROK_AI_API_KEY`, `PORKBUN_*` | the provider's dashboard | Vercel / GitHub `production` |

Steps for each: create the new value → save it where it lives → redeploy (Vercel → Deployments → Redeploy) or re-run
the workflow → check `/api/health` → **then** revoke the old value at the provider.

Notes: changing `SEARCH_LINK_SECRET` makes existing result links invalid (shared links stop working); changing
`VISITOR_SALT_SECRET` only resets today's rate-limit counters. The backup key pair is separate: if the private key
leaks, make a new pair (`docs/setup.md` Part C step 4) and delete old backup artifacts in GitHub Actions.

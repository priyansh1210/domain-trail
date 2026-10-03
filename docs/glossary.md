# Glossary

| Field | Value |
|---|---|
| Status | Approved (2026-10-03) |
| Last updated | 2026-10-03 |

## Domain terms

| Term | Meaning |
|---|---|
| **Domain name** | A human-readable address such as `sunnybakery.com`. |
| **FQDN** | Fully qualified domain name: the full name including its extension, e.g. `sunnybakery.com`. |
| **Label** | One part of a domain name between dots. In `sunnybakery.com`, `sunnybakery` is the label we generate. |
| **TLD** | Top-level domain, the extension at the end: `.com`, `.io`, `.shop`, `.in`. |
| **gTLD** | Generic TLD, open to everyone worldwide (`.com`, `.net`, `.org`, `.app`, `.shop`). |
| **ccTLD** | Country-code TLD (`.in`, `.uk`, `.de`). Some are open to everyone, some require local presence. |
| **New gTLD** | TLDs launched from 2012 onward (`.app`, `.dev`, `.shop`, `.store`, `.xyz`…). |
| **Restricted TLD** | A TLD whose registry requires proof of eligibility (e.g. `.us` needs US nexus, `.eu` needs EU residency, `.dev`/`.app` require HTTPS). |
| **Registry** | The organization running a TLD (e.g. Verisign runs `.com`). Sets wholesale prices and premium lists. |
| **Registrar** | A company that sells domain registrations to the public (e.g. Porkbun, Namecheap). |
| **Registration price** | Price for the first year of a new registration. Often promotional. |
| **Renewal price** | Price for each following year. Can be much higher than the first-year price. |
| **Premium domain (registry premium)** | A still-unregistered name the registry prices above the normal rate (e.g. short or dictionary words). |
| **Aftermarket domain** | A domain already registered by someone who lists it for resale on a marketplace. |
| **Free subdomain** | A free address under someone else's domain, e.g. `sunnybakery.is-a.dev` or `sunnybakery.pages.dev`. |
| **LDH rule** | Letters-Digits-Hyphen: a label may contain only `a–z`, `0–9` and `-`, be 1–63 characters, and not start or end with `-`. |
| **IDN** | Internationalized domain name (non-ASCII letters, e.g. `café.com`), encoded as `xn--…` (punycode). Out of scope for phase 1. |
| **Domain hack** | A name where the TLD completes a word, e.g. `cook.in`, `foodi.es`. |
| **Brand lookalike** | A name that imitates a known brand (`paypa1.com`, `amazon-deals.shop`). Always excluded. |
| **Dropping soon** | A registered domain in its redemption or pending-delete period that may become available. |

## Data and lookup terms

| Term | Meaning |
|---|---|
| **RDAP** | Registration Data Access Protocol. The modern, structured replacement for WHOIS. An RDAP "not found" (HTTP 404) from the authoritative registry means the name is not registered. |
| **IANA RDAP bootstrap** | A public file from IANA that says which RDAP server is responsible for each TLD. |
| **DNS** | The Domain Name System that turns names into server addresses. |
| **DoH** | DNS-over-HTTPS: DNS lookups made over HTTPS to public resolvers (Cloudflare, Google). |
| **NS record** | Name-server record. A registered domain almost always has NS records; an unregistered one returns NXDOMAIN. |
| **NXDOMAIN** | DNS answer meaning "this name does not exist". A strong hint (but not proof) that the domain is unregistered. |
| **NRD** | Newly registered domains: a daily list of domains registered the previous day. |
| **Tranco list** | A free, research-grade ranking of the most popular websites, updated daily. Used to detect brand lookalikes. |
| **TTL (cache)** | How long a stored check result is trusted before it must be checked again. |
| **FX rate** | Foreign-exchange rate used to show prices in the user's currency. |

## Product terms

| Term | Meaning |
|---|---|
| **Description** | The text the user writes about the website they want to build. |
| **Preferences** | Optional user settings: preferred TLDs, max length, no hyphens/digits, country, price range. |
| **Detected features** | What the system learns from the description: site type, industry, audience, geography, tone, capability flags. |
| **Candidate** | A generated label (before availability is known). |
| **Recommendation** | A candidate + TLD that is checked, priced, scored and shown to the user. |
| **Upfront price** | What the user pays today: the first-year price, or the full minimum term for extensions that require multiple years (e.g. 2 years). |
| **Price section / tier** | Result grouping by upfront price in USD, labelled only by price range: **Free** ($0), **$1–100** ($0.01–$100), **$101–300** ($100.01–$300), **$300+** (> $300; hidden when nothing can fill it). Internal codes: free / budget / mid / premium. |
| **Price range filter** | The two-handle slider ($0 to $10,000+, shown in the chosen display currency) that shows only results between a chosen minimum and maximum price. |
| **Display currency** | The currency the user picks for showing prices; conversion is approximate, section boundaries stay in USD. |
| **Saved search** | A search kept for later. Signed-in users' saved searches include the description and are re-checked daily for alerts; signed-out visitors' saved searches never include the description. |
| **Watchlist / saved names** | Specific domains a user follows. Signed-in users get in-app alerts when the status changes; signed-out visitors can save names too. |
| **Anonymous saver** | A signed-out visitor who pressed Save; identified only by a random identifier in their browser. Their saved items are removed after 90 days without use. |
| **Admin view** | The owner-only page showing accounts, saved items and watchlists (disclosed in the Privacy Policy). |
| **Degraded mode** | Operation without Jev (ranking by deterministic scoring only), shown to the user with a banner. |
| **Golden set** | A fixed collection of example descriptions with expected outputs, used to test Jev quality. |

## Jev terms

| Term | Meaning |
|---|---|
| **Jev** | TypeSafe AI's "System One" decision model (released 2026-09-15). Returns typed answers with probabilities; does not generate text. |
| **State** | The input Jev reasons about (text or JSON), e.g. the description and detected features. |
| **Question** | One typed decision asked about the state. Several questions can be sent in one request; they are evaluated independently. |
| **choice** | Question type: pick one of up to 255 named options; returns the chosen key, a probability per option and a confidence. |
| **score** | Question type: place the state on an ordered rubric (2–10 levels); returns an expected score, per-level probabilities and a confidence. |
| **noul** | Question type: probability (0–1) that a statement about the state is true. |
| **Question catalog** | Our versioned list of every Jev question (id, version, type, instructions, criteria). |
| **AI Gateway** | A proxy (Vercel AI Gateway) that forwards requests to Jev and applies free monthly credits. |

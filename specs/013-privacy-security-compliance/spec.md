# Spec 013 — Privacy, Security and Compliance

| Field | Value |
|---|---|
| Spec ID | 013 |
| Area code | `PRIV` |
| Status | Approved (2026-10-03) |
| Depends on | 000, 012 |
| Tech file | [tech.md](./tech.md) |
| Last updated | 2026-10-03 |

## 1. Why (problem and value)
People describe business ideas that are often confidential. Signed-in users trust us with their e-mail and plans.
Privacy laws apply as soon as we serve users in India (Digital Personal Data Protection Act 2023), the EU/UK (GDPR)
and elsewhere. A free project cannot afford a data breach or a legal complaint. Designing privacy and security in
from the start is cheaper than fixing them later, and "we don't keep your idea" is a real selling point.

## 2. What (scope summary)
- Privacy by default: anonymous use, minimal data, no tracking cookies, no stored anonymous descriptions.
- Clear Privacy Policy and Terms in plain language, versioned, with recorded acceptance for accounts.
- User rights: access/export, correction, deletion, withdrawal of consent, grievance contact.
- Security baseline for a small web app: secure transport and headers, least-privilege access, secret handling,
  dependency and code scanning, logging without personal data, incident response.
- Transparency about every third-party service that processes data (sub-processors).

## 3. User stories and acceptance criteria

### US-1 My idea stays mine
As a visitor, I want my website idea not to be kept or reused.
- **Given** I search anonymously **When** the search ends **Then** no server-side copy of my description remains in databases, logs or error reports.

### US-2 Understand what happens to my data
As a visitor, I want a short, clear privacy explanation.
- **Given** the Privacy page **When** I read it **Then** I find, in plain language: what is collected, why, for how long, which services
  process it, and how to exercise my rights — with a summary at the top readable in 1 minute.

### US-3 Exercise my rights
As a user, I want to export, correct or delete my data and to complain if needed.
- **Given** my account **When** I use export/edit/delete, or write to the grievance contact **Then** the action completes immediately
  (export/edit/delete) or I get a response within 30 days (grievance).

### US-4 No surprise tracking
As a visitor, I want no advertising or tracking cookies.
- **Given** any page **When** I inspect cookies **Then** only strictly necessary cookies exist (sign-in session, security check, and a
  saved-items identifier that is created only after I press Save).

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-PRIV-001 | A Privacy Policy MUST describe: data collected, purposes, legal basis/consent, retention, who can access stored data (including that the site operator can see saved items), sub-processors and their locations, user rights, contact and grievance process, children, changes. | MUST |
| FR-PRIV-002 | Terms of Service MUST state: availability and prices may change and are not guaranteed; we do not sell domains; no trademark clearance is provided; acceptable use; limitation of liability. | MUST |
| FR-PRIV-003 | Only strictly necessary cookies MAY be used (sign-in session, security check, the saved-items identifier created when a visitor first saves); analytics MUST be cookieless and aggregate. | MUST |
| FR-PRIV-004 | Descriptions, e-mail addresses and IP addresses MUST NOT appear in logs, analytics or error reports. | MUST |
| FR-PRIV-005 | IP addresses MUST NOT be stored; abuse prevention MAY use short-lived, rotating, non-reversible fingerprints. | MUST |
| FR-PRIV-006 | Users MUST be able to access/export, correct and delete their personal data and withdraw consent (stop alerts) themselves. | MUST |
| FR-PRIV-007 | A grievance/contact channel MUST exist, with responses within 30 days. The published grievance contact is Priyansh K (priyansh1210@gmail.com). | MUST |
| FR-PRIV-008 | Accounts MUST be limited to users aged 18 or over (confirmed at sign-up); the site MUST NOT be directed at children. | MUST |
| FR-PRIV-009 | The list of sub-processors MUST be published and kept current; material changes MUST update the policy version. | MUST |
| FR-PRIV-010 | Data sent to the decision-model provider MUST be limited to the description, preferences and candidate names, and this MUST be disclosed. | MUST |
| FR-PRIV-011 | All traffic MUST use HTTPS with modern security headers (strict transport, content security policy, frame protection, referrer policy, permissions policy). | MUST |
| FR-PRIV-012 | Secrets MUST never be stored in the code repository or sent to the browser; there MUST be a documented rotation procedure. | MUST |
| FR-PRIV-013 | Dependencies and code MUST be scanned for known vulnerabilities automatically; critical issues MUST be fixed within 7 days. | MUST |
| FR-PRIV-014 | All administrator accounts on service providers MUST use two-factor authentication; admin access MUST be limited to the owner (and named maintainers). | MUST |
| FR-PRIV-015 | A security incident procedure MUST exist: detect, contain, assess, notify affected users and authorities within legal deadlines, and review. | MUST |
| FR-PRIV-016 | Policy versions MUST be recorded, and account holders' acceptance MUST be stored with time and version. | MUST |
| FR-PRIV-017 | User data MUST be stored in India (Mumbai region), and this MUST be disclosed. | MUST |
| FR-PRIV-018 | Every input from users or external services MUST be validated; outputs MUST be encoded to prevent injection. | MUST |

## 5. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-PRIV-001 | Security header scan (e.g. securityheaders-style) | grade A |
| NFR-PRIV-002 | Known critical vulnerabilities in production dependencies | 0 older than 7 days |
| NFR-PRIV-003 | Baseline security checklist (OWASP ASVS level 1) | 100% of applicable items |
| NFR-PRIV-004 | Privacy summary readability | readable in ~1 minute, plain language |

## 6. Data used (conceptual)
See spec 012 inventory. This spec governs how that data is protected and disclosed.

## 7. Edge cases and failure behavior

| Situation | Expected behavior |
|---|---|
| A user pastes personal data (phone/e-mail) into the description | Removed before processing (spec 001); still never logged. |
| A sub-processor has a breach | Assess impact; notify users if their data is affected; update policy if provider changes. |
| Law enforcement request | Only data we hold (minimal); owner reviews each request; documented. |
| User under 18 signs up | Blocked by the age confirmation; if later discovered, the account is deleted. |

## 8. Out of scope
- Formal certifications (ISO 27001, SOC 2).
- Paid security tooling.
- Legal advice — policy texts should be reviewed by a qualified person before launch (recommended, not a free item).

## 9. Success metrics
- Zero personal-data incidents.
- 100% of export/delete requests handled self-service.

## 10. Owner decisions (2026-10-03)
The reviewer questions of the draft were answered by the owner; the answers are applied above.

| Question | Decision |
|---|---|
| 1. Data region: India or EU? | India (Mumbai) (FR-PRIV-017). |
| 2. Grievance contact | Priyansh K, priyansh1210@gmail.com (FR-PRIV-007). |
| 3. Minimum age 18 for accounts? | Yes, 18 (FR-PRIV-008). |
| Extra (from 009) | The policy states that saved items are stored and visible to the operator (FR-PRIV-001). |

// Privacy Policy and Terms (spec 013 tech §5.7, §5.8; FR-PRIV-001, 002, 007, 009, 017; FR-ACC-021). Versioned with
// POLICY_VERSION: a change in meaning needs a new version, which signed-in users accept again. Plain English on
// purpose. This text is not legal advice; a qualified review is recommended before launch (spec 013 §14).
import { accounts, retention } from '@domains-all/config/defaults';
import { POLICY_VERSION_DEFAULT } from './policy-version';

export interface PolicySection {
  id: string;
  heading: string;
  paragraphs?: string[];
  list?: string[];
  table?: { head: string[]; rows: string[][] };
}

export interface Policy {
  version: string;
  effective: string;
  title: string;
  sections: PolicySection[];
}

export interface PolicyContext {
  siteName: string;
  siteUrl: string;
  grievanceName: string;
  grievanceEmail: string;
}

export const POLICIES_EFFECTIVE = '2026-10-10';

export function privacyPolicy(c: PolicyContext): Policy {
  return {
    version: POLICY_VERSION_DEFAULT,
    effective: POLICIES_EFFECTIVE,
    title: 'Privacy Policy',
    sections: [
      {
        id: 'summary',
        heading: 'Summary',
        list: [
          'You can search without an account.',
          'We do not keep your website description: it is used for your search and then forgotten. Only signed-in users can choose to save it with a saved search.',
          'No advertising and no tracking cookies. Our visitor statistics are cookieless.',
          'Saving and accounts store the names, searches and settings you choose to save.',
          'Saved items are stored on our servers and can be seen by the site operator.',
          'You can download or delete your data at any time from your account page.',
        ],
      },
      {
        id: 'collected',
        heading: 'What we collect',
        list: [
          'Searching without an account: your description and options are processed in memory to produce results. We store the detected features (for example "online store, India"), the options and the results for 7 days so the results link works — never the description itself.',
          `Saving without an account: a random identifier kept in a cookie in your browser, plus the names and searches you save (without the description). Unused items are deleted after ${accounts.anonSavedRetentionDays} days.`,
          'Signed-in users: your e-mail address and sign-in provider (Google or GitHub; we never see a password), your settings, saved searches (with the description if you choose), watched names, alerts, and when you accepted these terms.',
          'Feedback: thumbs up/down and reports on results, linked to a pseudonymous visitor code that changes every day and cannot be turned back into your IP address.',
          'Technical data: our hosting provider processes IP addresses and request logs to deliver the site; our own code never stores IP addresses.',
        ],
      },
      {
        id: 'access',
        heading: 'Who can see your data',
        list: [
          'You.',
          'The site operator, through a private admin page that lists accounts, saved searches and watched names (of signed-in and signed-out savers). It is used to run and improve the service, never sold or shared.',
          'The service providers listed below, only as far as they need it to run the service.',
        ],
      },
      {
        id: 'purposes',
        heading: 'Why we use it (purposes and legal basis)',
        paragraphs: [
          'We use your data only to provide the service you ask for: suggesting and checking domain names, saving and watching names, alerts, keeping the service safe from abuse, and fixing errors. By searching, saving or creating an account you consent to this use for that purpose (Digital Personal Data Protection Act 2023, India; and, where it applies, the GDPR: consent and our legitimate interest in a safe service). You can withdraw consent at any time by deleting your saved items or your account.',
        ],
      },
      {
        id: 'decision-model',
        heading: 'Automated suggestions',
        paragraphs: [
          'Your description may be sent to a decision model (Jev by TypeSafe, through an AI gateway) to detect the kind of website and to rank names. Only the description and generated names are sent, never your e-mail or account. While the model is not connected, the site uses built-in rules instead and nothing is sent.',
        ],
      },
      {
        id: 'retention',
        heading: 'How long we keep it',
        table: {
          head: ['Data', 'Kept for'],
          rows: [
            ['Your description', 'Not stored (only in your browser tab while you use it)'],
            ['Search results without an account', `${retention.anonymousSearchDays} days`],
            ['Saved items without an account', `${accounts.anonSavedRetentionDays} days after last use`],
            ['Account, saved searches, watched names', 'Until you delete them or your account'],
            ['Alerts', `${retention.notificationDays} days`],
            ['Feedback on results', `${retention.feedbackMonths} months, then only totals`],
            ['Messages to us (contact form)', '1 year'],
            ['Encrypted backups', `${retention.backupDays} days`],
          ],
        },
      },
      {
        id: 'processors',
        heading: 'Service providers and where data is stored',
        table: {
          head: ['Provider', 'What for', 'Where'],
          rows: [
            [
              'Vercel',
              'Hosting the site; AI gateway for the decision model',
              'Functions in Mumbai, India; global network',
            ],
            ['Supabase', 'Database and sign-in', 'Mumbai, India'],
            [
              'TypeSafe (Jev)',
              'Decision model, when connected (description and names only)',
              'United States',
            ],
            ['Google, GitHub', 'Sign-in, if you choose them', 'Their own locations'],
            [
              'Cloudflare',
              'Human check, cookieless statistics, DNS look-ups of domain names',
              'Global network',
            ],
            ['Upstash', 'Rate limits (pseudonymous keys, expire within 24 hours)', 'Region nearest Mumbai'],
            ['Sentry', 'Error reports with personal data removed', 'United States / EU'],
            ['GitHub', 'Scheduled data jobs and encrypted backups', 'United States'],
            [
              'Resend',
              'Alerts to the site operator; e-mail to users only once e-mail is switched on',
              'United States',
            ],
            [
              'Domain registries, Porkbun, Datamuse',
              'Checking names and prices (domain names and single words only)',
              'Various',
            ],
          ],
        },
      },
      {
        id: 'rights',
        heading: 'Your rights',
        list: [
          'Access and download: "Download my data" on your account page.',
          'Correction: change your settings on the account page, or write to us.',
          'Deletion: "Delete my account" (or "Delete my saved items") deletes your data at once; it leaves our backups within 28 days.',
          'Withdraw consent: delete your saved items or account at any time.',
          'Nominate someone to act for you, and complain to us (grievance contact below) or to the Data Protection Board of India.',
        ],
      },
      {
        id: 'children',
        heading: 'Children',
        paragraphs: [
          'Accounts are for people aged 18 or over. We do not knowingly keep data about children.',
        ],
      },
      {
        id: 'security',
        heading: 'Security',
        paragraphs: [
          'Encrypted connections, strict security headers, row-level access rules in the database, secrets kept out of the code, two-factor sign-in on every service account, encrypted backups, automatic security scanning of the code, and logs without personal data.',
        ],
      },
      {
        id: 'transfers',
        heading: 'International transfers',
        paragraphs: [
          'Our database is in India. Some providers above process data in other countries; we use them only for the purposes listed and choose providers with appropriate safeguards.',
        ],
      },
      {
        id: 'changes',
        heading: 'Changes and contact',
        paragraphs: [
          'We publish every version with its date. If a change affects what we do with your data, signed-in users are asked to accept the new version.',
          `Grievance contact: ${c.grievanceName} — ${c.grievanceEmail}. You can also use the contact page at ${c.siteUrl}/contact. We answer within 30 days.`,
        ],
      },
    ],
  };
}

export function terms(c: PolicyContext): Policy {
  return {
    version: POLICY_VERSION_DEFAULT,
    effective: POLICIES_EFFECTIVE,
    title: 'Terms',
    sections: [
      {
        id: 'service',
        heading: 'The service',
        paragraphs: [
          `${c.siteName} suggests domain names for a website you describe and checks whether they look available and what registrars charge. It is free and offered as is.`,
        ],
      },
      {
        id: 'no-guarantee',
        heading: 'No guarantees',
        paragraphs: [
          'Availability and prices come from public sources and can change at any moment. A name we show as available may already be taken when you try to buy it, and prices can differ at checkout.',
        ],
      },
      {
        id: 'registrars',
        heading: 'Buying a name',
        paragraphs: [
          'We do not sell or register domain names. Purchases happen at the registrar you choose, under its terms and prices. We receive no payment or commission from registrars.',
        ],
      },
      {
        id: 'trademarks',
        heading: 'Trademarks',
        paragraphs: [
          'We try to leave out names that imitate well-known brands, but we do not check trademarks. Please check that a name does not infringe anyone’s rights before you buy or use it.',
        ],
      },
      {
        id: 'acceptable-use',
        heading: 'Acceptable use',
        list: [
          'Do not use the service for phishing, impersonation, fraud or anything illegal.',
          'Do not scrape the service automatically or try to get around its limits or human checks.',
          'Do not try to access other people’s data or disrupt the service.',
        ],
      },
      {
        id: 'accounts',
        heading: 'Accounts',
        paragraphs: [
          'You must be 18 or older to create an account. Keep your sign-in account secure. We may suspend accounts that break these terms.',
        ],
      },
      {
        id: 'liability',
        heading: 'Liability',
        paragraphs: [
          'To the extent the law allows, we are not liable for losses from using the service, such as a name being registered by someone else, a price changing, or a trademark dispute.',
        ],
      },
      {
        id: 'law',
        heading: 'Law',
        paragraphs: ['These terms are governed by the laws of India.'],
      },
      {
        id: 'changes',
        heading: 'Changes and contact',
        paragraphs: [
          'We publish every version with its date; signed-in users accept a new version when its meaning changes.',
          `Contact: ${c.grievanceName} — ${c.grievanceEmail}, or ${c.siteUrl}/contact.`,
        ],
      },
    ],
  };
}

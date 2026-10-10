import type { Metadata } from 'next';
import { serverEnv, siteIdentity } from '@domains-all/config';
import { PolicyView } from '@/components/policy-view';
import { privacyPolicy } from '@/content/policies';

export const metadata: Metadata = { title: 'Privacy Policy' };

// Spec 013 tech §5.7 (FR-PRIV-001, 007, 009, 017; FR-ACC-021).
export default function PrivacyPage() {
  const env = serverEnv();
  const site = siteIdentity(env);
  return (
    <PolicyView
      policy={privacyPolicy({
        siteName: site.name,
        siteUrl: site.origin,
        grievanceName: env.GRIEVANCE_NAME,
        grievanceEmail: env.GRIEVANCE_EMAIL,
      })}
    />
  );
}

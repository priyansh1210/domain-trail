import type { Metadata } from 'next';
import { serverEnv, siteIdentity } from '@domains-all/config';
import { PolicyView } from '@/components/policy-view';
import { terms } from '@/content/policies';

export const metadata: Metadata = { title: 'Terms' };

// Spec 013 tech §5.8 (FR-PRIV-002).
export default function TermsPage() {
  const env = serverEnv();
  const site = siteIdentity(env);
  return (
    <PolicyView
      policy={terms({
        siteName: site.name,
        siteUrl: site.origin,
        grievanceName: env.GRIEVANCE_NAME,
        grievanceEmail: env.GRIEVANCE_EMAIL,
      })}
    />
  );
}

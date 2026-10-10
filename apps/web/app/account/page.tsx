import type { Metadata } from 'next';
import { AccountView } from '@/components/account/account-view';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: t('account.title'), robots: { index: false } };

// Static shell; the view loads the visitor's own data from /api/me (tasks/M5b-accounts.md decision 1).
export default function AccountPage() {
  return <AccountView />;
}

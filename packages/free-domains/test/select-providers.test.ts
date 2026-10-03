// Spec 007 tech §11 `select-providers.test.ts` (FR-FREE-002): eligibility matching per profile.
import { describe, expect, it } from 'vitest';
import { selectProviders } from '../src/providers';

const ids = (siteType: string, flagsOn: string[], sensitive = false) =>
  selectProviders({ siteType, flagsOn, sensitive }).map((p) => p.id);

describe('provider selection', () => {
  it('offers developer services to developer portfolios', () => {
    const dev = ids('portfolio', ['feat_developer', 'feat_portfolio']);
    expect(dev).toContain('is-a-dev');
    expect(dev).not.toContain('js-org'); // js.org needs an open-source JavaScript project
    expect(ids('docs_open_source', ['feat_developer', 'feat_docs'])).toContain('js-org');
  });

  it('gives a bakery shop only open registries and hosting addresses', () => {
    const shop = ids('online_store', ['feat_sells_physical', 'feat_food']);
    expect(shop).not.toContain('is-a-dev');
    expect(shop).toEqual(expect.arrayContaining(['eu-org', 'cf-pages', 'vercel-app']));
  });

  it('keeps developer services away from businesses and gives sensitive sites nothing', () => {
    expect(ids('saas_web_app', ['feat_developer', 'feat_subscription'])).not.toContain('is-a-dev');
    expect(ids('blog', [], true)).toEqual([]);
  });
});

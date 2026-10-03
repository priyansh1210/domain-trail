// Spec 003 tech §11 `features-rules.test.ts` (FR-FEAT-014, NFR-FEAT-006): the rule-based fallback reaches at
// least 60 % site-type accuracy on 30 sample descriptions.
import { describe, expect, it } from 'vitest';
import { detectByRules } from '../src/features/rules';

const top = (d: Record<string, number>) => Object.entries(d).sort((a, b) => b[1] - a[1])[0]![0];

const SAMPLES: Array<[string, string]> = [
  ['Online store selling handmade candles and soaps, shipped across the country', 'online_store'],
  ['Neighborhood bakery and cafe with fresh bread, coffee and cakes', 'restaurant_cafe'],
  ['Software platform that automates invoicing workflows for small teams', 'saas_web_app'],
  ['Mobile app for tracking water intake, available on Android and iOS', 'mobile_app'],
  ['My personal blog where I write about books and travel', 'blog'],
  ['Daily news magazine covering politics and business headlines', 'news_media'],
  ['Portfolio for a freelance illustrator showing recent projects', 'portfolio'],
  ['Online resume and CV of a data engineer', 'personal_site'],
  ['Digital marketing agency helping clients with SEO and ads', 'agency_services'],
  ['Pizza restaurant with an online menu and table bookings', 'restaurant_cafe'],
  ['Charity that rescues stray dogs and asks for donations and volunteers', 'nonprofit'],
  ['Online courses and live lessons teaching guitar to beginners', 'education_courses'],
  ['Community forum where gardeners share tips and discussion threads', 'community_forum'],
  ['Marketplace connecting local farmers with buyers', 'marketplace'],
  ['Directory of vegan restaurants with reviews and ratings', 'directory_listings'],
  ['Annual tech conference with speakers, workshops and tickets', 'event'],
  ['Startup landing page for a new note-taking product with a waitlist', 'startup_landing'],
  ['Documentation site for an open source JavaScript library on GitHub', 'docs_open_source'],
  ['Weekly podcast episodes about history and science', 'podcast_video'],
  ['Salon booking site where clients reserve appointment slots', 'booking_service'],
  ['Apartments and houses for rent in the city, listed by a realtor', 'real_estate'],
  ['Dental clinic with experienced dentists and online patient forms', 'healthcare_practice'],
  ['Law firm offering legal advice by experienced lawyers', 'professional_practice'],
  ['Job board for remote developers, hiring updated daily', 'job_board'],
  ['Browser game where players build and battle castles', 'game'],
  ['Shop selling organic tea and spices online with fast shipping', 'online_store'],
  ['YouTube channel with cooking videos and recipes', 'podcast_video'],
  ['Freelance consultancy offering cloud migration services to clients', 'agency_services'],
  ['Yoga studio class schedule with booking and memberships', 'booking_service'],
  ['Tutoring for high school students in maths and physics', 'education_courses'],
];

describe('rule-based feature detection', () => {
  it('gets at least 60 % of site types right on 30 samples (NFR-FEAT-006)', () => {
    const correct = SAMPLES.filter(([d, expected]) => top(detectByRules(d).siteType) === expected).length;
    expect(correct / SAMPLES.length).toBeGreaterThanOrEqual(0.6);
  });

  it('finds the country when a place is named, and "global" otherwise', () => {
    expect(top(detectByRules('Bakery in Pune delivering bread').geo)).toBe('country_in');
    expect(top(detectByRules('Coffee roaster in Berlin and Munich').geo)).toBe('country_de');
    expect(top(detectByRules('A worldwide community for chess fans').geo)).toBe('global');
    expect(top(detectByRules('Recipes for home cooks').geo)).toBe('global');
  });

  it('detects the language from script or common words', () => {
    expect(top(detectByRules('पुणे में ताज़ी ब्रेड की बेकरी जो घर पर डिलीवरी करती है').language)).toBe('hi');
    expect(
      top(detectByRules('Una tienda online para vender pan y pasteles con entrega a domicilio').language),
    ).toBe('es');
    expect(top(detectByRules('Online bakery for sourdough bread and cakes').language)).toBe('en');
  });

  it('turns flags on from keywords and marks short text as vague', () => {
    const r = detectByRules('Online store selling handmade jewelry with worldwide shipping');
    expect(r.flags.feat_sells_physical).toBe(0.7);
    expect(r.flags.feat_crypto).toBe(0.1);
    expect(detectByRules('my website').clarity).toBeLessThan(1);
    expect(
      detectByRules('Online store selling handmade jewelry with worldwide shipping').clarity,
    ).toBeGreaterThanOrEqual(1);
  });

  it('falls back to "other" when signals tie or are missing', () => {
    expect(detectByRules('zxqv plorb wint').siteType).toEqual({ other: 1 });
    expect(detectByRules('zxqv plorb wint').industry).toEqual({ other__other: 1 });
  });

  it('notices gambling and adult wording (sensitive categories)', () => {
    expect(detectByRules('Online casino with poker and sports betting').gambling).toBe(true);
    expect(
      detectByRules('Adult content site for verified users over 18').safety.adult,
    ).toBeGreaterThanOrEqual(0.7);
  });
});

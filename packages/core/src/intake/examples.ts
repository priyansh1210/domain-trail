// Example descriptions for the home page chips (FR-INT-003). Globally neutral by owner decision (2026-10-03):
// no cities, currencies or country-specific wording. Each covers a different site type.

export interface Example {
  label: string;
  description: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    label: 'Neighborhood bakery',
    description:
      'Neighborhood bakery delivering sourdough bread, cakes and pastries, with online pre-orders.',
  },
  {
    label: 'Developer tool',
    description: 'Open-source tool that helps developers find and fix slow database queries in their apps.',
  },
  {
    label: 'Photography portfolio',
    description:
      'Portfolio for a freelance wedding and portrait photographer, with galleries and a booking form.',
  },
  {
    label: 'Language courses',
    description: 'Online Spanish lessons for beginners, with live classes, homework and a friendly tutor.',
  },
  {
    label: 'Animal rescue charity',
    description: 'Non-profit animal rescue that rehomes cats and dogs and accepts donations and volunteers.',
  },
  {
    label: 'Handmade jewelry store',
    description: 'Small online shop selling handmade silver jewelry and gifts, shipped worldwide.',
  },
  {
    label: 'Fitness app',
    description: 'Mobile app with short home workouts and a daily plan for busy people who want to get fit.',
  },
  {
    label: 'Tech news blog',
    description: 'Blog with weekly articles and reviews about gadgets, smartphones and consumer technology.',
  },
];

// Explicitly trusted script hosts travel with the template into new projects.
// Keep this in deployment-owned code: admin settings must not grant trust to JS.
export const TRUSTED_PLAUSIBLE_SCRIPT_HOSTS = [
  'plausible.io',
  'stats.cadcraft.org',
] as const;

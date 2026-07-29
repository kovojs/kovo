import { defineKovo } from '@kovojs/server';

/**
 * The release-authenticated CRM scaffold deliberately stays inside Kovo's production sound
 * subset. The repository's full PGlite demo remains an architecture reference; copied starters
 * begin with a buildable app and add a reviewed database provider when deployment is selected.
 */
export const app = defineKovo({
  appId: 'f331ff3a-8a70-4a3b-87fd-f5080ebeff5a',
  document: { lang: 'en-US' },
});

import { stylesheet } from '@kovojs/server';

import { chromeStyleCss } from './components/chrome.js';
import { docsLayoutStyleCss } from './components/docs-layout.js';
import { exampleSplitStyleCss } from './components/example-split.js';
import { galleryStyleCss } from './components/gallery.js';
import { landingStyleCss } from './components/landing.js';
import type { DocPage, NavLink } from './content.js';
import { searchDialogStyleCss } from './document-template.js';
import { siteThemeCss } from './theme.js';

// Shared route data helpers used by the authored docs app shell and content builders.

export const siteStylesheets = [
  stylesheet('./styles.css', {
    criticalCss: [
      siteThemeCss,
      chromeStyleCss,
      docsLayoutStyleCss,
      exampleSplitStyleCss,
      galleryStyleCss,
      landingStyleCss,
      searchDialogStyleCss,
    ],
    href: '/assets/site.css',
  }),
] as const;

/** Route paths drop the trailing slash (normalizePathname is canonical, SPEC
 * §6.3); content URLs keep it and static export writes `<path>/index.html`. */
export function routePath(url: string): string {
  return url.replace(/\/+$/, '') || '/';
}

export function link(page: DocPage | undefined): NavLink | undefined {
  return page ? { title: page.title, url: page.url } : undefined;
}

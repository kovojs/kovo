import { renderSectionIndex } from './components/docs-layout.js';
import type { NavGroup } from './content.js';
import { docRoute, type AnyRoute } from './route-kit.js';

// Gallery section: rendered component fixtures + compiled interactive demos.
//
// CONTRACT (owned by this module): build the gallery routes — the /gallery/
// index plus one /gallery/components/<name>/ page per fixture — by SSR-loading
// examples/gallery/src fixtures, folding the compiled interactive demo into each
// component page, and registering the interactive demos' client modules into the
// passed registry (so the export replay serves them; SPEC §4.4 — no load-bearing
// import maps, rewrite bare specifiers to versioned /c/ URLs). See the previous
// build for the reference logic: scripts/build.mjs (loadGalleryData,
// renderGalleryPage) and scripts/app-shell.mjs (gallery client-module registration).

export interface GalleryDeps {
  // The same registry passed to createApp(); register interactive demo modules here.
  clientModules: { put(input: { path: string; source: string; version: string }): string };
  groups: NavGroup[];
}

export async function buildGalleryRoutes({ groups }: GalleryDeps): Promise<AnyRoute[]> {
  // TODO(gallery slice): replace with the full index + per-component pages.
  return [
    docRoute(
      '/gallery/',
      {
        description: 'Kovo component gallery — rendered headless and styled component fixtures.',
        title: 'Gallery · Kovo',
      },
      {
        activePath: '/gallery/',
        contentHtml: renderSectionIndex({ key: 'gallery', pages: [], title: 'Gallery' }),
        groups,
        prose: false,
      },
    ),
  ];
}

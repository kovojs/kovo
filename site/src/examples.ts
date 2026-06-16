import { renderSectionIndex } from './components/docs-layout.js';
import type { NavGroup } from './content.js';
import { docRoute, type AnyRoute } from './route-kit.js';

// Examples section: runnable Kovo apps embedded beside their authored source.
//
// CONTRACT (owned by this module):
//  - buildExampleRoutes: the /examples/ index plus one /examples/<name>/ split
//    page per example (a sandboxed iframe of the app + a CSS-only tabbed source
//    viewer of the authored TSX). See scripts/examples.mjs (renderExampleSplit,
//    loadExampleSources, EXAMPLES) and scripts/build.mjs (examples loop) for the
//    reference logic.
//  - exportExampleApps: a build-time hook (called by scripts/export-static.mjs
//    after the main replay) that statically exports each example app into
//    <outDir>/examples/<name>/app/ with refs re-rooted, so the iframes resolve
//    on a static host (SPEC §9.5).

export interface ExampleDeps {
  groups: NavGroup[];
}

export async function buildExampleRoutes({ groups }: ExampleDeps): Promise<AnyRoute[]> {
  // TODO(examples slice): replace with the full index + per-example split pages.
  return [
    docRoute(
      '/examples/',
      {
        description: 'Runnable Kovo example apps, embedded beside their source.',
        title: 'Examples · Kovo',
      },
      {
        activePath: '/examples/',
        contentHtml: renderSectionIndex({ key: 'examples', pages: [], title: 'Examples' }),
        groups,
        prose: false,
      },
    ),
  ];
}

/** Build-time hook: statically export each example app under <outDir>/examples/
 * <name>/app/. No-op until the examples slice lands. */
export async function exportExampleApps(_outDir: string): Promise<void> {
  // TODO(examples slice): port scripts/examples.mjs buildExampleEmbed + re-rooting.
}

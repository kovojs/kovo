import { fileURLToPath } from 'node:url';

import { clientHrefs } from './client/modules.js';
import { renderSectionIndex } from './components/docs-layout.js';
import { renderExampleSplit } from './components/example-split.js';
import type { NavGroup } from './content.js';
import { docRoute, type AnyRoute } from './route-kit.js';

// Site-local example-embed build tooling (no type declarations); reused so the
// heavy build/re-root logic lives in one place and the docs app only authors the
// presentation. See scripts/examples.mjs for the full contract.
import {
  EXAMPLES,
  buildExampleEmbed,
  exampleLiveAppHref,
  examplePagePath,
  loadExampleSources,
} from '../scripts/examples.mjs';
import { renderMarkdown } from '../scripts/md.mjs';

// Examples section: runnable Kovo apps embedded beside their authored source.
//
// CONTRACT (owned by this module):
//  - buildExampleRoutes: the /examples/ index plus one /examples/<name>/ split
//    page per example (a sandboxed iframe when the app is static-exportable or a
//    live service URL is configured + a CSS-only tabbed source viewer of the
//    authored TSX). See scripts/examples.mjs for the manifest contract.
//  - exportExampleApps: a build-time hook (called by scripts/export-static.mjs
//    after the main replay) that statically exports only L0/L1-safe examples
//    into <outDir>/examples/<name>/app/ with refs re-rooted (SPEC §9.5). Dynamic
//    PGlite mutation demos render iframes from configured service URLs.

interface ExampleManifest {
  blurb: string;
  dir: string;
  embed: 'static' | 'service';
  name: string;
  serviceUrl?: string;
  serviceUrlEnv?: string;
  sources: string[];
  title: string;
}

interface ExampleSource {
  code: string;
  name: string;
}

const examples = EXAMPLES as ExampleManifest[];

// scripts/examples.mjs lives at site/scripts/; the repo root is two levels up.
// (build.mjs computes the same repoRootPath this way for the embed/source loaders.)
const repoRootPath = fileURLToPath(new URL('../../', import.meta.url));

const copyHref = `${clientHrefs.code}#copy`;

export interface ExampleDeps {
  groups: NavGroup[];
}

export async function buildExampleRoutes({ groups }: ExampleDeps): Promise<AnyRoute[]> {
  const routes: AnyRoute[] = [];

  // /examples/ index: a card grid of every example with its blurb.
  routes.push(
    docRoute(
      '/examples/',
      {
        description: 'Runnable Kovo example apps, embedded beside their source.',
        title: 'Examples · Kovo',
      },
      {
        activePath: '/examples/',
        contentHtml: renderSectionIndex({
          key: 'examples',
          pages: examples.map((example) => ({
            description: example.blurb,
            title: example.title,
            url: examplePagePath(example.name),
          })),
          title: 'Examples',
        }),
        groups,
        prose: false,
      },
    ),
  );

  // One split page per example. Source files are highlighted through the shared
  // markdown/Shiki pipeline (matching the previous build), with copy buttons
  // wired to the versioned code module. Static examples are exported separately
  // by exportExampleApps; dynamic examples use a service URL only when configured.
  for (const example of examples) {
    const pagePath = examplePagePath(example.name);
    const sources = (await loadExampleSources(example, { repoRootPath })) as ExampleSource[];
    const files = [];
    for (const file of sources) {
      const lang = file.name.endsWith('.tsx') ? 'tsx' : 'ts';
      const { html } = (await renderMarkdown(
        `\`\`\`${lang} title="${example.dir}/${file.name}"\n${file.code}\n\`\`\``,
        { copyHref },
      )) as { html: string };
      files.push({ html, name: file.name });
    }

    const contentHtml = renderExampleSplit({
      appHref: exampleLiveAppHref(example),
      blurb: example.blurb,
      files,
      idBase: `${example.name}-src`,
      title: example.title,
    });

    routes.push(
      docRoute(
        pagePath,
        {
          description: example.blurb,
          title: `${example.title} · Examples · Kovo`,
        },
        {
          activePath: pagePath,
          contentHtml,
          groups,
          prose: false,
        },
      ),
    );
  }

  return routes;
}

/** Build-time hook: statically export each L0/L1-safe example app under
 * <outDir>/examples/<name>/app/, re-rooting its absolute refs so the iframes
 * resolve from a subdirectory on a static host (SPEC §9.5). Dynamic examples
 * with server mutation forms are served by separately deployed demo services. */
export async function exportExampleApps(outDir: string): Promise<void> {
  for (const example of examples) {
    if (example.embed !== 'static') continue;
    await buildExampleEmbed(example, { outDir, repoRootPath });
  }
}

// Thin consumer of @kovojs/devtool. It wires three sibling example apps' own
// committed graphs into the reusable devtool; all the logic (graph derivation,
// rendering, MCP, mount) lives in the package. This is what any host does to
// inspect its own app — read its graph.json, hand it to createDevtoolApp.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildBundle } from '@kovojs/devtool';
import { createDevtoolApp } from '@kovojs/devtool/app';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(HERE, '..', '..');

const APPS = [
  { app: 'commerce', label: 'Commerce', blurb: 'cart · products · orders' },
  { app: 'crm', label: 'CRM', blurb: 'contacts · deals · pipeline' },
  { app: 'stackoverflow', label: 'Stack Overflow', blurb: 'questions · answers · votes' },
];

const bundles = APPS.flatMap((a) => {
  const graphPath = join(EXAMPLES, a.app, 'src', 'generated', 'graph.json');
  if (!existsSync(graphPath)) return [];
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  return [
    buildBundle({
      app: a.app,
      label: a.label,
      blurb: a.blurb,
      graph,
      srcRoot: join(EXAMPLES, a.app, 'src'),
    }),
  ];
});

const devtool = createDevtoolApp({ bundles });

export const app = devtool.app;
export const requestHandler = devtool.requestHandler;
export const nodeHandler = devtool.nodeHandler;
export default app;

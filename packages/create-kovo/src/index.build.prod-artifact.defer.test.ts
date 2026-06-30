import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject } from './index.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import { buildProductionArtifact } from './index.build.test-support.js';

describe('create-kovo starter (build integration: production Defer artifacts)', () => {
  it('streams nested Defer regions discovered after an async outer region settles', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-nested-defer-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Prod Nested Defer Proof' });
      linkStarterBuildDependencies(root);
      addNestedDeferRoute(root);

      buildProductionArtifact(root);

      server = spawn(process.execPath, ['dist/server/server.mjs'], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: {
          ...withRepoBinOnPath(),
          HOST: '127.0.0.1',
          NODE_ENV: 'production',
          PORT: String(port),
        },
      });
      const output = collectOutput(server);
      const origin = `http://127.0.0.1:${port}`;

      const body = await fetchTextWhenReady(`${origin}/probe/nested-defer`, output);
      expect(body).toContain(
        '<kovo-defer target="outer-region" state="pending" data-kovo-region-priority="after-paint"><section>Loading outer</section></kovo-defer>',
      );
      expect(body).toContain('<kovo-fragment target="outer-region" priority="normal">');
      expect(body).toContain('<h1>Outer done</h1>');
      expect(body).toContain(
        '<kovo-defer target="inner-region" state="pending" data-kovo-region-priority="after-paint"><p>Loading inner</p></kovo-defer>',
      );
      expect(body).toContain('<kovo-fragment target="inner-region" priority="normal">');
      expect(body).toContain('<p>Inner done</p>');
      expect(body.indexOf('<kovo-fragment target="outer-region"')).toBeLessThan(
        body.indexOf('<kovo-fragment target="inner-region"'),
      );
      expect(
        body
          .trim()
          .endsWith(
            '<kovo-defer target="inner-region" state="pending" data-kovo-region-priority="after-paint"><p>Loading inner</p></kovo-defer>',
          ),
      ).toBe(false);
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

function addNestedDeferRoute(root: string): void {
  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace('  createRequestHandler,', ['  createRequestHandler,', '  Defer,'].join('\n'))
    .replace(
      "  routes: [\n    route('/', {",
      [
        '  routes: [',
        "    route('/probe/nested-defer', {",
        "      access: publicAccess('public nested Defer production artifact proof'),",
        "      meta: { title: 'Nested Defer proof' },",
        '      layout: AppLayout,',
        '      stylesheets,',
        '      async page() {',
        '        return (',
        '          <main>',
        '            <Defer',
        '            fallback={<section>Loading outer</section>}',
        '            priority="after-paint"',
        '            render={async () => {',
        '              await new Promise((resolve) => setTimeout(resolve, 30));',
        '              return (',
        '                <section>',
        '                  <h1>Outer done</h1>',
        '                  <Defer',
        '                    fallback={<p>Loading inner</p>}',
        '                    priority="after-paint"',
        '                    render={async () => {',
        '                      await new Promise((resolve) => setTimeout(resolve, 30));',
        '                      return <p>Inner done</p>;',
        '                    }}',
        '                    target="inner-region"',
        '                  />',
        '                </section>',
        '              );',
        '            }}',
        '            target="outer-region"',
        '            />',
        '          </main>',
        '        );',
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

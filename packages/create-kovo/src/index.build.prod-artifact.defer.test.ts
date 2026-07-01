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
  it('streams nested Defer regions and isolates throwing regions in production artifacts', async () => {
    const tempParent = tmpdir();
    mkdirSync(tempParent, { recursive: true });
    const root = mkdtempSync(join(tempParent, 'create-kovo-prod-nested-defer-'));
    const port = await reservePort();
    let server: ChildProcessWithoutNullStreams | undefined;

    try {
      writeKovoProject(root, { dialect: 'sqlite', name: 'Prod Nested Defer Proof' });
      linkStarterBuildDependencies(root);
      addDeferProofRoutes(root);

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

      const errorBody = await fetchTextWhenReady(`${origin}/probe/defer-error`, output);
      expect(errorBody).toContain(
        '<kovo-defer target="unsafe-region" state="pending" data-kovo-region-priority="after-paint"><section>Loading &lt;img src=x onerror=alert(1)&gt;</section></kovo-defer>',
      );
      expect(errorBody).toContain(
        '<kovo-defer target="unsafe-region" state="error" data-kovo-region-priority="after-paint"><section>Loading &lt;img src=x onerror=alert(1)&gt;</section></kovo-defer>',
      );
      expect(errorBody).toContain('<kovo-fragment target="safe-sibling" priority="normal">');
      expect(errorBody).toContain('&lt;strong&gt;raw sibling&lt;/strong&gt;');
      expect(errorBody).not.toContain('<img src=x onerror=alert(1)>');
      expect(errorBody).not.toContain('<strong>raw sibling</strong>');
      expect(errorBody).not.toContain('private deferred detail');

      const shellPayload = encodeURIComponent('<img src=x onerror=alert(1)>');
      const shellResponse = await fetch(`${origin}/probe/error-shell?payload=${shellPayload}`);
      const shellBody = await shellResponse.text();
      expect(shellResponse.status, shellBody).toBe(500);
      expect(shellBody).toContain(
        '&lt;main data-shell="500"&gt;&lt;img src=x onerror=alert(1)&gt; Set-Cookie: session=evil&lt;/main&gt;',
      );
      expect(shellBody).not.toContain('<main data-shell="500">');
      expect(shellBody).not.toContain('<img src=x onerror=alert(1)>');
      expect(shellBody).not.toContain('private route detail');
    } finally {
      await stopProcess(server);
      rmSync(root, { force: true, recursive: true });
    }
  }, 120_000);
});

function addDeferProofRoutes(root: string): void {
  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace('  createRequestHandler,', ['  createRequestHandler,', '  Defer,'].join('\n'))
    .replace(
      '  endpoints: [healthEndpoint],',
      [
        '  endpoints: [healthEndpoint],',
        '  errorShells: {',
        '    serverError({ request, status }) {',
        '      const payload = new URL(request.url).searchParams.get("payload") ?? "";',
        '      return {',
        '        body: `<main data-shell="${status}">${payload} Set-Cookie: session=evil</main>`,',
        '        headers: { "Content-Type": "text/html; charset=utf-8" },',
        '        status,',
        '      };',
        '    },',
        '  },',
      ].join('\n'),
    )
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
        "    route('/probe/defer-error', {",
        "      access: publicAccess('public Defer error production artifact proof'),",
        "      meta: { title: 'Defer error proof' },",
        '      layout: AppLayout,',
        '      stylesheets,',
        '      async page() {',
        "        const unsafe = '<img src=x onerror=alert(1)>';",
        '        return (',
        '          <main>',
        '            <Defer',
        '              fallback={<section>Loading {unsafe}</section>}',
        '              priority="after-paint"',
        '              render={async () => {',
        '                await new Promise((resolve) => setTimeout(resolve, 30));',
        '                throw new Error(`private deferred detail ${unsafe}`);',
        '              }}',
        '              target="unsafe-region"',
        '            />',
        '            <Defer',
        '              fallback={<p>Loading sibling</p>}',
        '              priority="after-paint"',
        "              render={async () => '<strong>raw sibling</strong>'}",
        '              target="safe-sibling"',
        '            />',
        '          </main>',
        '        );',
        '      },',
        '    }),',
        "    route('/probe/error-shell', {",
        "      access: publicAccess('public error shell production artifact proof'),",
        '      layout: AppLayout,',
        '      page() {',
        "        throw new Error('private route detail <script>boom</script>');",
        '      },',
        '    }),',
        "    route('/', {",
      ].join('\n'),
    );
  writeFileSync(appPath, app, 'utf8');
}

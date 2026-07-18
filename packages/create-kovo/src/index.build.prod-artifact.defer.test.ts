import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeKovoProject, type CreateKovoDialect } from './index.js';
import {
  collectOutput,
  fetchTextWhenReady,
  linkStarterBuildDependencies,
  reservePort,
  stopProcess,
  withRepoBinOnPath,
} from './index.test-support.js';
import { buildReusableProductionArtifact } from './index.build.test-support.js';
import { assertProdArtifactSinkCensus } from './index.build.prod-artifact.sink-census.js';

describe('create-kovo starter (build integration: production Defer artifacts)', () => {
  it.each([
    ['default', undefined],
    ['SQLite', 'sqlite' as const],
  ] satisfies readonly [string, CreateKovoDialect | undefined][])(
    'streams nested Defer regions and isolates throwing regions in %s production artifacts',
    async (_label, dialect) => {
      const tempParent = tmpdir();
      mkdirSync(tempParent, { recursive: true });
      const root = mkdtempSync(join(tempParent, 'create-kovo-prod-nested-defer-'));
      const port = await reservePort();
      let server: ChildProcessWithoutNullStreams | undefined;

      try {
        writeKovoProject(root, {
          ...(dialect === undefined ? {} : { dialect }),
          name: 'Prod Nested Defer Proof',
        });
        linkStarterBuildDependencies(root);
        addDeferProofRoutes(root);

        buildReusableProductionArtifact(root);
        const census = assertProdArtifactSinkCensus(root, [
          {
            proof: {
              evidence:
                'packages/create-kovo/src/index.build.prod-artifact.defer.test.ts streams shell before slow regions and observes per-region fallback chunks',
              kind: 'proof',
            },
            sink: 'streaming/<Defer> chunks',
            witnesses: [
              '<kovo-defer',
              'renderDeferredStreamingResponse',
              'data-kovo-region-priority',
              'outer-region',
              'unsafe-region',
            ],
          },
          {
            proof: {
              evidence:
                'packages/create-kovo/src/index.build.prod-artifact.defer.test.ts observes sanitized 500 shell output from the production server artifact',
              kind: 'proof',
            },
            sink: 'error shells / 500 bodies',
            witnesses: ['errorShells', 'serverError', 'Set-Cookie: session=evil'],
          },
        ]);
        expect(census.entries).toHaveLength(2);

        server = spawn(process.execPath, ['dist/server/server.mjs'], {
          cwd: root,
          detached: process.platform !== 'win32',
          env: {
            ...withRepoBinOnPath(),
            BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
            HOST: '127.0.0.1',
            NODE_ENV: 'test',
            PORT: String(port),
          },
        });
        const output = collectOutput(server);
        const origin = `http://127.0.0.1:${port}`;

        await fetchTextWhenReady(`${origin}/probe/nested-defer`, output);
        const streamed = await fetch(`${origin}/probe/nested-defer`);
        const {
          firstChunk,
          firstChunkElapsedMs,
          text: body,
        } = await readTextStreamWithFirstChunk(streamed);
        expect(streamed.status, body).toBe(200);
        expect(firstChunkElapsedMs).toBeLessThan(500);
        expect(firstChunk).toContain(
          '<kovo-defer target="outer-region" state="pending" data-kovo-region-priority="after-paint"><section>Loading outer</section></kovo-defer>',
        );
        expect(firstChunk).not.toContain('<h1>Outer done</h1>');
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

        const errorResponse = await fetch(`${origin}/probe/defer-error`);
        const { firstChunk: errorFirstChunk, text: errorBody } =
          await readTextStreamWithFirstChunk(errorResponse);
        expect(errorResponse.status, errorBody).toBe(200);
        expect(errorFirstChunk).toContain(
          '<kovo-defer target="unsafe-region" state="pending" data-kovo-region-priority="after-paint"><section>Loading &lt;img src=x onerror=alert(1)&gt;</section></kovo-defer>',
        );
        expect(errorFirstChunk).toContain(
          '<kovo-defer target="safe-sibling" state="pending" data-kovo-region-priority="after-paint"><p>Loading sibling</p></kovo-defer>',
        );
        expect(errorFirstChunk).not.toContain('private deferred detail');
        expect(errorFirstChunk).not.toContain('<strong>raw sibling</strong>');
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
          '&lt;main data-shell="500"&gt; Set-Cookie: session=evil&lt;/main&gt;',
        );
        expect(shellBody).not.toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(shellBody).not.toContain('<main data-shell="500">');
        expect(shellBody).not.toContain('<img src=x onerror=alert(1)>');
        expect(shellBody).not.toContain('private route detail');
      } finally {
        await stopProcess(server);
        rmSync(root, { force: true, recursive: true });
      }
    },
    240_000,
  );
});

async function readTextStreamWithFirstChunk(
  response: Response,
): Promise<{ firstChunk: string; firstChunkElapsedMs: number; text: string }> {
  if (!response.body) throw new Error('Expected a streamed response body.');
  const reader = response.body.getReader();
  const startedAt = performance.now();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let firstChunk = '';

  // Fetch/Undici may split one server-enqueued shell across arbitrary transport chunks. The
  // contract is that a complete pending Defer shell arrives before slow region work, not that it
  // coincides with the first reader.read() boundary. Accumulate only until the first pending
  // marker closes, under the same 500 ms budget, then continue reading the resolved stream.
  while (!firstChunk.includes('</kovo-defer>')) {
    const remainingMs = 500 - (performance.now() - startedAt);
    if (remainingMs <= 0) {
      throw new Error('Timed out waiting for initial Defer shell chunk.');
    }
    const next = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error('Timed out waiting for initial Defer shell chunk.')),
          remainingMs,
        ),
      ),
    ]);
    if (next.done) throw new Error('Expected initial Defer shell chunk before stream close.');
    const decoded = decoder.decode(next.value, { stream: true });
    chunks.push(decoded);
    firstChunk += decoded;
  }
  const firstChunkElapsedMs = performance.now() - startedAt;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(decoder.decode(next.value, { stream: true }));
  }
  const tail = decoder.decode();
  if (tail) chunks.push(tail);
  return { firstChunk, firstChunkElapsedMs, text: chunks.join('') };
}

function addDeferProofRoutes(root: string): void {
  const appPath = join(root, 'src/app.tsx');
  const app = readFileSync(appPath, 'utf8')
    .replace('  createApp,', ['  createApp,', '  Defer,'].join('\n'))
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
        '              await new Promise((resolve) => setTimeout(resolve, 1000));',
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

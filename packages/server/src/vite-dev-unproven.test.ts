// plans/good-perf.md O5/D5-d (SPEC.md §9.5.1): the dev server serves edits before whole-project
// analysis completes. That split is safe because (a) every dev response is explicitly marked
// dev-unproven, (b) the async pass converges the compiler's fact snapshot and publishes a reload
// when facts actually changed, and (c) `kovo check`/`kovo build` remain fail-closed and derive
// facts synchronously (pinned by vite.test.ts "revokes empty-fact adoption when build inputs
// later derive imported mutation facts" and the vite-data-plane-gate build suite).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { kovo } from './vite.js';

type DevMiddleware = (
  request: unknown,
  response: {
    setHeader(name: string, value: string): void;
  },
  next: (error?: unknown) => void,
) => void;

interface DevPlugin {
  configResolved(config: {
    command?: 'build' | 'serve';
    plugins?: readonly unknown[];
    root: string;
  }): void | Promise<void>;
  configureServer(server: MockDevServer): void | Promise<void>;
  handleHotUpdate(context: {
    file: string;
    modules?: readonly unknown[];
    read(): Promise<string>;
    server: MockDevServer;
  }): Promise<readonly unknown[] | undefined>;
}

interface MockDevServer {
  config?: { root?: string };
  middlewares: { use(handler: DevMiddleware): void };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
  ws?: { send(payload: { type: string }): void };
}

const importedMutationSource = `
import { mutation, s } from '@kovojs/server';

export const saveContact = mutation({
  input: s.object({ name: s.string() }),
  handler(input) { return input; },
});
`;

const importedMutationFormSource = `
import { component } from '@kovojs/core';
import { saveContact } from '../mutations.js';

export const ContactForm = component({
  mutations: { saveContact },
  render: () => <form mutation={saveContact}><input name="name" /></form>,
});
`;

function mockDevServer(
  root: string,
  middlewares: DevMiddleware[],
  wsPayloads: { type: string }[],
): MockDevServer {
  return {
    config: { root },
    middlewares: {
      use(handler) {
        middlewares.push(handler);
      },
    },
    async ssrLoadModule(id) {
      if (id === '@kovojs/server/internal/app-shell-vite') {
        return {
          createKovoAppShellViteDevIntegration() {
            return {
              onModuleDiagnostics() {},
              plugin: { configureServer() {} },
            };
          },
        };
      }
      throw new Error(`unexpected ssrLoadModule(${id})`);
    },
    ws: {
      send(payload) {
        wsPayloads.push(payload);
      },
    },
  };
}

describe('kovo dev D5-d posture split (SPEC.md §9.5.1)', () => {
  it('marks every dev response dev-unproven', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-dev-unproven-header-'));
    try {
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src/app-shell.ts'), 'export default {};\n', 'utf8');
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as DevPlugin;
      await plugin.configResolved({ command: 'serve', root });
      const middlewares: DevMiddleware[] = [];
      await plugin.configureServer(mockDevServer(root, middlewares, []));

      const headers = new Map<string, string>();
      let nextCalls = 0;
      for (const middleware of middlewares) {
        middleware(
          {},
          {
            setHeader(name: string, value: string) {
              headers.set(name.toLowerCase(), value);
            },
          },
          () => {
            nextCalls += 1;
          },
        );
      }
      expect(headers.get('kovo-dev-posture')).toBe('dev-unproven');
      expect(nextCalls).toBe(middlewares.length);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('stages a data-plane HMR edit without blocking on whole-project facts, then converges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-dev-unproven-hmr-'));
    try {
      // Boot with an empty project: the committed fact snapshot is empty.
      await mkdir(join(root, 'src'), { recursive: true });
      await writeFile(join(root, 'src/app-shell.ts'), 'export default {};\n', 'utf8');
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as DevPlugin;
      await plugin.configResolved({ command: 'serve', root });
      const wsPayloads: { type: string }[] = [];
      const server = mockDevServer(root, [], wsPayloads);
      await plugin.configureServer(server);

      // The edit introduces an imported mutation binding — a real fact change.
      await mkdir(join(root, 'src/components'), { recursive: true });
      await writeFile(join(root, 'src/mutations.ts'), importedMutationSource, 'utf8');
      await writeFile(
        join(root, 'src/components/contact-form.tsx'),
        importedMutationFormSource,
        'utf8',
      );

      // D5-d: the hot update itself resolves without deriving whole-project facts inline; the
      // compiler may publish its ordinary HMR events for the staged module during the update.
      await plugin.handleHotUpdate({
        file: join(root, 'src/components/contact-form.tsx'),
        modules: [],
        read: async () => importedMutationFormSource,
        server,
      });
      const reloadsAfterHotUpdate = wsPayloads.filter(
        (payload) => payload.type === 'full-reload',
      ).length;

      // The debounced whole-project pass commits the changed facts (empty → one imported
      // mutation binding) and publishes an ADDITIONAL convergence full reload.
      const deadline = Date.now() + 25_000;
      const convergenceReloads = (): number =>
        wsPayloads.filter((payload) => payload.type === 'full-reload').length -
        reloadsAfterHotUpdate;
      while (Date.now() < deadline && convergenceReloads() === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(convergenceReloads(), `ws payloads: ${JSON.stringify(wsPayloads)}`).toBeGreaterThan(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('does not publish a convergence reload when facts are unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kovo-dev-unproven-stable-'));
    try {
      await mkdir(join(root, 'src/components'), { recursive: true });
      await writeFile(join(root, 'src/app-shell.ts'), 'export default {};\n', 'utf8');
      await writeFile(join(root, 'src/mutations.ts'), importedMutationSource, 'utf8');
      await writeFile(
        join(root, 'src/components/contact-form.tsx'),
        importedMutationFormSource,
        'utf8',
      );
      const plugin = kovo({ app: '/src/app-shell.ts' }) as unknown as DevPlugin;
      // Facts are committed at boot; a content edit that keeps the same facts must not reload.
      await plugin.configResolved({ command: 'serve', root });
      const wsPayloads: { type: string }[] = [];
      const server = mockDevServer(root, [], wsPayloads);
      await plugin.configureServer(server);

      const edited = `${importedMutationFormSource}// comment-only edit\n`;
      await writeFile(join(root, 'src/components/contact-form.tsx'), edited, 'utf8');
      await plugin.handleHotUpdate({
        file: join(root, 'src/components/contact-form.tsx'),
        modules: [],
        read: async () => edited,
        server,
      });
      // The compiler's own HMR classification may publish a reload during the update; only
      // reloads published AFTER the update would be D5-d convergence reloads.
      const reloadsAfterHotUpdate = wsPayloads.filter(
        (payload) => payload.type === 'full-reload',
      ).length;

      // Give the debounced pass time to run to completion (it re-analyses the project), then
      // assert no convergence reload was published for an unchanged fact snapshot.
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      expect(
        wsPayloads.filter((payload) => payload.type === 'full-reload').length,
        `ws payloads: ${JSON.stringify(wsPayloads)}`,
      ).toBe(reloadsAfterHotUpdate);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

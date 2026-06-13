import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { compileComponentModule } from '@jiso/compiler';
import { describe, expect, it, vi } from 'vitest';

import {
  compileComponentV1,
  fwAudit,
  fwCheck,
  fwExplain,
  handleFwMcpRequest,
  main,
  mainAsync,
  runMcpFallbackStdio,
  runMcpSdkServer,
} from './index.js';
import { availableAddComponents, vendoredUiComponents } from './add-catalog.js';

class MemoryMcpTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly sent: JSONRPCMessage[] = [];
  started = false;

  async close(): Promise<void> {
    this.onclose?.();
  }

  receive(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.sent.push(message);
  }

  async start(): Promise<void> {
    this.started = true;
  }
}

describe('fw add', () => {
  it('keeps the vendored UI catalog synchronized with @jiso/ui package source', () => {
    expect(availableAddComponents()).toBe(
      'alert, autocomplete, badge, breadcrumb, button, card, checkbox, checkbox-group, combobox, drawer, field, kbd, number-field, otp-field, radio-group, scroll-area, select, sheet, skeleton, slider, switch, table, tabs, toast, toggle, toggle-group, toolbar',
    );

    const manifest = JSON.parse(
      readFileSync(new URL('../../ui/package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, string>; jiso: { vendoredSource: boolean }; name: string };
    const cliManifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
    };
    const exportedComponents = Object.keys(manifest.exports)
      .filter((subpath) => subpath !== '.')
      .map((subpath) => subpath.slice(2))
      .sort();

    expect(cliManifest.dependencies['@jiso/ui']).toBe('workspace:*');
    expect(manifest.name).toBe('@jiso/ui');
    expect(manifest.jiso.vendoredSource).toBe(true);
    expect(Object.keys(vendoredUiComponents).sort()).toEqual(exportedComponents);

    for (const [name, entry] of Object.entries(vendoredUiComponents)) {
      expect(entry.fileName).toBe(`${name}.tsx`);
      expect(entry.source).toBe(
        readFileSync(new URL(`../../ui/src/${name}.tsx`, import.meta.url), 'utf8'),
      );
      expect(entry.source).toContain("import { component } from '@jiso/core';");
      expect(entry.source).toContain(`component('${name}'`);
      expect(entry.source).not.toContain('@jiso/ui');
      expect(entry.source).not.toContain('fw-c=');
      expect(entry.source).not.toContain('data-bind=');
    }
  });

  it('compiles vendored catalog entries as app-authored TSX without FW235', () => {
    for (const [name, entry] of Object.entries(vendoredUiComponents)) {
      const result = compileComponentModule({
        fileName: `src/components/ui/${entry.fileName}`,
        source: entry.source,
      });

      expect(result.diagnostics, name).not.toContainEqual(
        expect.objectContaining({ code: 'FW235' }),
      );
      expect(result.diagnostics, name).toEqual([]);
    }
  });

  it('vendors package-synchronized components as TSX app source', () => {
    const root = mkdtempSync(join(tmpdir(), 'fw-add-cli-'));
    const outDir = join(root, 'src/components/ui');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(
        main([
          'add',
          'alert',
          'autocomplete',
          'badge',
          'breadcrumb',
          'button',
          'card',
          'checkbox',
          'checkbox-group',
          'combobox',
          'kbd',
          'radio-group',
          'select',
          'sheet',
          'skeleton',
          'slider',
          'switch',
          'table',
          'toggle',
          'toggle-group',
          'toast',
          'toolbar',
          '--out',
          outDir,
        ]),
      ).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('fw-add/v1\n');
      expect(output).toContain(
        `ADD alert path=${JSON.stringify(join(outDir, 'alert.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD autocomplete path=${JSON.stringify(join(outDir, 'autocomplete.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD badge path=${JSON.stringify(join(outDir, 'badge.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD breadcrumb path=${JSON.stringify(join(outDir, 'breadcrumb.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD button path=${JSON.stringify(join(outDir, 'button.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD card path=${JSON.stringify(join(outDir, 'card.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD checkbox path=${JSON.stringify(join(outDir, 'checkbox.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD checkbox-group path=${JSON.stringify(join(outDir, 'checkbox-group.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD combobox path=${JSON.stringify(join(outDir, 'combobox.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD kbd path=${JSON.stringify(join(outDir, 'kbd.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD radio-group path=${JSON.stringify(join(outDir, 'radio-group.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD select path=${JSON.stringify(join(outDir, 'select.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD sheet path=${JSON.stringify(join(outDir, 'sheet.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD skeleton path=${JSON.stringify(join(outDir, 'skeleton.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD slider path=${JSON.stringify(join(outDir, 'slider.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD switch path=${JSON.stringify(join(outDir, 'switch.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD table path=${JSON.stringify(join(outDir, 'table.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD toggle path=${JSON.stringify(join(outDir, 'toggle.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD toggle-group path=${JSON.stringify(join(outDir, 'toggle-group.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD toast path=${JSON.stringify(join(outDir, 'toast.tsx'))} source=tsx`,
      );
      expect(output).toContain(
        `ADD toolbar path=${JSON.stringify(join(outDir, 'toolbar.tsx'))} source=tsx`,
      );

      const alert = readFileSync(join(outDir, 'alert.tsx'), 'utf8');
      const autocomplete = readFileSync(join(outDir, 'autocomplete.tsx'), 'utf8');
      const badge = readFileSync(join(outDir, 'badge.tsx'), 'utf8');
      const breadcrumb = readFileSync(join(outDir, 'breadcrumb.tsx'), 'utf8');
      const button = readFileSync(join(outDir, 'button.tsx'), 'utf8');
      const card = readFileSync(join(outDir, 'card.tsx'), 'utf8');
      const checkbox = readFileSync(join(outDir, 'checkbox.tsx'), 'utf8');
      const checkboxGroup = readFileSync(join(outDir, 'checkbox-group.tsx'), 'utf8');
      const combobox = readFileSync(join(outDir, 'combobox.tsx'), 'utf8');
      const kbd = readFileSync(join(outDir, 'kbd.tsx'), 'utf8');
      const radioGroup = readFileSync(join(outDir, 'radio-group.tsx'), 'utf8');
      const select = readFileSync(join(outDir, 'select.tsx'), 'utf8');
      const sheet = readFileSync(join(outDir, 'sheet.tsx'), 'utf8');
      const skeleton = readFileSync(join(outDir, 'skeleton.tsx'), 'utf8');
      const slider = readFileSync(join(outDir, 'slider.tsx'), 'utf8');
      const switchSource = readFileSync(join(outDir, 'switch.tsx'), 'utf8');
      const table = readFileSync(join(outDir, 'table.tsx'), 'utf8');
      const toggle = readFileSync(join(outDir, 'toggle.tsx'), 'utf8');
      const toggleGroup = readFileSync(join(outDir, 'toggle-group.tsx'), 'utf8');
      const toast = readFileSync(join(outDir, 'toast.tsx'), 'utf8');
      const toolbar = readFileSync(join(outDir, 'toolbar.tsx'), 'utf8');
      expect(alert).toContain("export const Alert = component('alert'");
      expect(alert).toContain('export const alertClassNames = defineVariants');
      expect(autocomplete).toContain("export const Autocomplete = component('autocomplete'");
      expect(autocomplete).toContain('export const autocompleteClassNames = defineVariants');
      expect(badge).toContain("export const Badge = component('badge'");
      expect(badge).toContain('export const badgeClassNames = defineVariants');
      expect(breadcrumb).toContain("export const Breadcrumb = component('breadcrumb'");
      expect(breadcrumb).toContain('export const breadcrumbClasses =');
      expect(button).toContain("import { component } from '@jiso/core';");
      expect(button).toContain("export const Button = component('button'");
      expect(button).toContain('export const buttonClassNames = defineVariants');
      expect(card).toContain("export const Card = component('card'");
      expect(card).toContain('export const cardClassNames =');
      expect(checkbox).toContain("export const Checkbox = component('checkbox'");
      expect(checkbox).toContain('export const checkboxClassNames = defineVariants');
      expect(checkboxGroup).toContain("export const CheckboxGroup = component('checkbox-group'");
      expect(checkboxGroup).toContain('export const checkboxGroupClassNames = defineVariants');
      expect(combobox).toContain("export const Combobox = component('combobox'");
      expect(combobox).toContain('export const comboboxClassNames = defineVariants');
      expect(kbd).toContain("export const Kbd = component('kbd'");
      expect(kbd).toContain('export const kbdClassNames =');
      expect(radioGroup).toContain("export const RadioGroup = component('radio-group'");
      expect(radioGroup).toContain('export const radioGroupClassNames = defineVariants');
      expect(select).toContain("export const Select = component('select'");
      expect(select).toContain('export const selectClassNames = defineVariants');
      expect(sheet).toContain("export const Sheet = component('sheet'");
      expect(sheet).toContain('export const sheetContentClassNames = defineVariants');
      expect(skeleton).toContain("export const Skeleton = component('skeleton'");
      expect(skeleton).toContain('export const skeletonClassNames =');
      expect(slider).toContain("export const Slider = component('slider'");
      expect(slider).toContain('export const sliderClassNames = defineVariants');
      expect(switchSource).toContain("export const Switch = component('switch'");
      expect(switchSource).toContain('export const switchClassNames = defineVariants');
      expect(table).toContain("export const Table = component('table'");
      expect(table).toContain("export const TableHead = component('table-head'");
      expect(toggle).toContain("export const Toggle = component('toggle'");
      expect(toggle).toContain('export const toggleClassNames = defineVariants');
      expect(toggleGroup).toContain("export const ToggleGroup = component('toggle-group'");
      expect(toggleGroup).toContain('export const toggleGroupClassNames = defineVariants');
      expect(toast).toContain("export const Toast = component('toast'");
      expect(toast).toContain('export const toastClassNames = defineVariants');
      expect(toolbar).toContain("export const Toolbar = component('toolbar'");
      expect(toolbar).toContain('export const toolbarClassNames = defineVariants');
      const vendoredSource = [
        alert,
        autocomplete,
        badge,
        breadcrumb,
        button,
        card,
        checkbox,
        checkboxGroup,
        combobox,
        kbd,
        radioGroup,
        select,
        sheet,
        skeleton,
        slider,
        switchSource,
        table,
        toggle,
        toggleGroup,
        toast,
        toolbar,
      ].join('\n');
      expect(vendoredSource).not.toContain('@jiso/ui');
      expect(vendoredSource).not.toContain('fw-c=');
      expect(vendoredSource).not.toContain('data-bind=');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('is idempotent when the vendored component is already current', () => {
    const root = mkdtempSync(join(tmpdir(), 'fw-add-cli-'));
    const outDir = join(root, 'ui');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main(['add', 'button', '--out', outDir])).toBe(0);
      stdout.mockClear();

      expect(main(['add', 'button', '--out', outDir])).toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      expect(stdout.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
        `SKIP button path=${JSON.stringify(join(outDir, 'button.tsx'))} reason=already-current`,
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('refuses unknown components with stable output', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main(['add', 'dialog'])).toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe(
        'fw: unknown component "dialog". available: alert, autocomplete, badge, breadcrumb, button, card, checkbox, checkbox-group, combobox, drawer, field, kbd, number-field, otp-field, radio-group, scroll-area, select, sheet, skeleton, slider, switch, table, tabs, toast, toggle, toggle-group, toolbar.\n',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('refuses to overwrite app-owned component files', () => {
    const root = mkdtempSync(join(tmpdir(), 'fw-add-cli-'));
    const outDir = join(root, 'ui');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'button.tsx'), 'export const Button = "local";\n', 'utf8');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      expect(main(['add', 'button', '--out', outDir])).toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toBe(
        `fw-add/v1\nERROR button path=${JSON.stringify(join(outDir, 'button.tsx'))} reason=would-overwrite\n`,
      );
      expect(readFileSync(join(outDir, 'button.tsx'), 'utf8')).toBe(
        'export const Button = "local";\n',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

async function waitForMcpMessage(
  transport: MemoryMcpTransport,
  predicate: (message: JSONRPCMessage) => boolean,
): Promise<JSONRPCMessage> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const message = transport.sent.find(predicate);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`MCP message was not sent. Sent: ${JSON.stringify(transport.sent)}`);
}

async function* mcpInputChunks(...chunks: string[]): AsyncIterable<string> {
  yield* chunks;
}

describe('fw export', () => {
  it('loads an app module and writes static HTML artifacts through the server exporter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fw-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        appPath,
        [
          'export default {',
          '  clientModules: {',
          "    put() { throw new Error('unused'); },",
          "    resolve() { return { body: 'Not Found', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 }; },",
          '  },',
          '  document: {},',
          '  endpoints: [],',
          '  errorShells: {},',
          '  mutations: [],',
          '  queries: [],',
          "  routes: [{ path: '/', page: () => '<main data-export-cli>CLI export</main>' }],",
          '};',
          '',
        ].join('\n'),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(0);

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('fw-export/v1\nHTML /index.html status=200 bytes=');
      expect(output).toContain(
        `SUMMARY html=1 clientModules=0 diagnostics=0 outDir=${JSON.stringify(outDir)}\n`,
      );
      expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toContain(
        '<main data-export-cli>CLI export</main>',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('passes pretty URL output through to the server exporter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fw-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        appPath,
        [
          'export default {',
          '  clientModules: {',
          "    put() { throw new Error('unused'); },",
          "    resolve() { return { body: 'Not Found', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 }; },",
          '  },',
          '  document: {},',
          '  endpoints: [],',
          '  errorShells: {},',
          '  mutations: [],',
          '  queries: [],',
          "  routes: [{ path: '/docs/intro', page: () => '<main data-pretty-export>Intro</main>' }],",
          '};',
          '',
        ].join('\n'),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir, '--pretty-urls'])).resolves.toBe(
        0,
      );

      expect(stderr).not.toHaveBeenCalled();
      const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('HTML /docs/intro/index.html status=200 bytes=');
      expect(readFileSync(join(outDir, 'docs', 'intro', 'index.html'), 'utf8')).toContain(
        '<main data-pretty-export>Intro</main>',
      );
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('prints FW229 diagnostics for non-exportable app modules', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fw-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        appPath,
        [
          'export const app = {',
          '  clientModules: {',
          "    put() { throw new Error('unused'); },",
          "    resolve() { return { body: 'Not Found', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 }; },",
          '  },',
          '  document: {},',
          '  endpoints: [],',
          '  errorShells: {},',
          '  mutations: [],',
          '  queries: [],',
          "  routes: [{ path: '/products/:id', page: () => '<main>Product</main>' }],",
          '};',
          '',
        ].join('\n'),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', join(root, 'dist')])).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('fw-export/v1\nERROR FW229 route=/products/:id');
      expect(output).toContain('staticPaths metadata');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('prints compile diagnostics exported by app modules before writing static output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fw-export-cli-'));
    const appPath = join(root, 'app.mjs');
    const outDir = join(root, 'dist');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      writeFileSync(
        appPath,
        [
          'export const diagnostics = [{',
          "  code: 'FW201',",
          "  fileName: 'src/cart.tsx',",
          "  message: 'Closure captures unserializable value.',",
          "  help: 'Fixes: move the value into component/query state via ctx.',",
          '  start: { line: 4, column: 12 },',
          '}];',
          'export const app = {',
          '  clientModules: {',
          "    put() { throw new Error('unused'); },",
          "    resolve() { return { body: 'Not Found', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, status: 404 }; },",
          '  },',
          '  document: {},',
          '  endpoints: [],',
          '  errorShells: {},',
          '  mutations: [],',
          '  queries: [],',
          "  routes: [{ path: '/', page: () => '<main>Home</main>' }],",
          '};',
          '',
        ].join('\n'),
        'utf8',
      );

      await expect(mainAsync(['export', appPath, '--out', outDir])).resolves.toBe(1);

      expect(stdout).not.toHaveBeenCalled();
      const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('fw-export/v1\nERROR FW201 route=src/cart.tsx');
      expect(output).toContain('Static export refused error diagnostic FW201 at src/cart.tsx:4:12');
      expect(() => readFileSync(join(outDir, 'index.html'), 'utf8')).toThrow();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('compile/v1 and fw mcp', () => {
  it('returns a snapshot-stable compile/v1 contract for in-memory component source', async () => {
    await expect(
      compileComponentV1({
        fileName: 'cart-badge.tsx',
        source: '<button>x</button>',
      }),
    ).resolves.toMatchInlineSnapshot(`
      {
        "componentGraphFacts": [
          {
            "name": "CartBadge",
          },
        ],
        "diagnostics": [],
        "emittedFiles": [
          {
            "byteLength": 78,
            "fileName": "cart-badge.server.js",
            "kind": "server",
          },
          {
            "byteLength": 42,
            "fileName": "cart-badge.client.js",
            "kind": "client",
          },
          {
            "byteLength": 652,
            "fileName": "generated/registries.d.ts",
            "kind": "registry",
          },
        ],
        "handlerExports": [],
        "ok": true,
        "platformSubstitutions": [],
        "queryUpdatePlans": [],
        "renderEquivalenceChecks": [
          {
            "artifact": "cart-badge.server.js",
            "ok": true,
          },
        ],
        "updateCoverage": [],
        "version": "compile/v1",
        "viewTransitions": [],
      }
    `);
  });

  it('proves the in-memory repair loop with shared FW201 diagnostics', async () => {
    const adversarial = await compileComponentV1({
      fileName: 'cart-badge.tsx',
      source: '<button onClick={() => window.alert("x")}>x</button>',
    });

    expect(adversarial.ok).toBe(false);
    expect(adversarial.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'FW210',
      'FW201',
    ]);
    const fw201 = adversarial.diagnostics.find((diagnostic) => diagnostic.code === 'FW201');
    expect(fw201).toMatchObject({
      code: 'FW201',
      fileName: 'cart-badge.tsx',
      message: 'Closure captures unserializable value.',
      severity: 'error',
      start: { column: 9, line: 1 },
    });
    expect(fw201?.help).toContain(
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
    );

    const corrected = await compileComponentV1({
      fileName: 'cart-badge.tsx',
      source: '<button>x</button>',
    });

    expect(corrected.ok).toBe(true);
    expect(corrected.diagnostics).toEqual([]);
  });

  it('feeds discovered package prefix facts through compile/v1', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jiso-cli-prefix-'));

    try {
      writePackageManifest(root, '@acme/primitives', {
        jiso: { prefix: 'acme-' },
        name: '@acme/primitives',
      });
      writePackageManifest(root, '@other/widgets', {
        jiso: { prefix: 'acme-' },
        name: '@other/widgets',
      });

      await expect(
        compileComponentV1({
          fileName: 'src/shell.tsx',
          packagePrefixDiscoveryRoot: root,
          source: `
import { component } from '@jiso/core';
import '@acme/primitives';
import '@other/widgets';

export const Shell = component('shell', {
  render: () => <section></section>,
});
`,
        }),
      ).resolves.toMatchObject({
        diagnostics: [
          {
            code: 'FW234',
            fileName: 'src/shell.tsx',
            message:
              'Package component prefix registration conflict or reservation violation. Effective package prefix "acme-" is claimed by @acme/primitives and @other/widgets.',
            severity: 'error',
          },
        ],
        ok: false,
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('exposes MCP-style tool listing and structured compile results over JSON-RPC objects', async () => {
    await expect(handleFwMcpRequest({ id: 1, jsonrpc: '2.0', method: 'tools/list' })).resolves
      .toMatchInlineSnapshot(`
      {
        "id": 1,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "fw-mcp/v1",
              "type": "text",
            },
          ],
          "structuredContent": {
            "tools": [
              {
                "description": "Compile an in-memory TSX/JSX component module and return the stable compile/v1 contract.",
                "inputSchema": {
                  "additionalProperties": true,
                  "properties": {
                    "fileName": {
                      "type": "string",
                    },
                    "packageComponentPrefixes": {
                      "type": "array",
                    },
                    "packagePrefixDiscoveryRoot": {
                      "type": "string",
                    },
                    "queryShapeFacts": {
                      "type": "array",
                    },
                    "queryShapes": {
                      "type": "object",
                    },
                    "registryFacts": {
                      "type": "object",
                    },
                    "source": {
                      "type": "string",
                    },
                    "sourceProvenance": {
                      "enum": [
                        "app",
                        "compiler-emitted",
                      ],
                    },
                  },
                  "required": [
                    "fileName",
                    "source",
                  ],
                  "type": "object",
                },
                "name": "compile_component",
              },
              {
                "description": "Run fwCheck against an inline graph or graphPath.",
                "inputSchema": {
                  "additionalProperties": false,
                  "properties": {
                    "family": {
                      "enum": [
                        "all",
                        "coverage",
                        "optimistic",
                      ],
                    },
                    "graph": {
                      "type": "object",
                    },
                    "graphPath": {
                      "type": "string",
                    },
                  },
                  "required": [],
                  "type": "object",
                },
                "name": "fw_check",
              },
              {
                "description": "Run fwExplain against an inline graph or graphPath.",
                "inputSchema": {
                  "additionalProperties": false,
                  "properties": {
                    "graph": {
                      "type": "object",
                    },
                    "graphPath": {
                      "type": "string",
                    },
                    "options": {
                      "type": "object",
                    },
                  },
                  "required": [
                    "options",
                  ],
                  "type": "object",
                },
                "name": "fw_explain",
              },
              {
                "description": "List shared diagnostic definitions from the @jiso/core registry.",
                "inputSchema": {
                  "additionalProperties": false,
                  "properties": {},
                  "type": "object",
                },
                "name": "list_diagnostics",
              },
            ],
            "version": "fw-mcp/v1",
          },
          "version": "fw-mcp/v1",
        },
      }
    `);

    const response = await handleFwMcpRequest({
      id: 'compile-1',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: {
          fileName: 'cart-badge.tsx',
          source: '<button onClick={() => window.alert("x")}>x</button>',
        },
        name: 'compile_component',
      },
    });

    expect(response).toMatchObject({
      id: 'compile-1',
      jsonrpc: '2.0',
      result: {
        structuredContent: {
          diagnostics: [
            { code: 'FW210', severity: 'lint' },
            { code: 'FW201', severity: 'error' },
          ],
          ok: false,
          version: 'compile/v1',
        },
        version: 'fw-mcp/v1',
      },
    });
  });

  it('wraps fw_check, fw_explain, and diagnostic definitions without a second policy', async () => {
    await expect(
      handleFwMcpRequest({
        id: 'check-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: { graph: {} }, name: 'fw_check' },
      }),
    ).resolves.toMatchObject({
      result: {
        structuredContent: {
          exitCode: 0,
          output: 'fw-check/v1\nOK\n',
          version: 'fw-check/v1',
        },
      },
    });

    await expect(
      handleFwMcpRequest({
        id: 'explain-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            graph: { queries: [{ domains: ['cart'], query: 'cart' }] },
            options: { kind: 'query', target: 'cart' },
          },
          name: 'fw_explain',
        },
      }),
    ).resolves.toMatchObject({
      result: {
        structuredContent: {
          exitCode: 0,
          output:
            'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: -\ninvalidated-by: -\ndomain-writes: -\n',
          version: 'fw-explain/v1',
        },
      },
    });

    const diagnostics = await handleFwMcpRequest({
      id: 'definitions-1',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { arguments: {}, name: 'list_diagnostics' },
    });
    expect(diagnostics).toMatchObject({
      result: {
        structuredContent: {
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'FW201',
              message: 'Closure captures unserializable value.',
              severity: 'error',
            }),
          ]),
          version: 'diagnostics/v1',
        },
      },
    });
  });

  it('preserves the newline-delimited JSON-RPC fallback stdio seam', async () => {
    const chunks: string[] = [];
    await runMcpFallbackStdio(
      mcpInputChunks(
        `${JSON.stringify({
          id: 'list-fallback',
          jsonrpc: '2.0',
          method: 'tools/list',
        })}\n`,
      ),
      { write: (chunk) => chunks.push(chunk) },
    );

    expect(JSON.parse(chunks.join(''))).toMatchObject({
      id: 'list-fallback',
      jsonrpc: '2.0',
      result: {
        structuredContent: {
          tools: expect.arrayContaining([expect.objectContaining({ name: 'compile_component' })]),
          version: 'fw-mcp/v1',
        },
        version: 'fw-mcp/v1',
      },
    });
  });

  it('serves initialize, tool listing, and tool calls through the SDK MCP lifecycle', async () => {
    const transport = new MemoryMcpTransport();
    await runMcpSdkServer(transport);

    expect(transport.started).toBe(true);

    transport.receive({
      id: 'init-1',
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        capabilities: {},
        clientInfo: { name: 'fw-test-client', version: '0.0.0' },
        protocolVersion: '2025-06-18',
      },
    });

    const initialize = await waitForMcpMessage(
      transport,
      (message) => 'id' in message && message.id === 'init-1',
    );
    expect(initialize).toMatchObject({
      id: 'init-1',
      jsonrpc: '2.0',
      result: {
        capabilities: { tools: {} },
        serverInfo: { name: 'fw', version: 'fw-mcp/v1' },
      },
    });

    transport.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
    transport.receive({ id: 'list-1', jsonrpc: '2.0', method: 'tools/list', params: {} });

    const list = await waitForMcpMessage(
      transport,
      (message) => 'id' in message && message.id === 'list-1',
    );
    expect(list).toMatchObject({
      id: 'list-1',
      jsonrpc: '2.0',
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({
            inputSchema: expect.objectContaining({ type: 'object' }),
            name: 'compile_component',
          }),
        ]),
      },
    });

    transport.receive({
      id: 'compile-1',
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        arguments: {
          fileName: 'cart-badge.tsx',
          source: '<button onClick={() => window.alert("x")}>x</button>',
        },
        name: 'compile_component',
      },
    });

    const compile = await waitForMcpMessage(
      transport,
      (message) => 'id' in message && message.id === 'compile-1',
    );
    expect(compile).toMatchObject({
      id: 'compile-1',
      jsonrpc: '2.0',
      result: {
        content: [{ type: 'text' }],
        structuredContent: {
          diagnostics: [
            { code: 'FW210', severity: 'lint' },
            { code: 'FW201', severity: 'error' },
          ],
          ok: false,
          version: 'compile/v1',
        },
      },
    });
  });
});

function writePackageManifest(
  root: string,
  packageName: string,
  manifest: Record<string, unknown>,
): void {
  const dir = join(root, 'node_modules', ...packageName.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
}

describe('fw check', () => {
  it('emits stable OK output for an empty semantic graph', () => {
    expect(fwCheck({})).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('reports unknown diagnostic codes as stable input errors', () => {
    expect(
      fwCheck({
        lints: [{ code: 'FW999', site: 'cart.tsx:1' }],
      } as never),
    ).toEqual({
      exitCode: 1,
      output: 'fw-check/v1\nERROR INPUT lints[0].code unknown diagnostic code "FW999"\n',
    });
  });

  it('fails on FW310 optimistic coverage gaps', () => {
    expect(
      fwCheck({
        optimistic: [
          { mutation: 'cart/add', query: 'cartQuery.items', status: 'UNHANDLED' },
          { mutation: 'cart/add', query: 'cartQuery.count', status: 'hand-written' },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nWARN FW310 cart/add -> cartQuery.items Invalidated query lacks optimistic transform.\n',
    });
  });

  it('prints stable FW311 update coverage rows and warnings', () => {
    expect(
      fwCheck({
        updateCoverage: [
          {
            component: 'CartBadge',
            position: 'conditional <dot>',
            query: 'cart.discount',
            status: 'UNHANDLED',
          },
          {
            component: 'CartBadge',
            detail: 'text binding',
            position: 'text',
            query: 'cart.count',
            status: 'plan',
          },
          {
            component: 'CartDrawer',
            position: 'root',
            query: 'cart',
            status: 'fragment',
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output: [
        'fw-check/v1',
        'COVERAGE component=CartBadge query=cart.count position="text" status=plan detail="text binding"',
        'WARN FW311 component=CartBadge query=cart.discount position="conditional <dot>" Query-dependent DOM position has no update status.',
        'COVERAGE component=CartDrawer query=cart position="root" status=fragment',
        '',
      ].join('\n'),
    });
  });

  it('reports owner-domain accesses that are not session scoped', () => {
    expect(
      fwCheck({
        ownerDomains: [{ domain: 'cart', owner: 'userId' }],
        scopeAudits: [
          {
            domain: 'cart',
            kind: 'query',
            name: 'cart',
            scope: 'session',
            site: 'cart.queries.ts:8',
          },
          {
            detail: 'where eq(carts.id, args.cartId)',
            domain: 'cart',
            kind: 'query',
            name: 'cartById',
            scope: 'args',
            site: 'cart.queries.ts:21',
          },
          {
            domain: 'product',
            kind: 'query',
            name: 'productGrid',
            scope: 'args',
            site: 'product.queries.ts:4',
          },
        ],
      }).output,
    ).toBe(
      [
        'fw-check/v1',
        'WARN UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21 where eq(carts.id, args.cartId)',
        '',
      ].join('\n'),
    );
  });

  it('reports unguarded queries and pages alongside mutations', () => {
    expect(
      fwCheck({
        mutations: [{ guards: ['authed'], key: 'cart/add', writes: ['cart'] }],
        optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'hand-written' }],
        pages: [
          { guards: ['authed'], route: '/cart' },
          { guards: [], queries: ['adminOrders'], route: '/admin' },
        ],
        queries: [
          { domains: ['cart'], guards: ['authed'], query: 'cart' },
          { domains: ['order'], guards: [], query: 'adminOrders' },
        ],
      }).output,
    ).toBe(
      [
        'fw-check/v1',
        'ERROR FW407 adminOrders reads order. Query read from undeclared domain. No mutation touch graph writes that domain.',
        'WARN UNGUARDED page /admin is reachable without an auth guard.',
        'WARN UNGUARDED query adminOrders is reachable without an auth guard.',
        '',
      ].join('\n'),
    );
  });

  it('derives FW310 gaps from mutation invalidations and query read sets', () => {
    expect(
      fwCheck({
        mutations: [
          {
            guards: ['authed'],
            invalidates: ['cart'],
            key: 'cart/add',
          },
        ],
        optimistic: [{ mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' }],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['product'], query: 'productGrid' },
        ],
        touchGraph: {
          'cart.addItem': {
            touches: [
              { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              { domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' },
            ],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    });
  });

  it('accepts explicit optimistic statuses for every invalidated query', () => {
    expect(
      fwCheck({
        mutations: [
          {
            guards: ['authed'],
            invalidates: ['cart'],
            key: 'cart/add',
            manualInvalidates: ['product'],
          },
        ],
        optimistic: [
          { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
          { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
        ],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['product'], query: 'productGrid' },
        ],
        touchGraph: {
          'cart.addItem': {
            touches: [
              { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              { domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' },
            ],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN INVALIDATE cart/add -> product Manual invalidate escape hatch requires review.\n',
    });
  });

  it('derives FW310 gaps from manual invalidations', () => {
    expect(
      fwCheck({
        mutations: [{ key: 'cart/add', manualInvalidates: ['product'] }],
        queries: [{ domains: ['product'], query: 'productGrid' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'product', keys: null, site: 'cart.domain.ts:1', via: 'products' }],
            unresolved: [],
          },
        },
      }).output,
    ).toBe(
      [
        'fw-check/v1',
        'WARN FW310 cart/add -> productGrid Invalidated query lacks optimistic transform.',
        'WARN UNGUARDED cart/add mutation is reachable without an auth guard.',
        'WARN INVALIDATE cart/add -> product Manual invalidate escape hatch requires review.',
        '',
      ].join('\n'),
    );
  });

  it('derives FW310 gaps from mutation writes when invalidates are absent', () => {
    expect(
      fwCheck({
        mutations: [{ guards: ['authed'], key: 'cart/add', writes: ['cart'] }],
        queries: [{ domains: ['cart'], query: 'cart' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
      }).output,
    ).toBe(
      'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    );
  });

  it('derives FW310 gaps from writes even when explicit invalidates are incomplete', () => {
    expect(
      fwCheck({
        mutations: [
          {
            guards: ['authed'],
            invalidates: ['cart'],
            key: 'cart/add',
            writes: ['cart', 'product'],
          },
        ],
        optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'hand-written' }],
        queries: [
          { domains: ['cart'], query: 'cart' },
          { domains: ['product'], query: 'productGrid' },
        ],
        touchGraph: {
          'cart.addItem': {
            touches: [
              { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              { domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' },
            ],
            unresolved: [],
          },
        },
      }).output,
    ).toBe(
      'fw-check/v1\nWARN FW310 cart/add -> productGrid Invalidated query lacks optimistic transform.\n',
    );
  });

  it('reports semantic lints for local state, events, and direct db access', () => {
    expect(
      fwCheck({
        lints: [
          {
            code: 'FW301',
            detail: 'state.cartCount mirrors query cart.count.',
            site: 'CartBadge.client.ts:8',
          },
          {
            code: 'FW320',
            detail: 'event cart:added carries product.unitPrice.',
            site: 'cart.events.ts:3',
          },
          {
            code: 'FW330',
            detail: 'handler addToCart receives db.',
            site: 'cart.mutation.ts:12',
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-check/v1',
        'LINT FW301 CartBadge.client.ts:8 Server fact stored in island-local state. state.cartCount mirrors query cart.count.',
        'LINT FW320 cart.events.ts:3 Event payload overlaps query data; use a transform. event cart:added carries product.unitPrice.',
        'LINT FW330 cart.mutation.ts:12 Direct db access in a mutation handler; route through domain. handler addToCart receives db.',
        '',
      ].join('\n'),
    });
  });

  it('prints FW302 data-bind path lints using the SPEC §11.3 diagnostic registry message', () => {
    expect(
      fwCheck({
        lints: [
          {
            code: 'FW302',
            detail: 'cart.total',
            site: 'CartBadge.tsx:12',
          },
        ],
      }).output,
    ).toMatchInlineSnapshot(`
      "fw-check/v1
      LINT FW302 CartBadge.tsx:12 data-bind path is not present in the declared query shape. cart.total
      "
    `);
  });

  it('prints FW303 fragment target input diagnostics using the registry message', () => {
    expect(
      fwCheck({
        lints: [
          {
            code: 'FW303',
            detail: 'priceList',
            site: 'CartRow.tsx:7',
          },
        ],
      }).output,
    ).toMatchInlineSnapshot(`
      "fw-check/v1
      LINT FW303 CartRow.tsx:7 Fragment target render input is not declared as query data or stamped props. priceList
      "
    `);
  });

  it('reports FW320 when event payload facts overlap query data facts', () => {
    expect(
      fwCheck({
        eventPayloads: [
          {
            event: 'cart:added',
            fields: ['productId', 'product.unitPrice', 'quantity'],
            site: 'cart.events.ts:3',
          },
        ],
        queryData: [
          {
            fields: ['id', 'product.unitPrice', 'title'],
            query: 'productCard',
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nLINT FW320 cart.events.ts:3 Event payload overlaps query data; use a transform. event cart:added carries product.unitPrice from query productCard.\n',
    });
  });

  it('keeps graph-derived FW320 output stable across duplicate query fields', () => {
    expect(
      fwCheck({
        eventPayloads: [
          {
            event: 'cart:added',
            fields: ['product.unitPrice'],
            site: 'cart.events.ts:3',
          },
        ],
        queryData: [
          { fields: ['product.unitPrice'], query: 'recommendations' },
          { fields: ['product.unitPrice'], query: 'cart' },
          { fields: ['product.unitPrice'], query: 'cart' },
        ],
      }).output,
    ).toBe(
      'fw-check/v1\nLINT FW320 cart.events.ts:3 Event payload overlaps query data; use a transform. event cart:added carries product.unitPrice from query cart,recommendations.\n',
    );
  });

  it('accepts event payload facts that do not overlap query data facts', () => {
    expect(
      fwCheck({
        eventPayloads: [
          {
            event: 'cart:added',
            fields: ['productId', 'quantity'],
            site: 'cart.events.ts:3',
          },
        ],
        queryData: [{ fields: ['product.unitPrice', 'title'], query: 'productCard' }],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('reports unresolved touch graph sites as FW406', () => {
    expect(
      fwCheck({
        touchGraph: {
          'cart.addItem': {
            touches: [],
            unresolved: [
              {
                code: 'FW406',
                message: 'Statically un-analyzable write site; manual touches required.',
                site: 'cart.domain.ts:20',
              },
            ],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN FW406 cart.domain.ts:20 Statically un-analyzable write site; manual touches required.\n',
    });
  });

  it('reports non-equality touch graph predicates as FW409 notices', () => {
    expect(
      fwCheck({
        touchGraph: {
          'cart.reserveStock': {
            touches: [
              {
                domain: 'product',
                keys: null,
                predicate: 'non-eq',
                site: 'product.domain.ts:20',
                via: 'products',
              },
            ],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nNOTICE FW409 product.domain.ts:20 Non-eq predicate degraded to table-level invalidation.\n',
    });
  });

  it('prints static Drizzle FW410 diagnostics as fw check findings', () => {
    expect(
      fwCheck({
        diagnostics: [
          {
            code: 'FW410',
            site: 'cart.queries.ts:5',
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nERROR FW410 cart.queries.ts:5 Query result shape failed declared output schema.\n',
    });
  });

  it('prints static diagnostic source positions when present', () => {
    expect(
      fwCheck({
        diagnostics: [
          {
            code: 'FW302',
            message: 'data-bind path is not present in the declared query shape. cart.missing',
            site: 'cart-badge.tsx',
            start: { column: 23, line: 3 },
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nERROR FW302 cart-badge.tsx:3:23 data-bind path is not present in the declared query shape. cart.missing\n',
    });
  });

  it('prints runtime verification diagnostics as fw check findings', () => {
    expect(
      fwCheck({
        verificationDiagnostics: [
          {
            branch: 'stock-reserve',
            code: 'FW405',
            domain: 'product',
            site: 'cart.domain.ts:2',
          },
          {
            code: 'FW402',
            detail: 'observed table audit_log',
            domain: 'audit',
          },
          {
            code: 'FW408',
            detail: 'expected id observed sku',
            domain: 'product',
            site: 'product.domain.ts:9',
          },
          {
            code: 'FW403',
            domain: 'order',
          },
          {
            code: 'FW404',
            detail: 'observed table unknown_table',
            domain: 'unknown_table',
          },
          {
            code: 'FW407',
            detail: 'observed table products',
            domain: 'product',
            site: 'cart.queries.ts:7',
          },
          {
            code: 'FW410',
            detail: 'cart Expected number',
            domain: 'cart',
            site: 'cart.queries.ts:11',
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output: [
        'fw-check/v1',
        'WARN FW405 cart.domain.ts:2 Conditional write branch was never executed under instrumentation. domain=product branch=stock-reserve',
        'ERROR FW402 domain:audit Write touched an undeclared domain. domain=audit observed table audit_log',
        'ERROR FW408 product.domain.ts:9 Declared row key differs from observed row predicate. domain=product expected id observed sku',
        'WARN FW403 domain:order Declared domain was never observed written. domain=order',
        'ERROR FW404 domain:unknown_table Write to unmapped table. domain=unknown_table observed table unknown_table',
        'ERROR FW407 cart.queries.ts:7 Query read from undeclared domain. domain=product observed table products',
        'ERROR FW410 cart.queries.ts:11 Query result shape failed declared output schema. domain=cart cart Expected number',
        '',
      ].join('\n'),
    });
  });

  it('fails when a query reads a domain no mutation can invalidate', () => {
    expect(
      fwCheck({
        queries: [{ domains: ['cart', 'product'], query: 'productPage' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nERROR FW407 productPage reads product. Query read from undeclared domain. No mutation touch graph writes that domain.\n',
    });
  });

  it('accepts query read domains covered by the touch graph', () => {
    expect(
      fwCheck({
        queries: [{ domains: ['cart'], query: 'cart' }],
        touchGraph: {
          'cart.addItem': {
            touches: [{ domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' }],
            unresolved: [],
          },
        },
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('fails when declared mutation invalidations lack optimistic coverage', () => {
    expect(
      fwCheck({
        mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
        queries: [{ domains: ['cart'], query: 'cart' }],
      }),
    ).toEqual({
      exitCode: 1,
      output:
        'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    });
  });

  it('reports fixpoint invariant failures as stable ERROR diagnostics', () => {
    // SPEC.md §5.2 requires generated output to be a CI-enforced compiler fixpoint.
    expect(
      fwCheck({
        fixpointChecks: [
          {
            actual: 'sha256:bbb',
            artifact: 'components/z.generated.tsx',
            detail: 'compile(compile(src)) differed.',
            expected: 'sha256:aaa',
            ok: false,
          },
          {
            artifact: 'components/ok.generated.tsx',
            ok: true,
          },
          {
            artifact: 'components/a.generated.tsx',
            ok: false,
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output: [
        'fw-check/v1',
        'ERROR FIXPOINT components/a.generated.tsx Generated output must compile to itself.',
        'ERROR FIXPOINT components/z.generated.tsx compile(compile(src)) differed. expected="sha256:aaa" actual="sha256:bbb"',
        '',
      ].join('\n'),
    });
  });

  it('accepts satisfied fixpoint checks', () => {
    expect(
      fwCheck({
        fixpointChecks: [
          {
            artifact: 'components/cart-badge.server.tsx',
            ok: true,
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('reports render-equivalence failures as stable ERROR diagnostics', () => {
    expect(
      fwCheck({
        renderEquivalenceChecks: [
          {
            actual: 'sha256:lowered',
            artifact: 'components/z.server.js',
            detail: 'render(src) differed from render(compile(src)).',
            expected: 'sha256:authored',
            ok: false,
          },
          {
            artifact: 'components/ok.server.js',
            ok: true,
          },
          {
            artifact: 'components/a.server.js',
            ok: false,
          },
        ],
      }),
    ).toEqual({
      exitCode: 1,
      output: [
        'fw-check/v1',
        'ERROR RENDER_EQUIV components/a.server.js Authored and lowered render output must match byte-for-byte.',
        'ERROR RENDER_EQUIV components/z.server.js render(src) differed from render(compile(src)). expected="sha256:authored" actual="sha256:lowered"',
        '',
      ].join('\n'),
    });
  });

  it('accepts satisfied render-equivalence checks', () => {
    expect(
      fwCheck({
        renderEquivalenceChecks: [
          {
            artifact: 'components/cart-badge.server.js',
            ok: true,
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nOK\n',
    });
  });

  it('audits mutations reachable without an auth guard', () => {
    expect(
      fwCheck({
        mutations: [
          { guards: ['rateLimit:session'], key: 'cart/add' },
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-check/v1\nWARN UNGUARDED cart/add mutation is reachable without an auth guard.\n',
    });
  });

  it('audits endpoints reachable without an auth declaration', () => {
    expect(
      fwCheck({
        endpoints: [
          {
            auth: 'none',
            csrf: 'exempt',
            csrfJustification: 'oauth callback',
            method: 'POST',
            name: 'auth/callback',
            path: '/auth/callback',
          },
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN UNGUARDED auth/callback endpoint is reachable without an auth declaration.\n',
    });
  });

  it('warns when endpoint CSRF exemptions are missing the named justification', () => {
    expect(
      fwCheck({
        endpoints: [{ csrf: 'exempt', method: 'POST', name: 'stripe/webhook', path: '/stripe' }],
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-check/v1',
        'WARN UNGUARDED stripe/webhook endpoint is reachable without an auth declaration.',
        'WARN ENDPOINT stripe/webhook csrf exemption requires a named justification.',
        '',
      ].join('\n'),
    });
  });

  it('audits manual invalidate escape-hatch usage', () => {
    expect(
      fwCheck({
        mutations: [{ key: 'inventory/sync', manualInvalidates: ['product'] }],
      }),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-check/v1\nWARN UNGUARDED inventory/sync mutation is reachable without an auth guard.\nWARN INVALIDATE inventory/sync -> product Manual invalidate escape hatch requires review.\n',
    });
  });

  it('fails fw check optimistic as a CLI command when coverage is unhandled', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-optimistic-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
          optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'UNHANDLED' }],
          queries: [{ domains: ['cart'], query: 'cart' }],
          updateCoverage: [
            {
              component: 'CartBadge',
              position: 'conditional <dot>',
              query: 'cart.discount',
              status: 'UNHANDLED',
            },
          ],
          touchGraph: {
            'cart.addItem': {
              reads: [{ domain: 'product', keys: null, site: 'cart.domain.ts:2', via: 'products' }],
              touches: [
                { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              ],
              unresolved: [
                {
                  code: 'FW406',
                  message: 'Statically un-analyzable write site; manual touches required.',
                  site: 'cart.domain.ts:3',
                },
              ],
            },
          },
        }),
      );

      expect(main(['check', 'optimistic', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      'fw-check/v1\nWARN FW310 cart/add -> cart Invalidated query lacks optimistic transform.\n',
    );
  });

  it('fails fw check coverage as a CLI command when coverage is unhandled', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-coverage-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
          optimistic: [{ mutation: 'cart/add', query: 'cart', status: 'UNHANDLED' }],
          queries: [{ domains: ['product'], query: 'productPage' }],
          touchGraph: {
            'cart.addItem': {
              touches: [
                { domain: 'cart', keys: null, site: 'cart.domain.ts:1', via: 'cart_items' },
              ],
              unresolved: [
                {
                  code: 'FW406',
                  message: 'Statically un-analyzable write site; manual touches required.',
                  site: 'cart.domain.ts:3',
                },
              ],
            },
          },
          updateCoverage: [
            {
              component: 'CartBadge',
              position: 'conditional <dot>',
              query: 'cart.discount',
              status: 'UNHANDLED',
            },
          ],
        }),
      );

      expect(main(['check', 'coverage', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      'fw-check/v1\nWARN FW311 component=CartBadge query=cart.discount position="conditional <dot>" Query-dependent DOM position has no update status.\n',
    );
  });

  it('rejects unsupported fw check families with a stable diagnostic', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['check', 'optimstic', 'graph.json'])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toBe(
      'fw: unsupported check family "optimstic". expected optimistic or coverage.\n',
    );
  });

  it('rejects extra args after supported fw check families', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['check', 'coverage', 'graph.json', 'extra.json'])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toBe('fw: usage: fw check [optimistic|coverage] [graph.json]\n');
  });

  it('rejects unknown flags before treating them as graph paths', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['explain', '--json', 'component', 'CartBadge'])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toBe('fw: unknown flag "--json"\n');
  });

  it('reports unknown commands without implying missing implementation', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['compile'])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toBe(
      'fw: unknown command "compile". expected add, explain, check, audit, export, or mcp.\n',
    );
  });

  it('runs as a CLI entrypoint when the script path contains spaces', () => {
    const parent = mkdtempSync(join(tmpdir(), 'jiso-cli-entry-'));
    const spacedDir = join(parent, 'entry path with spaces');
    const entryPath = join(spacedDir, 'fw.ts');

    try {
      mkdirSync(spacedDir, { recursive: true });
      mkdirSync(join(parent, 'node_modules/@jiso/core'), { recursive: true });
      writeFileSync(
        join(parent, 'node_modules/@jiso/core/package.json'),
        '{"type":"module","exports":"./index.js"}\n',
        'utf8',
      );
      writeFileSync(
        join(parent, 'node_modules/@jiso/core/index.js'),
        [
          'export const diagnosticDefinitions = {};',
          'export function diagnosticDefinitionText() { return ""; }',
          'export function isDiagnosticCode() { return false; }',
          'export function validateFwExplainInput() { return []; }',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(join(parent, 'package.json'), '{"type":"module"}\n', 'utf8');
      symlinkSync(new URL('./index.ts', import.meta.url), entryPath);
      symlinkSync(new URL('./add-catalog.ts', import.meta.url), join(spacedDir, 'add-catalog.js'));

      const output = execFileSync(process.execPath, ['--preserve-symlinks-main', entryPath], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      expect(output).toBe('fw: explain, check, audit, export, mcp\n');
    } finally {
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it('reports a stable error for missing check input files', () => {
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      expect(main(['check', join(tmpdir(), 'missing-jiso-graph.json')])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
    }

    expect(output).toMatch(/^fw: input file not found: .*missing-jiso-graph\.json\n$/);
  });

  it('reports a stable error for malformed JSON input', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-malformed-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '{');

      expect(main(['audit', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(`fw: input file is not valid JSON: ${graphPath}\n`);
  });

  it('reports a stable error for non-object JSON input', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-shape-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '[]');

      expect(main(['explain', '--unguarded', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(`fw: input JSON must be an object: ${graphPath}\n`);
  });

  it('reports a stable error for graph array fields with the wrong shape', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-field-shape-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '{"mutations":{}}');

      expect(main(['check', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(`fw: input JSON field mutations must be an array: ${graphPath}\n`);
  });

  it('reports a stable error for malformed render-equivalence check facts', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-render-equiv-shape-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '{"renderEquivalenceChecks":{}}');

      expect(main(['check', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      `fw: input JSON field renderEquivalenceChecks must be an array: ${graphPath}\n`,
    );
  });

  it('reports a stable error for touchGraph with the wrong shape', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-touch-graph-shape-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(graphPath, '{"touchGraph":[]}');

      expect(main(['check', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(`fw: input JSON field touchGraph must be an object: ${graphPath}\n`);
  });
});

describe('fw audit', () => {
  it('prints stable unguarded and manual invalidate audit output', () => {
    expect(
      fwAudit({
        mutations: [
          {
            guards: ['rateLimit:session'],
            invalidates: ['cart'],
            key: 'cart/add',
            writes: ['cart'],
          },
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
          { key: 'inventory/sync', manualInvalidates: ['product'], writes: ['product'] },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=cart manual-invalidates=-',
        'MUTATION inventory/sync guards=- writes=product invalidates=- manual-invalidates=product',
        'MANUAL-INVALIDATES',
        'MUTATION inventory/sync domains=product',
        'SUMMARY unguarded=2 manual-invalidates=1',
        '',
      ].join('\n'),
    });
  });

  it('prints stable endpoint audit output', () => {
    expect(
      fwAudit({
        endpoints: [
          {
            auth: 'none',
            csrf: 'exempt',
            csrfJustification: 'oauth callback',
            method: 'GET',
            name: 'auth/callback',
            path: '/auth/callback',
          },
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
          },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-audit/v1',
        'UNGUARDED',
        'ENDPOINT auth/callback method=GET path=/auth/callback mount=exact auth=none csrf=exempt:oauth callback',
        'SUMMARY unguarded=1 manual-invalidates=0',
        '',
      ].join('\n'),
    });
  });

  it('prints OK when there are no audit findings', () => {
    expect(
      fwAudit({
        mutations: [
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
        ],
      }),
    ).toEqual({
      exitCode: 0,
      output: 'fw-audit/v1\nOK\n',
    });
  });

  it('fails on audit findings when requested', () => {
    expect(
      fwAudit(
        {
          mutations: [
            { guards: ['authed'], key: 'cart/remove' },
            { guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] },
          ],
        },
        { failOnFindings: true },
      ),
    ).toEqual({
      exitCode: 1,
      output: [
        'fw-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-',
        'SUMMARY unguarded=1 manual-invalidates=0',
        '',
      ].join('\n'),
    });
  });

  it('accepts fw audit as a CLI command', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-audit-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [
            { guards: ['authed'], key: 'cart/remove' },
            { guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] },
          ],
        }),
      );

      expect(main(['audit', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'fw-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-',
        'SUMMARY unguarded=1 manual-invalidates=0',
        '',
      ].join('\n'),
    );
  });

  it('fails fw audit when requested and findings exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-audit-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [
            { guards: ['authed'], key: 'cart/remove' },
            { guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] },
          ],
        }),
      );

      expect(main(['audit', '--fail-on-findings', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'fw-audit/v1',
        'UNGUARDED',
        'MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-',
        'SUMMARY unguarded=1 manual-invalidates=0',
        '',
      ].join('\n'),
    );
  });
});

describe('fw explain', () => {
  it('explains component handlers, query consumers, and fragment targets', () => {
    expect(
      fwExplain(
        {
          components: [
            {
              attributeMerges: [
                {
                  attr: 'aria-expanded',
                  decision: 'author-wins',
                  diagnostics: ['FW232'],
                  element: 'button',
                  rule: 'aria-author-override',
                },
                {
                  attr: 'data-bind:hidden',
                  decision: 'error',
                  diagnostics: ['FW233'],
                  element: 'button',
                  rule: 'binding-target-conflict',
                },
              ],
              derives: [
                {
                  inputs: ['cart'],
                  name: 'CartBadge$isEmpty',
                  ref: '/c/cart-badge.client.js#CartBadge$isEmpty',
                  target: 'button[data-bind:disabled]',
                },
              ],
              fragments: ['cart-badge'],
              handlers: [
                {
                  captures: ['ctx', 'element-params'],
                  event: 'click',
                  exportName: 'CartBadge$button_click',
                  params: ['itemId'],
                  ref: '/c/cart-badge.client.js#CartBadge$button_click',
                },
              ],
              name: 'CartBadge',
              platformSubstitutions: [
                {
                  action: 'show-modal',
                  event: 'click',
                  kind: 'dialog',
                  tag: 'button',
                  target: 'cart-drawer',
                },
              ],
              queries: ['cart'],
              triggers: [
                {
                  deps: ['cart'],
                  exportName: 'CartBadge$mountChart',
                  justification: 'chart boots when visible',
                  ref: '/c/cart-badge.client.js#CartBadge$mountChart',
                  trigger: 'visible',
                },
              ],
            },
          ],
        },
        { kind: 'component', target: 'CartBadge' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'COMPONENT CartBadge',
        'queries: cart',
        'fragments: cart-badge',
        'HANDLER click export=CartBadge$button_click ref=/c/cart-badge.client.js#CartBadge$button_click captures=ctx,element-params params=itemId substitution=-',
        'SUBSTITUTION dialog tag=button event=click target=cart-drawer action=show-modal',
        'DERIVE CartBadge$isEmpty inputs=cart ref=/c/cart-badge.client.js#CartBadge$isEmpty target=button[data-bind:disabled]',
        'TRIGGER visible export=CartBadge$mountChart ref=/c/cart-badge.client.js#CartBadge$mountChart deps=cart justification=chart boots when visible',
        'MERGE button attr=aria-expanded rule=aria-author-override decision=author-wins diagnostics=FW232',
        'MERGE button attr=data-bind:hidden rule=binding-target-conflict decision=error diagnostics=FW233',
        '',
      ].join('\n'),
    });
  });

  it('prints package prefix provenance for a prefixed component target', () => {
    expect(
      fwExplain(
        {
          components: [
            {
              fragments: ['jiso-dialog'],
              name: 'JisoDialog',
              queries: ['dialogState'],
            },
          ],
          packageComponentPrefixes: [
            {
              packageName: '@jiso/headless-ui',
              prefix: 'jiso-',
            },
          ],
        },
        { kind: 'component', target: 'jiso-dialog' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'COMPONENT JisoDialog',
        'provenance: package=@jiso/headless-ui prefix=jiso- effective-prefix=jiso- source=package-prefix-fact',
        'queries: dialogState',
        'fragments: jiso-dialog',
        '',
      ].join('\n'),
    });
  });

  it('explains mutation guards, writes, invalidations, and optimistic coverage', () => {
    expect(
      fwExplain(
        {
          mutations: [
            {
              enctype: 'multipart/form-data',
              fileFields: ['receipt'],
              guards: ['authed'],
              invalidates: ['cart'],
              inputFields: ['productId', 'quantity', 'receipt'],
              key: 'cart/add',
              manualInvalidates: ['product'],
              session: 'commerceSession',
              writes: ['cart', 'product'],
            },
          ],
          optimistic: [
            { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
            { mutation: 'cart/add', query: 'recommendations', status: 'await-fragment' },
            { mutation: 'cart/add', query: 'cart.discount', status: 'UNHANDLED' },
          ],
          components: [
            { name: 'CartBadge', queries: ['cart'] },
            { name: 'Recommendations', queries: ['recommendations'] },
          ],
          pages: [{ queries: ['cart'], route: '/cart' }],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'recommendations' },
          ],
        },
        { kind: 'mutation', optimistic: true, target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'session: commerceSession',
        'enctype: multipart/form-data',
        'input-fields: productId,quantity,receipt',
        'file-fields: receipt',
        'writes: cart,product',
        'invalidates: cart',
        'manual-invalidates: product',
        'updates: cart->component:CartBadge,page:/cart; recommendations->component:Recommendations',
        'OPTIMISTIC cart hand-written',
        'OPTIMISTIC recommendations await-fragment',
        'OPTIMISTIC-SUMMARY total=2 hand-written=1 await-fragment=1 UNHANDLED=0',
        '',
      ].join('\n'),
    });
  });

  it('explains missing optimistic coverage as derived UNHANDLED rows and ignores unrelated statuses', () => {
    expect(
      fwExplain(
        {
          mutations: [{ guards: ['authed'], invalidates: ['cart'], key: 'cart/add' }],
          optimistic: [
            { mutation: 'cart/add', query: 'recommendations', status: 'await-fragment' },
          ],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'recommendations' },
          ],
        },
        { kind: 'mutation', optimistic: true, target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: -',
        'invalidates: cart',
        'manual-invalidates: -',
        'updates: -',
        'OPTIMISTIC cart UNHANDLED',
        "  -> hand-write in the mutation module, or declare 'await-fragment'",
        'OPTIMISTIC-SUMMARY total=1 hand-written=0 await-fragment=0 UNHANDLED=1',
        '',
      ].join('\n'),
    });
  });

  it('audits unguarded mutations with stable explain output', () => {
    const result = fwExplain(
      {
        mutations: [
          {
            guards: ['rateLimit:session'],
            invalidates: ['cart'],
            key: 'cart/add',
            writes: ['cart'],
          },
          { guards: ['authed'], key: 'cart/remove' },
          { guards: ['role:admin'], key: 'admin/refund' },
          { key: 'inventory/sync', manualInvalidates: ['product'], writes: ['product'] },
        ],
      },
      { unguarded: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNGUARDED
      MUTATION cart/add guards=rateLimit:session writes=cart invalidates=cart manual-invalidates=-
      MUTATION inventory/sync guards=- writes=product invalidates=- manual-invalidates=product
      SUMMARY total=2
      "
    `);
  });

  it('treats mutation auth declarations as guarded audit facts', () => {
    const input = {
      mutations: [
        {
          auth: 'custom:better-auth-credential',
          invalidates: ['auth'],
          inputFields: ['email', 'password', 'next'],
          key: 'auth/sign-in',
          writes: ['auth'],
        },
      ],
    };

    expect(fwExplain(input, { kind: 'mutation', target: 'auth/sign-in' })).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION auth/sign-in',
        'guards: -',
        'auth: custom:better-auth-credential',
        'input-fields: email,password,next',
        'writes: auth',
        'invalidates: auth',
        'manual-invalidates: -',
        'updates: -',
        '',
      ].join('\n'),
    });
    expect(fwExplain(input, { unguarded: true })).toEqual({
      exitCode: 0,
      output: 'fw-explain/v1\nUNGUARDED\nSUMMARY total=0\n',
    });
  });

  it('audits unguarded queries and pages with stable explain output', () => {
    const result = fwExplain(
      {
        mutations: [
          { guards: ['authed'], key: 'cart/add' },
          { guards: ['rateLimit:session'], key: 'inventory/sync', writes: ['product'] },
        ],
        pages: [
          { guards: ['authed'], queries: ['cart'], route: '/cart' },
          { guards: [], queries: ['adminOrders'], route: '/admin' },
        ],
        queries: [
          { domains: ['cart'], guards: ['authed'], query: 'cart' },
          { domains: ['order'], guards: [], query: 'adminOrders' },
        ],
      },
      { unguarded: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNGUARDED
      MUTATION inventory/sync guards=rateLimit:session writes=product invalidates=- manual-invalidates=-
      PAGE /admin guards=- queries=adminOrders
      QUERY adminOrders guards=- reads=order
      SUMMARY total=3
      "
    `);
  });

  it('audits unguarded endpoints with stable explain output', () => {
    const result = fwExplain(
      {
        endpoints: [
          {
            auth: 'none',
            csrf: 'exempt',
            csrfJustification: 'oauth callback',
            method: 'GET',
            mount: 'prefix',
            name: 'auth/mount',
            path: '/auth',
          },
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
          },
        ],
      },
      { unguarded: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNGUARDED
      ENDPOINT auth/mount method=GET path=/auth mount=prefix auth=none csrf=exempt:oauth callback
      SUMMARY total=1
      "
    `);
  });

  it('prints all endpoints with stable explain output', () => {
    const result = fwExplain(
      {
        endpoints: [
          {
            auth: 'verifier:stripe-signature',
            csrf: 'exempt',
            csrfJustification: 'signed stripe webhook',
            method: 'POST',
            name: 'stripe/webhook',
            path: '/webhooks/stripe',
            writes: ['order'],
          },
          {
            auth: 'custom:api-key',
            csrf: 'checked',
            method: 'GET',
            name: 'inventory/export',
            path: '/exports/inventory.csv',
          },
        ],
      },
      { endpoints: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "fw-explain/v1
      ENDPOINTS
      ENDPOINT inventory/export method=GET path=/exports/inventory.csv mount=exact auth=custom:api-key csrf=checked writes=-
      ENDPOINT stripe/webhook method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature csrf=exempt:signed stripe webhook writes=order
      SUMMARY total=2
      "
    `);
  });

  it('accepts fw explain --endpoints as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-endpoints-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          endpoints: [
            {
              auth: 'verifier:stripe-signature',
              csrf: 'exempt',
              csrfJustification: 'signed stripe webhook',
              method: 'POST',
              name: 'stripe/webhook',
              path: '/webhooks/stripe',
              writes: ['order'],
            },
          ],
        }),
      );

      expect(main(['explain', '--endpoints', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toBe(
      [
        'fw-explain/v1',
        'ENDPOINTS',
        'ENDPOINT stripe/webhook method=POST path=/webhooks/stripe mount=exact auth=verifier:stripe-signature csrf=exempt:signed stripe webhook writes=order',
        'SUMMARY total=1',
        '',
      ].join('\n'),
    );
  });

  it('accepts fw explain --unguarded as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [
            { guards: ['authed'], key: 'cart/remove' },
            { guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] },
          ],
        }),
      );

      expect(main(['explain', '--unguarded', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNGUARDED
      MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-
      SUMMARY total=1
      "
    `);
  });

  it('fails fw explain --unguarded when requested and findings exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          mutations: [{ guards: ['rateLimit:session'], key: 'cart/add', writes: ['cart'] }],
        }),
      );

      expect(main(['explain', '--unguarded', '--fail-on-findings', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNGUARDED
      MUTATION cart/add guards=rateLimit:session writes=cart invalidates=- manual-invalidates=-
      SUMMARY total=1
      "
    `);
  });

  it('audits owner-scoped queries and writes with stable explain output', () => {
    const result = fwExplain(
      {
        ownerDomains: [{ domain: 'cart', owner: 'userId' }],
        scopeAudits: [
          {
            domain: 'cart',
            kind: 'write',
            name: 'cart.merge',
            scope: 'unknown',
            site: 'cart.domain.ts:30',
          },
          {
            detail: 'where eq(carts.id, args.cartId)',
            domain: 'cart',
            kind: 'query',
            name: 'cartById',
            scope: 'args',
            site: 'cart.queries.ts:21',
          },
          {
            domain: 'cart',
            kind: 'query',
            name: 'cart',
            scope: 'session',
            site: 'cart.queries.ts:8',
          },
          {
            domain: 'product',
            kind: 'query',
            name: 'productGrid',
            scope: 'unscoped',
            site: 'product.queries.ts:4',
          },
        ],
      },
      { unscoped: true },
    );

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNSCOPED
      UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21 where eq(carts.id, args.cartId)
      UNSCOPED WRITE cart.merge domain=cart scope=unknown site=cart.domain.ts:30
      SUMMARY total=2
      "
    `);
  });

  it('accepts fw explain --unscoped as a CLI audit mode', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stdout.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          ownerDomains: [{ domain: 'cart', owner: 'userId' }],
          scopeAudits: [
            {
              domain: 'cart',
              kind: 'query',
              name: 'cartById',
              scope: 'args',
              site: 'cart.queries.ts:21',
            },
          ],
        }),
      );

      expect(main(['explain', '--unscoped', graphPath])).toBe(0);
    } finally {
      stdoutWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNSCOPED
      UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21
      SUMMARY total=1
      "
    `);
  });

  it('fails fw explain --unscoped when requested and findings exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jiso-cli-'));
    const graphPath = join(tempDir, 'graph.json');
    let output = '';
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      output += chunk.toString();
      return true;
    }) as typeof process.stderr.write);

    try {
      writeFileSync(
        graphPath,
        JSON.stringify({
          ownerDomains: [{ domain: 'cart', owner: 'userId' }],
          scopeAudits: [
            {
              domain: 'cart',
              kind: 'query',
              name: 'cartById',
              scope: 'args',
              site: 'cart.queries.ts:21',
            },
          ],
        }),
      );

      expect(main(['explain', '--unscoped', '--fail-on-findings', graphPath])).toBe(1);
    } finally {
      stderrWrite.mockRestore();
      rmSync(tempDir, { force: true, recursive: true });
    }

    expect(output).toMatchInlineSnapshot(`
      "fw-explain/v1
      UNSCOPED
      UNSCOPED QUERY cartById domain=cart scope=args site=cart.queries.ts:21
      SUMMARY total=1
      "
    `);
  });

  it('explains query read sets with mutation invalidators separated per SPEC.md section 5.3', () => {
    expect(
      fwExplain(
        {
          components: [
            { name: 'Recommendations', queries: ['recommendations'] },
            { name: 'CartBadge', queries: ['cart'] },
          ],
          pages: [
            { queries: ['cart'], route: '/cart' },
            { queries: ['cart'], route: '/checkout' },
          ],
          queries: [{ domains: ['cart'], query: 'cart' }],
          touchGraph: {
            'cart.addItem': {
              touches: [
                {
                  domain: 'cart',
                  keys: null,
                  site: 'cart.domain.ts:1',
                  via: 'cart_items',
                },
              ],
              unresolved: [],
            },
          },
        },
        { kind: 'query', target: 'cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge,page:/cart,page:/checkout\ninvalidated-by: -\ndomain-writes: cart.addItem\n',
    });
  });

  it('explains query invalidations from declared mutation domains without a touch graph', () => {
    expect(
      fwExplain(
        {
          components: [{ name: 'CartBadge', queries: ['cart'] }],
          mutations: [
            { guards: ['authed'], key: 'cart/add', writes: ['cart'] },
            { guards: ['authed'], invalidates: ['cart'], key: 'cart/remove' },
          ],
          queries: [{ domains: ['cart'], query: 'cart' }],
        },
        { kind: 'query', target: 'cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nQUERY cart\nreads: cart\nconsumers: component:CartBadge\ninvalidated-by: cart/add,cart/remove\ndomain-writes: -\n',
    });
  });

  it('explains mutation updates from writes when invalidates are absent', () => {
    expect(
      fwExplain(
        {
          components: [{ name: 'CartBadge', queries: ['cart'] }],
          mutations: [{ guards: ['authed'], key: 'cart/add', writes: ['cart'] }],
          pages: [{ queries: ['cart'], route: '/checkout' }],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'productGrid' },
          ],
        },
        { kind: 'mutation', target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: cart',
        'invalidates: -',
        'manual-invalidates: -',
        'updates: cart->component:CartBadge,page:/checkout',
        '',
      ].join('\n'),
    });
  });

  it('explains mutation updates from writes even when invalidates are incomplete', () => {
    expect(
      fwExplain(
        {
          components: [
            { name: 'CartBadge', queries: ['cart'] },
            { name: 'ProductGrid', queries: ['productGrid'] },
          ],
          mutations: [
            {
              guards: ['authed'],
              invalidates: ['cart'],
              key: 'cart/add',
              writes: ['cart', 'product'],
            },
          ],
          queries: [
            { domains: ['cart'], query: 'cart' },
            { domains: ['product'], query: 'productGrid' },
          ],
        },
        { kind: 'mutation', target: 'cart/add' },
      ),
    ).toEqual({
      exitCode: 0,
      output: [
        'fw-explain/v1',
        'MUTATION cart/add',
        'guards: authed',
        'writes: cart,product',
        'invalidates: cart',
        'manual-invalidates: -',
        'updates: cart->component:CartBadge; productGrid->component:ProductGrid',
        '',
      ].join('\n'),
    });
  });

  it('explains page prefetch, modulepreload, and query payloads', () => {
    expect(
      fwExplain(
        {
          pages: [
            {
              i18n: ['en-US:cartLabel,productStock'],
              meta: {
                description: 'Browse products.',
                title: 'Jiso Commerce',
              },
              modulepreloads: ['/c/cart-badge.client.js'],
              prefetch: 'conservative',
              queries: ['cart'],
              route: '/cart',
              stylesheets: ['/assets/tailwind.css'],
              viewTransitions: ['product-p1-image'],
            },
          ],
        },
        { kind: 'page', target: '/cart' },
      ),
    ).toEqual({
      exitCode: 0,
      output:
        'fw-explain/v1\nPAGE /cart\nprefetch: conservative\nmeta: title=Jiso Commerce description=Browse products. image=-\ni18n: en-US:cartLabel,productStock\nmodulepreloads: /c/cart-badge.client.js\nstylesheets: /assets/tailwind.css\nqueries: cart\nview-transitions: product-p1-image\n',
    });
  });

  it('returns a stable not-found diagnostic for missing explain targets', () => {
    expect(fwExplain({}, { kind: 'component', target: 'Missing' })).toEqual({
      exitCode: 1,
      output: 'fw-explain/v1\nERROR NOT_FOUND component Missing\n',
    });
  });
});

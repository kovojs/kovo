import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diagnosticDefinitions } from '@jiso/core';
import { describe, expect, it } from 'vitest';

import { deriveAppGraph } from './graph.js';
import { compileComponentModule } from './index.js';
import { validatePackageComponentPrefixes } from './validate/package-prefixes.js';

const prefixFixtureSource = `
import { component } from '@jiso/core';

export const Shell = component('shell', {
  render: () => <section></section>,
});
`;

const fileName = 'components/shell.tsx';
const fw234 = diagnosticDefinitions.FW234;

describe('package component prefixes', () => {
  it('reports FW234 when component packages claim the same effective prefix', () => {
    const diagnostics = validatePackageComponentPrefixes(
      [
        { packageName: '@acme/primitives', prefix: 'acme-' },
        { packageName: '@other/acme-widgets', prefix: 'acme-' },
      ],
      fileName,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'FW234',
        fileName,
        help: expect.stringContaining(fw234.help),
        message: `${fw234.message} Effective package prefix "acme-" is claimed by @acme/primitives and @other/acme-widgets.`,
        severity: fw234.severity,
      }),
    ]);
    expect(diagnostics[0]?.help).toContain(
      'SPEC §6.1.1 keeps package prefixes app-wide unique because the effective prefix is emitted into rendered hosts, residual fw-c values, scoped CSS, and package behavior attributes.',
    );
    expect(diagnostics[0]?.help).toContain('effectivePrefix: "other-acme-"');
  });

  it('accepts an explicit package prefix alias as the collision escape hatch', () => {
    const result = compileComponentModule({
      fileName,
      packageComponentPrefixes: [
        { packageName: '@acme/primitives', prefix: 'acme-' },
        {
          effectivePrefix: 'other-acme-',
          packageName: '@other/acme-widgets',
          prefix: 'acme-',
        },
      ],
      source: prefixFixtureSource,
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('discovers imported package prefixes from real package manifests', () => {
    const root = mkdtempSync(join(tmpdir(), 'jiso-prefix-discovery-'));

    try {
      writePackageManifest(root, '@acme/primitives', {
        jiso: { prefix: 'acme-' },
        name: '@acme/primitives',
      });
      writePackageManifest(root, '@other/acme-widgets', {
        jiso: { prefix: 'acme-' },
        name: '@other/acme-widgets',
      });

      const result = compileComponentModule({
        fileName,
        packagePrefixDiscoveryRoot: root,
        source: `
import { component } from '@jiso/core';
import { Dialog } from '@acme/primitives/dialog';
import '@other/acme-widgets';

export const Shell = component('shell', {
  render: () => <section></section>,
});
`,
      });

      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          code: 'FW234',
          message: `${fw234.message} Effective package prefix "acme-" is claimed by @acme/primitives and @other/acme-widgets.`,
          severity: fw234.severity,
        }),
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('merges explicit effective-prefix aliases with discovered package manifests', () => {
    const root = mkdtempSync(join(tmpdir(), 'jiso-prefix-alias-'));

    try {
      writePackageManifest(root, '@acme/primitives', {
        jiso: { prefix: 'acme-' },
        name: '@acme/primitives',
      });
      writePackageManifest(root, '@other/acme-widgets', {
        jiso: { prefix: 'acme-' },
        name: '@other/acme-widgets',
      });

      const result = compileComponentModule({
        fileName,
        packageComponentPrefixes: [
          {
            effectivePrefix: 'other-acme-',
            packageName: '@other/acme-widgets',
          },
        ],
        packagePrefixDiscoveryRoot: root,
        source: `
import { component } from '@jiso/core';
import '@acme/primitives';
import '@other/acme-widgets';

export const Shell = component('shell', {
  render: () => <section></section>,
});
`,
      });

      expect(result.diagnostics).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('carries explicit package prefix facts into the app explain graph', () => {
    const derived = deriveAppGraph({
      graph: {
        components: [{ name: 'JisoDialog' }],
      },
      packageComponentPrefixes: [
        {
          packageName: '@jiso/headless-ui',
          prefix: 'jiso-',
        },
      ],
    });

    expect(derived.graph).toEqual({
      components: [{ name: 'JisoDialog' }],
      packageComponentPrefixes: [
        {
          packageName: '@jiso/headless-ui',
          prefix: 'jiso-',
        },
      ],
    });
  });

  it('reports FW234 when non-jiso packages use the reserved jiso prefix family', () => {
    const diagnostics = validatePackageComponentPrefixes(
      [
        { packageName: '@jiso/headless-ui', prefix: 'jiso-' },
        { packageName: '@acme/widgets', prefix: 'acme-', effectivePrefix: 'jiso-widgets-' },
      ],
      fileName,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'FW234',
        fileName,
        help: expect.stringContaining(fw234.help),
        message: `${fw234.message} @acme/widgets cannot use reserved jiso-* package prefix "jiso-widgets-".`,
        severity: fw234.severity,
      }),
    ]);
    expect(diagnostics[0]?.help).toContain(
      'SPEC §6.1.1 reserves the jiso-* prefix family for packages whose manifest name is in the @jiso/* scope.',
    );
  });

  it('reports FW234 when packages try to claim the framework fw attribute namespace', () => {
    const diagnostics = validatePackageComponentPrefixes(
      [{ packageName: '@acme/widgets', prefix: 'fw-' }],
      fileName,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'FW234',
        fileName,
        help: expect.stringContaining(fw234.help),
        message: `${fw234.message} @acme/widgets cannot use reserved fw-* package prefix "fw-".`,
        severity: fw234.severity,
      }),
    ]);
    expect(diagnostics[0]?.help).toContain(
      'SPEC §6.1.1 reserves the fw-* attribute namespace for framework-owned attributes and future loader/compiler growth.',
    );
  });

  it('reports FW234 for missing or invalid package prefix facts', () => {
    const diagnostics = validatePackageComponentPrefixes(
      [{ packageName: '@missing/prefix' }, { packageName: '@bad/prefix', prefix: 'BadPrefix' }],
      fileName,
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'FW234',
        message: `${fw234.message} @missing/prefix is imported as a component package but does not declare package.json jiso.prefix.`,
        severity: fw234.severity,
      }),
      expect.objectContaining({
        code: 'FW234',
        message: `${fw234.message} @bad/prefix declares invalid package.json jiso.prefix "BadPrefix".`,
        severity: fw234.severity,
      }),
    ]);
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

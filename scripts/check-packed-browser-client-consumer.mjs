#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestation,
} from './publish-packed-packages.mjs';
import { manifestPath, releasePackages, repoRoot } from './release-packages.mjs';

const BROWSER_PACKAGE = '@kovojs/browser';
const CORE_PACKAGE = '@kovojs/core';
const EXPECTED_CLIENT_EXPORTS = Object.freeze([
  'InstallKovoClientOptions',
  'KovoClient',
  'installKovoClient',
]);
const RETIRED_CLIENT_EXPORTS = Object.freeze([
  'BrowserEnhancedMutationOptions',
  'BrowserKovoRoot',
  'CreateBrowserKovoRootOptions',
  'EnhancedMutationFetch',
  'EnhancedMutationFetchOptions',
  'EnhancedMutationResponseLike',
  'KovoLoader',
  'KovoLoaderOptions',
  'QueryIdentity',
  'QuerySnapshot',
  'QueryStore',
  'QueryUpdatePlan',
  'UploadProgress',
  'createBrowserKovoRoot',
  'createQueryStore',
  'defaultEnhancedFetch',
  'installKovoLoader',
]);

export function assertPackedBrowserClientManifest(manifest) {
  if (manifest?.name !== BROWSER_PACKAGE || typeof manifest.version !== 'string') {
    throw new Error('Packed browser manifest has the wrong package identity');
  }
  const client = manifest.exports?.['./client'];
  if (client?.types !== './dist/client.d.mts' || client?.default !== './dist/client.mjs') {
    throw new Error('Packed browser client does not resolve built runtime and declarations');
  }
  const authoring = manifest.exports?.['.'];
  if (authoring?.types !== './dist/index.d.mts' || authoring?.default !== './dist/index.mjs') {
    throw new Error(
      'Packed browser authoring root does not resolve built runtime and declarations',
    );
  }
  if (
    manifest.dependencies?.[CORE_PACKAGE] === undefined ||
    Object.keys(manifest.dependencies).some((name) => name.startsWith('node:'))
  ) {
    throw new Error('Packed browser dependencies do not preserve the browser/core boundary');
  }
}

export function packedBrowserClientDeclarationExports(source) {
  const sourceFile = parseClientDeclarations(source);
  const names = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) {
      names.push(element.name.text);
    }
  }
  return [...new Set(names)].sort(compareStrings);
}

export function assertPackedBrowserClientDeclarations(source) {
  const exports = packedBrowserClientDeclarationExports(source);
  if (JSON.stringify(exports) !== JSON.stringify([...EXPECTED_CLIENT_EXPORTS])) {
    throw new Error(`Packed browser client declarations drifted: ${JSON.stringify(exports)}`);
  }
  const sourceFile = parseClientDeclarations(source);
  const retired = new Set(RETIRED_CLIENT_EXPORTS);
  let retiredReference;
  let exposesAny = false;
  function visit(node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) exposesAny = true;
    if (ts.isIdentifier(node) && retired.has(node.text)) retiredReference = node.text;
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (retiredReference !== undefined) {
    throw new Error(`Packed browser client declarations retain retired ${retiredReference}`);
  }
  if (exposesAny) {
    throw new Error('Packed browser client declarations expose unapproved any');
  }
}

function parseClientDeclarations(source) {
  return ts.createSourceFile(
    'client.d.mts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

export function assertPackedBrowserModulesHaveNoNodeBuiltins(entries) {
  const findings = [];
  for (const entry of entries) {
    if (!entry.name.startsWith('package/dist/') || !entry.name.endsWith('.mjs')) continue;
    const source = entry.data.toString('utf8');
    if (/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]node:/u.test(source)) {
      findings.push(entry.name);
    }
  }
  if (findings.length > 0) {
    throw new Error(`Packed browser modules import Node builtins: ${findings.join(', ')}`);
  }
}

export function checkPackedBrowserClientConsumer() {
  const packedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packages = validatePackedReleaseManifest(packedManifest, releasePackages());
  const browser = packages.find((pkg) => pkg.name === BROWSER_PACKAGE);
  const core = packages.find((pkg) => pkg.name === CORE_PACKAGE);
  if (!browser || !core) {
    throw new Error('Packed release manifest is missing browser or core');
  }
  const browserAttestation = verifyPackedAttestation(
    browser,
    path.resolve(repoRoot, browser.tarball),
  );
  const coreAttestation = verifyPackedAttestation(core, path.resolve(repoRoot, core.tarball));
  assertPackedBrowserClientManifest(browser.manifest);
  assertPackedBrowserModulesHaveNoNodeBuiltins(browserAttestation.entries);

  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-browser-client-'));
  try {
    materializePackage(browserAttestation.entries, packageRoot(consumerRoot, BROWSER_PACKAGE));
    materializePackage(coreAttestation.entries, packageRoot(consumerRoot, CORE_PACKAGE));
    const declarationPath = path.join(
      packageRoot(consumerRoot, BROWSER_PACKAGE),
      'dist',
      'client.d.mts',
    );
    assertPackedBrowserClientDeclarations(readFileSync(declarationPath, 'utf8'));
    assertPackedTypeConsumer(consumerRoot);
    assertPackedRuntimeConsumer(consumerRoot);
    process.stdout.write(
      'Packed browser client/authoring consumer passed (opaque derives, structured trust metadata, 3 client declarations, 0 Node builtins).\n',
    );
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
}

function materializePackage(entries, destinationRoot) {
  for (const entry of entries) {
    if (!entry.name.startsWith('package/') || entry.name.endsWith('/')) continue;
    const relative = entry.name.slice('package/'.length);
    const destination = path.resolve(destinationRoot, ...relative.split('/'));
    if (
      destination !== destinationRoot &&
      !destination.startsWith(`${destinationRoot}${path.sep}`)
    ) {
      throw new Error('Packed browser consumer entry escapes its package root');
    }
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, entry.data);
  }
}

function packageRoot(consumerRoot, packageName) {
  return path.join(consumerRoot, 'node_modules', ...packageName.split('/'));
}

function assertPackedTypeConsumer(consumerRoot) {
  const sourcePath = path.join(consumerRoot, 'consumer.ts');
  writeFileSync(
    sourcePath,
    [
      "import { installKovoClient, type InstallKovoClientOptions, type KovoClient } from '@kovojs/browser/client';",
      "import { derive, trustedHtml, trustedUrl, type DeriveInput, type TrustedOutputMetadata } from '@kovojs/browser';",
      "import type { OptimisticFor as GeneratedOptimisticFor } from '@kovojs/browser/generated';",
      '// @ts-expect-error low-level optimism plans are not browser-root authoring API.',
      "import type { MutationChangeRecord as RetiredMutationChangeRecord } from '@kovojs/browser';",
      '// @ts-expect-error low-level optimism plans are not browser-root authoring API.',
      "import type { OptimisticChange as RetiredOptimisticChange } from '@kovojs/browser';",
      '// @ts-expect-error low-level optimism plans are not browser-root authoring API.',
      "import type { OptimisticEntry as RetiredOptimisticEntry } from '@kovojs/browser';",
      '// @ts-expect-error OptimisticFor is retained only as compiler-generated ABI.',
      "import type { OptimisticFor as RetiredRootOptimisticFor } from '@kovojs/browser';",
      '// @ts-expect-error low-level optimism plans are not browser-root authoring API.',
      "import type { OptimisticPlan as RetiredOptimisticPlan } from '@kovojs/browser';",
      '// @ts-expect-error low-level optimism plans are not browser-root authoring API.',
      "import type { OptimisticQueryKey as RetiredOptimisticQueryKey } from '@kovojs/browser';",
      '// @ts-expect-error low-level optimism plans are not browser-root authoring API.',
      "import type { OptimisticTransform as RetiredOptimisticTransform } from '@kovojs/browser';",
      'declare const root: EventTarget & ParentNode;',
      "declare const cart: { readonly key: 'cart'; readonly result?: { count: number } };",
      'declare const generatedOptimism: GeneratedOptimisticFor<any, Record<string, unknown>>;',
      'const options: InstallKovoClientOptions = { root };',
      'const client: KovoClient = installKovoClient(options);',
      "const cartInput: DeriveInput<'cart', { count: number }> = derive.query(cart);",
      'const label = derive([cartInput, derive.state<{ selected: boolean }>()], (value, state) => state.selected ? `${value.count} selected` : `${value.count} items`);',
      'const summary = derive({ basket: cartInput, now: derive.clock<Date>() }, ({ basket, now }) => `${basket.count}:${now.toISOString()}`);',
      "const metadata: TrustedOutputMetadata = { reason: 'reviewed packed consumer output', source: 'consumer.ts' };",
      "trustedHtml('<strong>safe</strong>', metadata);",
      "trustedUrl('https://example.test/checkout', { reason: 'allowlisted packed checkout redirect' });",
      '// @ts-expect-error public derive inputs are opaque handles, not raw runtime names',
      "derive(['cart'], (value) => value);",
      '// @ts-expect-error trust metadata is required and string shorthand is retired',
      "trustedHtml('<strong>unsafe</strong>', 'reviewed');",
      'void label;',
      'void summary;',
      'void generatedOptimism;',
      'void (null as unknown as RetiredMutationChangeRecord);',
      'void (null as unknown as RetiredOptimisticChange);',
      'void (null as unknown as RetiredOptimisticEntry);',
      'void (null as unknown as RetiredRootOptimisticFor);',
      'void (null as unknown as RetiredOptimisticPlan);',
      'void (null as unknown as RetiredOptimisticQueryKey);',
      'void (null as unknown as RetiredOptimisticTransform);',
      "void client.dispose('abort');",
      '',
    ].join('\n'),
  );
  const program = ts.createProgram([sourcePath], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    throw new Error(
      `Packed browser client type consumer failed:\n${ts.formatDiagnosticsWithColorAndContext(
        diagnostics,
        {
          getCanonicalFileName: (fileName) => fileName,
          getCurrentDirectory: () => consumerRoot,
          getNewLine: () => '\n',
        },
      )}`,
    );
  }
}

function assertPackedRuntimeConsumer(consumerRoot) {
  const source = [
    "import * as clientApi from '@kovojs/browser/client';",
    "import { derive, trustedHtml, trustedUrl } from '@kovojs/browser';",
    "if (JSON.stringify(Object.keys(clientApi).sort()) !== JSON.stringify(['installKovoClient'])) throw new Error('runtime exports drifted');",
    "const count = derive([derive.query({ key: 'cart' })], (cart) => cart.count);",
    "if (count.run({ count: 2 }) !== 2) throw new Error('derive runtime drifted');",
    "if (trustedHtml('<b>safe</b>', { reason: 'reviewed packed output' }).reason !== 'reviewed packed output') throw new Error('trustedHtml metadata drifted');",
    "if (trustedUrl('/checkout', { reason: 'reviewed packed redirect' }).reason !== 'reviewed packed redirect') throw new Error('trustedUrl metadata drifted');",
    'class Root extends EventTarget { querySelectorAll() { return []; } }',
    'const root = new Root();',
    'const client = clientApi.installKovoClient({ importModule: async () => ({}), root });',
    'await client.ready;',
    "await client.dispose('abort');",
    "process.stdout.write('packed-browser-client/v1 OK\\n');",
    '',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: consumerRoot,
    encoding: 'utf8',
  });
  if (
    result.error ||
    result.status !== 0 ||
    result.stderr !== '' ||
    result.stdout !== 'packed-browser-client/v1 OK\n'
  ) {
    throw new Error(
      `Packed browser client runtime consumer failed: ${result.error?.message ?? result.stderr}`,
    );
  }
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

if (isMainEntry(import.meta.url)) await runGate(checkPackedBrowserClientConsumer);

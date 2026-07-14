#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { generatedProdEmitInput, validateGeneratedEmitContract } from './generated-artifacts.mjs';

export async function loadCompileComponentModule() {
  const { compileComponentModule } = await import('../dist/compiler/src/index.mjs');
  return compileComponentModule;
}

export async function loadCreateApp() {
  const { createApp } = await import('../dist/server/src/index.mjs');
  return createApp;
}

export async function runProdEmitCheck({
  compileComponentModule,
  createApp,
  stdout = process.stdout,
} = {}) {
  const compile = compileComponentModule ?? (await loadCompileComponentModule());
  const createAppExport = createApp ?? (await loadCreateApp());
  assert.equal(
    typeof createAppExport,
    'function',
    'dist/server createApp export must be a function',
  );
  const result = compile(generatedProdEmitInput);
  assert.deepEqual(validateGeneratedEmitContract(result.files), []);
  stdout.write('prod-emit-check/v1\n');
  stdout.write('OK\n');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runProdEmitCheck().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}

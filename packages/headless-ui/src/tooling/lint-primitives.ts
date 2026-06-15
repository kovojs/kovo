#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  formatPrimitiveHandlerLintFindings,
  lintPrimitiveHandlers,
  type PrimitiveHandlerLintFinding,
  type PrimitiveHandlerLintInput,
} from './primitive-handler-lint.js';

export interface PrimitiveHandlerPackageLintOptions {
  packageRoot?: string | URL;
}

export interface PrimitiveHandlerPackageLintResult {
  files: PrimitiveHandlerLintInput[];
  findings: PrimitiveHandlerLintFinding[];
}

export interface PrimitiveHandlerLintCommandResult {
  errorOutput: string;
  exitCode: 0 | 1;
  output: string;
}

const packageRootUrl = new URL('../../', import.meta.url);
const sourceExtensions = ['.ts', '.tsx'] as const;
const usage = 'Usage: lint:primitives [--package-root <path>]';

export function lintPrimitiveHandlerPackageSources(
  options: PrimitiveHandlerPackageLintOptions = {},
): PrimitiveHandlerPackageLintResult {
  const packageRoot = normalizeRoot(options.packageRoot ?? packageRootUrl);
  const sourceRoot = resolve(packageRoot, 'src');
  const files = collectPrimitiveSourceInputs(packageRoot, sourceRoot);

  return {
    files,
    findings: lintPrimitiveHandlers(files),
  };
}

export function runPrimitiveHandlerLintCommand(
  args: readonly string[] = process.argv.slice(2),
): PrimitiveHandlerLintCommandResult {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    return {
      errorOutput: `${usage}\n${parsed.error}\n`,
      exitCode: 1,
      output: '',
    };
  }

  const result = lintPrimitiveHandlerPackageSources(
    parsed.packageRoot === undefined ? {} : { packageRoot: parsed.packageRoot },
  );
  if (result.findings.length > 0) {
    return {
      errorOutput: `${formatPrimitiveHandlerLintFindings(result.findings)}\n`,
      exitCode: 1,
      output: '',
    };
  }

  const fileLabel = result.files.length === 1 ? 'file' : 'files';
  return {
    errorOutput: '',
    exitCode: 0,
    output: `primitive-handler-lint: checked ${result.files.length} ${fileLabel}, found 0 issues\n`,
  };
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const result = runPrimitiveHandlerLintCommand(args);
  if (result.output) process.stdout.write(result.output);
  if (result.errorOutput) process.stderr.write(result.errorOutput);
  return result.exitCode;
}

function collectPrimitiveSourceInputs(
  packageRoot: string,
  directory: string,
): PrimitiveHandlerLintInput[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return collectPrimitiveSourceInputs(packageRoot, path);
      if (!entry.isFile() || !isSourceFile(entry.name)) return [];
      if (!isPrimitiveImplementationSource(packageRoot, path)) return [];

      return [
        {
          path: relative(packageRoot, path),
          source: readFileSync(path, 'utf8'),
        },
      ];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function isSourceFile(fileName: string): boolean {
  return sourceExtensions.some((extension) => fileName.endsWith(extension));
}

function isPrimitiveImplementationSource(packageRoot: string, path: string): boolean {
  const relativePath = relative(packageRoot, path);
  return (
    relativePath.startsWith('src/primitives/') &&
    !relativePath.endsWith('.test.ts') &&
    !relativePath.endsWith('.test.tsx') &&
    relativePath !== 'src/primitives/index.ts'
  );
}

type ParsedArgs = { ok: true; packageRoot?: string } | { error: string; ok: false };

function parseArgs(args: readonly string[]): ParsedArgs {
  let packageRoot: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== '--package-root') return { error: `Unknown argument: ${arg ?? ''}`, ok: false };

    const value = args[index + 1];
    if (value === undefined) {
      return { error: '--package-root requires a path', ok: false };
    }
    packageRoot = value;
    index += 1;
  }

  return packageRoot === undefined ? { ok: true } : { ok: true, packageRoot };
}

function normalizeRoot(root: string | URL): string {
  if (typeof root === 'string') return resolve(root);
  return fileURLToPath(root);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

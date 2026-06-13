#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CreateJisoOptions {
  name: string;
}

export interface GeneratedFile {
  path: string;
  source: string;
}

export interface CreateJisoProject {
  files: GeneratedFile[];
  name: string;
}

export interface WriteJisoProjectResult {
  files: string[];
  name: string;
  root: string;
}

const templateRoot = new URL('../templates/', import.meta.url);
const templateFiles = [
  'package.json',
  'vite.config.ts',
  '.github/workflows/ci.yml',
  'README.md',
  'graph.json',
  'scripts/export-static.mjs',
  'scripts/preview-static.mjs',
  'scripts/serve.mjs',
  'scripts/emit-graph.mjs',
  'scripts/graph-assertions.mjs',
  'docs/graph-assertions.md',
  'docs/deployment.md',
  'docs/framework-rules.md',
  'src/styles.css',
  'src/client.ts',
  'index.html',
  'src/app.tsx',
  'src/app-shell.ts',
  'src/app-shell.test.ts',
  'src/auth.tsx',
  'src/app.fixpoint.test.ts',
] as const;

export function createJisoProject(options: CreateJisoOptions): CreateJisoProject {
  const packageName = normalizePackageName(options.name);
  const values = { name: packageName };

  return {
    files: templateFiles.map((path) => ({
      path,
      source: renderTemplate(readTemplate(path), values),
    })),
    name: packageName,
  };
}

export function writeJisoProject(
  targetDirectory: string,
  options: Partial<CreateJisoOptions> = {},
): WriteJisoProjectResult {
  const root = resolve(targetDirectory);
  const name = options.name ?? basename(root);
  const project = createJisoProject({ name });

  assertWritableTarget(root);

  for (const file of project.files) {
    const destination = resolve(root, file.path);

    const relativeDestination = relative(root, destination);

    if (
      relativeDestination === '' ||
      relativeDestination.startsWith('..') ||
      isAbsolute(relativeDestination)
    ) {
      throw new Error(`Refusing to write outside target directory: ${file.path}`);
    }

    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.source, 'utf8');
  }

  return {
    files: project.files.map((file) => file.path),
    name: project.name,
    root,
  };
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  const [targetDirectory, ...rest] = args;

  if (!targetDirectory || targetDirectory === '--help' || targetDirectory === '-h') {
    process.stdout.write('usage: create-jiso <target-directory> [--name <package-name>]\n');
    return targetDirectory ? 0 : 1;
  }

  const name = readNameOption(rest);

  try {
    const result = writeJisoProject(targetDirectory, name ? { name } : {});
    process.stdout.write(`create-jiso: wrote ${result.files.length} files to ${result.root}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `create-jiso: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

function readTemplate(path: string): string {
  return readFileSync(new URL(path, templateRoot), 'utf8');
}

function renderTemplate(source: string, values: Record<string, string>): string {
  return source.replaceAll(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) {
      throw new Error(`Unknown create-jiso template variable: ${key}`);
    }
    return value;
  });
}

function normalizePackageName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');

  return normalized || 'jiso-app';
}

function assertWritableTarget(root: string): void {
  if (!existsSync(root)) {
    return;
  }

  const stats = statSync(root);

  if (!stats.isDirectory()) {
    throw new Error(`Target exists and is not a directory: ${root}`);
  }

  const existingEntries = readdirSync(root);

  if (existingEntries.length > 0) {
    throw new Error(`Target directory is not empty: ${root}`);
  }
}

function readNameOption(args: readonly string[]): string | undefined {
  let name: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--name') {
      name = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith('--name=')) {
      name = arg.slice('--name='.length);
    }
  }

  return name;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { htmlMainMarkerFact, type HtmlMainMarkerFact } from './html-fragment.ts';

export interface FwExportHtmlArtifact {
  bytes: number;
  path: string;
  status: number;
}

export interface FwExportError {
  code: string;
  message: string;
  route: string;
}

export type FwExportSummary = Record<string, string>;

export interface FwExportOutput {
  errors: FwExportError[];
  html: FwExportHtmlArtifact[];
  summary?: FwExportSummary;
  version: 'fw-export/v1';
}

export interface FwExportCliResultLike {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface FwExportCliArtifactFact {
  bytesArePositive: boolean;
  path: string;
  status: number;
}

export interface FwExportCliResultFact {
  errors: FwExportError[];
  exitCode: number;
  html: FwExportCliArtifactFact[];
  outputStream: 'stderr' | 'stdout';
  summary?: FwExportSummary;
  version: 'fw-export/v1';
}

export interface FwExportStaticDiagnosticLike {
  code: string;
  fileName: string;
  help?: string;
  message: string;
  severity?: string;
  start?: { column: number; line: number };
}

export interface FwExportStaticBehaviorFact {
  api: {
    greenArtifactBodyMatchesDisk: boolean;
    greenArtifactDiagnostics: number;
    greenArtifactPath: string | undefined;
    greenMarker: HtmlMainMarkerFact;
    redArtifactWritten: boolean;
    redError: {
      code: string | undefined;
      diagnosticCodes: string[];
      message: string;
      name: string | undefined;
    };
  };
  cli: {
    green: FwExportCliResultFact;
    greenMarker: HtmlMainMarkerFact;
    red: FwExportCliResultFact;
    redArtifactWritten: boolean;
  };
}

export interface FwExportStaticBehaviorOptions {
  appCoreModuleUrl: string;
  cliMarker?: string;
  createApp: (options: { routes: unknown[] }) => unknown;
  errorDiagnostic: FwExportStaticDiagnosticLike;
  expectedStaticExportCliError: string;
  expectedStaticExportError: string;
  exportStaticApp: (
    app: unknown,
    options: { diagnostics: FwExportStaticDiagnosticLike[]; outDir: string },
  ) => Promise<{
    artifacts: Array<{ body: string; path: string }>;
    diagnostics: unknown[];
  }>;
  fixturePrefix?: string;
  lintDiagnostic: FwExportStaticDiagnosticLike;
  markerAttribute?: string;
  runCliCommand: (args: string[]) => Promise<FwExportCliResultLike>;
  serverModuleUrl: string;
  serverRoute: (path: string, options: { page: () => string }) => unknown;
}

export function parseFwExportOutput(output: string): FwExportOutput {
  const lines = output.trimEnd().split('\n');
  const version = lines[0];
  if (version !== 'fw-export/v1') {
    throw new Error(`fw export output starts with fw-export/v1: ${version ?? ''}`);
  }

  const errors: FwExportError[] = [];
  const html: FwExportHtmlArtifact[] = [];
  let summary: FwExportSummary | undefined;

  for (const line of lines.slice(1)) {
    if (line.startsWith('HTML ')) {
      html.push(parseFwExportHtmlLine(line));
      continue;
    }

    if (line.startsWith('ERROR ')) {
      errors.push(parseFwExportErrorLine(line));
      continue;
    }

    if (line.startsWith('SUMMARY ')) {
      summary = parseKeyValueFields(line.slice('SUMMARY '.length));
      continue;
    }

    if (line.length === 0) continue;

    const lastError = errors[errors.length - 1];
    if (!lastError) {
      throw new Error(`Unrecognized fw export output line: ${line}`);
    }
    lastError.message += `\n${line}`;
  }

  return summary === undefined ? { errors, html, version } : { errors, html, summary, version };
}

export function fwExportCliResultFact(result: FwExportCliResultLike): FwExportCliResultFact {
  const outputStream = fwExportOutputStream(result);
  const output = outputStream === 'stdout' ? result.stdout : result.stderr;
  const parsed = parseFwExportOutput(output);

  return {
    errors: parsed.errors,
    exitCode: result.exitCode,
    html: parsed.html.map((artifact) => ({
      bytesArePositive: artifact.bytes > 0,
      path: artifact.path,
      status: artifact.status,
    })),
    outputStream,
    ...(parsed.summary === undefined ? {} : { summary: parsed.summary }),
    version: parsed.version,
  };
}

export async function fwExportStaticBehaviorFact({
  appCoreModuleUrl,
  cliMarker = 'cli',
  createApp,
  errorDiagnostic,
  expectedStaticExportCliError,
  expectedStaticExportError,
  exportStaticApp,
  fixturePrefix = 'jiso-fw-export-',
  lintDiagnostic,
  markerAttribute = 'data-fw-check-export',
  runCliCommand,
  serverModuleUrl,
  serverRoute,
}: FwExportStaticBehaviorOptions): Promise<FwExportStaticBehaviorFact> {
  const apiOutDir = await mkdtemp(join(tmpdir(), `${fixturePrefix}api-`));
  const app = createApp({
    routes: [
      serverRoute('/', {
        page: () => `<main ${markerAttribute}="api"></main>`,
      }),
    ],
  });

  try {
    let redError: FwExportStaticBehaviorFact['api']['redError'] | undefined;
    try {
      await exportStaticApp(app, { diagnostics: [errorDiagnostic], outDir: apiOutDir });
    } catch (error) {
      const exportError = error as {
        code?: string;
        diagnostics?: FwExportStaticDiagnosticLike[];
        message?: string;
        name?: string;
      };
      redError = {
        code: exportError.code,
        diagnosticCodes: exportError.diagnostics?.map((diagnostic) => diagnostic.code) ?? [],
        message: String(exportError.message ?? error),
        name: exportError.name,
      };
    }
    if (!redError) {
      throw new Error('static export red path rejects diagnostics');
    }
    if (redError.message !== expectedStaticExportError) {
      throw new Error(`static export red message mismatch: ${redError.message}`);
    }

    const apiRedArtifactWritten = await fileExists(join(apiOutDir, 'index.html'));
    const exported = await exportStaticApp(app, {
      diagnostics: [lintDiagnostic],
      outDir: apiOutDir,
    });
    const exportedHtml = await readFile(join(apiOutDir, 'index.html'), 'utf8');

    const cliFixtureRoot = await mkdtemp(join(tmpdir(), `${fixturePrefix}cli-`));
    try {
      const cliRedOutDir = join(cliFixtureRoot, 'red-out');
      const cliGreenOutDir = join(cliFixtureRoot, 'green-out');
      const cliRedModule = join(cliFixtureRoot, 'red-app.mjs');
      const cliGreenModule = join(cliFixtureRoot, 'green-app.mjs');
      const cliAppModuleSource = (diagnostics: FwExportStaticDiagnosticLike[]) => `
import { route as serverRoute } from ${JSON.stringify(serverModuleUrl)};
import { createApp } from ${JSON.stringify(appCoreModuleUrl)};

export const diagnostics = ${JSON.stringify(diagnostics, null, 2)};

export default createApp({
  routes: [
    serverRoute('/', {
      page: () => '<main ${markerAttribute}="${cliMarker}"></main>',
    }),
  ],
});
`;

      await writeFile(cliRedModule, cliAppModuleSource([errorDiagnostic]), 'utf8');
      const red = fwExportCliResultFact(
        await runCliCommand(['export', cliRedModule, '--out', cliRedOutDir]),
      );
      if (red.errors[0]?.message !== expectedStaticExportCliError) {
        throw new Error(`fw export CLI red message mismatch: ${red.errors[0]?.message ?? ''}`);
      }

      await writeFile(cliGreenModule, cliAppModuleSource([lintDiagnostic]), 'utf8');
      const green = fwExportCliResultFact(
        await runCliCommand(['export', cliGreenModule, '--out', cliGreenOutDir]),
      );
      const cliGreenHtml = await readFile(join(cliGreenOutDir, 'index.html'), 'utf8');

      return {
        api: {
          greenArtifactBodyMatchesDisk: exported.artifacts[0]?.body === exportedHtml,
          greenArtifactDiagnostics: exported.diagnostics.length,
          greenArtifactPath: exported.artifacts[0]?.path,
          greenMarker: htmlMainMarkerFact(exportedHtml),
          redArtifactWritten: apiRedArtifactWritten,
          redError,
        },
        cli: {
          green,
          greenMarker: htmlMainMarkerFact(cliGreenHtml),
          red,
          redArtifactWritten: await fileExists(join(cliRedOutDir, 'index.html')),
        },
      };
    } finally {
      await rm(cliFixtureRoot, { force: true, recursive: true });
    }
  } finally {
    await rm(apiOutDir, { force: true, recursive: true });
  }
}

function fwExportOutputStream(result: FwExportCliResultLike): 'stderr' | 'stdout' {
  const hasStdout = result.stdout.trim().length > 0;
  const hasStderr = result.stderr.trim().length > 0;

  if (hasStdout && hasStderr) {
    throw new Error('fw export CLI result writes structured output to exactly one stream');
  }
  if (hasStdout) return 'stdout';
  if (hasStderr) return 'stderr';

  throw new Error('fw export CLI result includes structured output');
}

function parseFwExportHtmlLine(line: string): FwExportHtmlArtifact {
  const match = /^HTML (?<path>\S+) status=(?<status>\d+) bytes=(?<bytes>\d+)$/.exec(line);
  if (!match?.groups) {
    throw new Error(`Malformed fw export HTML line: ${line}`);
  }

  return {
    bytes: Number(match.groups.bytes),
    path: match.groups.path ?? '',
    status: Number(match.groups.status),
  };
}

function parseFwExportErrorLine(line: string): FwExportError {
  const match = /^ERROR (?<code>\S+) route=(?<route>\S+)(?: (?<message>.*))?$/.exec(line);
  if (!match?.groups) {
    throw new Error(`Malformed fw export ERROR line: ${line}`);
  }

  return {
    code: match.groups.code ?? '',
    message: match.groups.message ?? '',
    route: match.groups.route ?? '',
  };
}

function parseKeyValueFields(source: string): FwExportSummary {
  const fields: FwExportSummary = {};
  let cursor = 0;

  while (cursor < source.length) {
    while (source[cursor] === ' ') cursor += 1;
    if (cursor >= source.length) break;

    const keyStart = cursor;
    while (cursor < source.length && source[cursor] !== '=' && source[cursor] !== ' ') {
      cursor += 1;
    }
    const key = source.slice(keyStart, cursor);
    if (!key || source[cursor] !== '=') {
      throw new Error(`Malformed fw export summary field near: ${source.slice(keyStart)}`);
    }
    cursor += 1;

    const valueStart = cursor;
    if (source[cursor] === '"') {
      cursor += 1;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source[cursor] === '"') {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      fields[key] = source.slice(valueStart, cursor);
      continue;
    }

    while (cursor < source.length && source[cursor] !== ' ') cursor += 1;
    fields[key] = source.slice(valueStart, cursor);
  }

  return fields;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

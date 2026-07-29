#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import packageMetadata from '../package.json' with { type: 'json' };

import { readBoundedRegularFileSnapshot } from './file-snapshot.js';
import {
  formatCertificateVerification,
  type KovoCertificateVerificationResult,
  verifyCertificateDirectory,
} from './index.js';

const MAX_CERTIFICATE_BYTES = 2 * 1024 * 1024;
const MAX_POLICY_BYTES = 1024 * 1024;
const REPORT_SCHEMA = 'kovo.verify-report/v1';
const COMMAND_ERROR_SCHEMA = 'kovo.verify-command-error/v1';
const DIAGNOSTIC_SCHEMA = 'kovo-diagnostic/v1';
const COMMAND_VERSION = packageMetadata.version;
const USAGE = 'kovo-verify <certificate.json> --policy <policy.json> --artifacts <root>';
const HELP = `Verify a Kovo release certificate against an independently obtained policy.

Usage:
  ${USAGE} [--format <human|json|github>]

Arguments:
  <certificate.json>  Certificate bytes to check.

Options:
  --policy <path>     Independently obtained kovo.certificate-policy/v1 bytes.
  --artifacts <root>  Unpacked package tree containing the exact reviewed artifacts.
  --format <format>   Report format: human (default), json, or github.
  -h, --help          Show this help.
  --version           Show the installed command version.

The certificate argument and the --policy, --artifacts, and --format flag groups
may appear in any order. Use -- before a certificate path that begins with "-".

Exit codes:
  0  Certificate verified.
  1  Certificate findings were reported.
  2  Usage, I/O, or parse error; verification was indeterminate.
`;

type KovoVerifyFormat = 'github' | 'human' | 'json';

interface KovoVerifyRequest {
  artifactRoot: string;
  certificatePath: string;
  format: KovoVerifyFormat;
  policyPath: string;
}

type ParsedKovoVerifyArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'verify'; request: KovoVerifyRequest }
  | { format: KovoVerifyFormat; kind: 'usage-error'; message: string };

/** Injectable text sinks for the stable `kovo-verify` command contract. */
export interface KovoVerifyIo {
  stderr(text: string): void;
  stdout(text: string): void;
}

/**
 * Run the standalone command contract from SPEC §6.6.
 *
 * Verification reports are written to stdout and return 0 or 1. Usage, I/O, and parse failures
 * are indeterminate rather than certificate findings, so they are written to stderr and return 2.
 */
export async function runKovoVerify(
  args: readonly string[],
  io: KovoVerifyIo = {
    stderr: (text) => process.stderr.write(text),
    stdout: (text) => process.stdout.write(text),
  },
): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.kind === 'help') {
    io.stdout(HELP);
    return 0;
  }
  if (parsed.kind === 'version') {
    io.stdout(`kovo-verify ${COMMAND_VERSION}\n`);
    return 0;
  }
  if (parsed.kind === 'usage-error') {
    io.stderr(formatCommandError(parsed.message, parsed.format));
    return 2;
  }
  const request = parsed.request;
  try {
    const certificateBytes = readBoundedEvidenceFile(
      request.certificatePath,
      MAX_CERTIFICATE_BYTES,
      'certificate',
    );
    const certificate = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(certificateBytes),
    ) as unknown;
    const policyBytes = readBoundedEvidenceFile(request.policyPath, MAX_POLICY_BYTES, 'policy');
    const result = await verifyCertificateDirectory(certificate, policyBytes, request.artifactRoot);
    io.stdout(formatVerification(result, request.format));
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr(
      formatCommandError(
        error instanceof Error ? error.message : 'verification failed',
        request.format,
      ),
    );
    return 2;
  }
}

function readBoundedEvidenceFile(filePath: string, maxBytes: number, label: string): Uint8Array {
  return readBoundedRegularFileSnapshot(filePath, maxBytes, label).bytes;
}

function parseArgs(args: readonly string[]): ParsedKovoVerifyArgs {
  if (args.includes('-h') || args.includes('--help')) return { kind: 'help' };
  if (args.includes('--version')) return { kind: 'version' };

  const errorFormat = requestedErrorFormat(args);
  let artifactRoot: string | undefined;
  let certificatePath: string | undefined;
  let format: KovoVerifyFormat = 'human';
  let formatSeen = false;
  let policyPath: string | undefined;
  let positionalOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined || argument === '') {
      return usageError('arguments must not be empty', errorFormat);
    }
    if (!positionalOnly && argument === '--') {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && argument.startsWith('-')) {
      if (!['--artifacts', '--format', '--policy'].includes(argument)) {
        return usageError(`unknown option ${JSON.stringify(argument)}`, errorFormat);
      }
      const value = args[index + 1];
      if (value === undefined || value === '' || value === '--') {
        return usageError(`${argument} requires a value`, errorFormat);
      }
      index += 1;
      if (argument === '--artifacts') {
        if (artifactRoot !== undefined) {
          return usageError('--artifacts may appear only once', errorFormat);
        }
        artifactRoot = value;
      } else if (argument === '--policy') {
        if (policyPath !== undefined) {
          return usageError('--policy may appear only once', errorFormat);
        }
        policyPath = value;
      } else {
        if (formatSeen) return usageError('--format may appear only once', errorFormat);
        formatSeen = true;
        if (value !== 'github' && value !== 'human' && value !== 'json') {
          return usageError('--format must be human, json, or github', errorFormat);
        }
        format = value;
      }
      continue;
    }
    if (certificatePath !== undefined) {
      return usageError('exactly one certificate path is required', errorFormat);
    }
    certificatePath = argument;
  }

  if (certificatePath === undefined) return usageError('certificate path is required', errorFormat);
  if (policyPath === undefined) return usageError('--policy is required', errorFormat);
  if (artifactRoot === undefined) return usageError('--artifacts is required', errorFormat);
  return {
    kind: 'verify',
    request: {
      artifactRoot: resolve(artifactRoot),
      certificatePath: resolve(certificatePath),
      format,
      policyPath: resolve(policyPath),
    },
  };
}

function requestedErrorFormat(args: readonly string[]): KovoVerifyFormat {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--format') continue;
    const value = args[index + 1];
    if (value === 'github' || value === 'human' || value === 'json') return value;
  }
  return 'human';
}

function usageError(message: string, format: KovoVerifyFormat): ParsedKovoVerifyArgs {
  return { format, kind: 'usage-error', message };
}

function formatVerification(
  result: KovoCertificateVerificationResult,
  format: KovoVerifyFormat,
): string {
  const text = formatCertificateVerification(result);
  if (format === 'human') return text;
  const diagnostics: KovoVerifyDiagnostic[] = result.findings.map((finding) => ({
    category: 'proof',
    code: finding.code,
    help: 'Inspect the certificate, independent policy, and exact artifact bytes, then rerun `kovo-verify`.',
    message: finding.message,
    severity: 'error',
    version: DIAGNOSTIC_SCHEMA,
  }));
  if (format === 'github') {
    return `${diagnostics.map(formatGithubDiagnostic).join('')}${text}`;
  }
  return formatDiagnosticEnvelope(diagnostics, {
    command: 'verify',
    exitCode: result.ok ? 0 : 1,
    findings: result.findings,
    ok: result.ok,
    protocol: REPORT_SCHEMA,
    schema: REPORT_SCHEMA,
    stats: result.stats,
    status: result.ok ? 'verified' : 'findings',
    text,
  });
}

function formatCommandError(message: string, format: KovoVerifyFormat): string {
  const normalizedMessage = singleLine(message);
  const text = `kovo-verify/v1 ERROR ${normalizedMessage}\nRun "kovo-verify --help" for usage.\n`;
  if (format === 'human') return text;
  const diagnostic = {
    category: 'usage',
    code: 'KOVO_VERIFY_INDETERMINATE',
    help: 'Run `kovo-verify --help`, correct the input or evidence path, and retry verification.',
    message: normalizedMessage,
    severity: 'error',
    version: DIAGNOSTIC_SCHEMA,
  } as const;
  if (format === 'github') return `${formatGithubDiagnostic(diagnostic)}${text}`;
  return formatDiagnosticEnvelope([diagnostic], {
    command: 'verify',
    exitCode: 2,
    message: normalizedMessage,
    protocol: COMMAND_ERROR_SCHEMA,
    schema: COMMAND_ERROR_SCHEMA,
    status: 'indeterminate',
    text,
  });
}

interface KovoVerifyDiagnostic {
  category: 'proof' | 'usage';
  code: string;
  help: string;
  message: string;
  severity: 'error';
  version: typeof DIAGNOSTIC_SCHEMA;
}

interface KovoVerifyCompletedResult {
  command: 'verify';
  exitCode: 0 | 1;
  findings: KovoCertificateVerificationResult['findings'];
  ok: boolean;
  protocol: typeof REPORT_SCHEMA;
  schema: typeof REPORT_SCHEMA;
  stats: KovoCertificateVerificationResult['stats'];
  status: 'findings' | 'verified';
  text: string;
}

interface KovoVerifyCommandErrorResult {
  command: 'verify';
  exitCode: 2;
  message: string;
  protocol: typeof COMMAND_ERROR_SCHEMA;
  schema: typeof COMMAND_ERROR_SCHEMA;
  status: 'indeterminate';
  text: string;
}

type KovoVerifyDiagnosticResult = KovoVerifyCommandErrorResult | KovoVerifyCompletedResult;

function formatDiagnosticEnvelope(
  diagnostics: readonly KovoVerifyDiagnostic[],
  result: KovoVerifyDiagnosticResult,
): string {
  return `${JSON.stringify({ diagnostics, result, version: DIAGNOSTIC_SCHEMA })}\n`;
}

function formatGithubDiagnostic(diagnostic: KovoVerifyDiagnostic): string {
  const title = githubProperty(`${diagnostic.code} ${diagnostic.category}`);
  const message = githubMessage(`${diagnostic.message} ${diagnostic.help}`);
  return `::error title=${title}::${message}\n`;
}

function githubProperty(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

function githubMessage(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function singleLine(message: string): string {
  let result = '';
  for (const character of message) {
    const codePoint = character.codePointAt(0);
    result +=
      codePoint !== undefined &&
      (codePoint <= 0x1f || codePoint === 0x7f || codePoint === 0x2028 || codePoint === 0x2029)
        ? ' '
        : character;
  }
  return result.trim();
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && sameEntryPath(invokedPath, import.meta.url)) {
  process.exitCode = await runKovoVerify(process.argv.slice(2));
}

function sameEntryPath(invokedPath: string, moduleUrl: string): boolean {
  return canonicalEntryUrl(invokedPath) === canonicalEntryUrl(fileURLToPath(moduleUrl));
}

function canonicalEntryUrl(filePath: string): string {
  const resolved = resolve(filePath);
  try {
    return pathToFileURL(realpathSync(resolved)).href;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_ACCESS_DENIED') throw error;
    return pathToFileURL(resolved).href;
  }
}

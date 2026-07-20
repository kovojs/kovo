#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { formatCertificateVerification, verifyCertificateDirectory } from './index.js';

/** Injectable text sinks for the stable `kovo-verify` command contract. */
export interface KovoVerifyIo {
  stderr(text: string): void;
  stdout(text: string): void;
}

/** Run `kovo-verify <certificate.json> --artifacts <root>` and return its process exit code. */
export async function runKovoVerify(
  args: readonly string[],
  io: KovoVerifyIo = {
    stderr: (text) => process.stderr.write(text),
    stdout: (text) => process.stdout.write(text),
  },
): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed === undefined) {
    io.stderr('usage: kovo-verify <certificate.json> --artifacts <root>\n');
    return 2;
  }
  try {
    const certificate = JSON.parse(readFileSync(parsed.certificatePath, 'utf8')) as unknown;
    const result = await verifyCertificateDirectory(certificate, parsed.artifactRoot);
    io.stdout(formatCertificateVerification(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr(
      `kovo-verify/v1 ERROR ${error instanceof Error ? error.message : 'verification failed'}\n`,
    );
    return 2;
  }
}

function parseArgs(
  args: readonly string[],
): { artifactRoot: string; certificatePath: string } | undefined {
  if (args.length !== 3 || args[1] !== '--artifacts' || !args[0] || !args[2]) return undefined;
  return { artifactRoot: resolve(args[2]), certificatePath: resolve(args[0]) };
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  process.exitCode = await runKovoVerify(process.argv.slice(2));
}

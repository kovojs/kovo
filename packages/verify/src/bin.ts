#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readBoundedRegularFileSnapshot } from './file-snapshot.js';
import { formatCertificateVerification, verifyCertificateDirectory } from './index.js';

const MAX_CERTIFICATE_BYTES = 2 * 1024 * 1024;
const MAX_POLICY_BYTES = 1024 * 1024;

/** Injectable text sinks for the stable `kovo-verify` command contract. */
export interface KovoVerifyIo {
  stderr(text: string): void;
  stdout(text: string): void;
}

/** Run `kovo-verify <certificate.json> --policy <policy.json> --artifacts <root>`. */
export async function runKovoVerify(
  args: readonly string[],
  io: KovoVerifyIo = {
    stderr: (text) => process.stderr.write(text),
    stdout: (text) => process.stdout.write(text),
  },
): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed === undefined) {
    io.stderr('usage: kovo-verify <certificate.json> --policy <policy.json> --artifacts <root>\n');
    return 2;
  }
  try {
    const certificateBytes = readBoundedEvidenceFile(
      parsed.certificatePath,
      MAX_CERTIFICATE_BYTES,
      'certificate',
    );
    const certificate = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(certificateBytes),
    ) as unknown;
    const policyBytes = readBoundedEvidenceFile(parsed.policyPath, MAX_POLICY_BYTES, 'policy');
    const result = await verifyCertificateDirectory(certificate, policyBytes, parsed.artifactRoot);
    io.stdout(formatCertificateVerification(result));
    return result.ok ? 0 : 1;
  } catch (error) {
    io.stderr(
      `kovo-verify/v1 ERROR ${error instanceof Error ? error.message : 'verification failed'}\n`,
    );
    return 2;
  }
}

function readBoundedEvidenceFile(filePath: string, maxBytes: number, label: string): Uint8Array {
  return readBoundedRegularFileSnapshot(filePath, maxBytes, label).bytes;
}

function parseArgs(
  args: readonly string[],
): { artifactRoot: string; certificatePath: string; policyPath: string } | undefined {
  if (
    args.length !== 5 ||
    args[1] !== '--policy' ||
    args[3] !== '--artifacts' ||
    !args[0] ||
    !args[2] ||
    !args[4]
  ) {
    return undefined;
  }
  return {
    artifactRoot: resolve(args[4]),
    certificatePath: resolve(args[0]),
    policyPath: resolve(args[2]),
  };
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  process.exitCode = await runKovoVerify(process.argv.slice(2));
}

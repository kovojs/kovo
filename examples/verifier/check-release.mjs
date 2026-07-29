import { readFile } from 'node:fs/promises';

import { formatCertificateVerification, verifyCertificateDirectory } from '@kovojs/verify';

const [certificatePath, policyPath, artifactRoot] = process.argv.slice(2);
if (!certificatePath || !policyPath || !artifactRoot) {
  process.stderr.write(
    'usage: node check-release.mjs <certificate.json> <policy.json> <artifact-root>\n',
  );
  process.exitCode = 2;
} else {
  // The caller obtains and authenticates the reviewer policy independently. This example only
  // demonstrates embedding the verifier API; `kovo-verify` owns bounded, no-follow CLI file I/O.
  const certificate = JSON.parse(await readFile(certificatePath, 'utf8'));
  const policyBytes = new Uint8Array(await readFile(policyPath));
  const result = await verifyCertificateDirectory(certificate, policyBytes, artifactRoot);

  process.stdout.write(formatCertificateVerification(result));
  process.exitCode = result.ok ? 0 : 1;
}

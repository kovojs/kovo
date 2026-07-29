#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isMainEntry, runGate } from './lib/cli-entry.mjs';
import {
  readPackageTarballSnapshot,
  validatedPackageTarballEntries,
} from './lib/deterministic-tarball.mjs';
import {
  validatePackedReleaseManifest,
  verifyPackedAttestation,
} from './publish-packed-packages.mjs';
import { manifestPath, releasePackages, repoRoot } from './release-packages.mjs';

const VERIFY_PACKAGE = '@kovojs/verify';
const FIXTURE_ARTIFACT_SHA512 =
  'sha512-Xwcc4lcPCqGGXNLI0cn/Qra7RUd/f4ck6hBfRI01RP5NeQixSnRAfxklekSpbMPlDqA5vO6gf7Y7uEVGvGD4Ng==';
const FIXTURE_POLICY_SHA512 =
  'sha512-N8htknfiaLTIBTEKM5yjdMLLwJmiUdgA2Zicjgp4CzZ1IEca2HQRQBpGSxKh2LIKGDc3eGMD41MeHU+sS6y7Xg==';
const EXPECTED_RUNTIME_EXPORTS = Object.freeze([
  'KOVO_CERTIFICATE_CAPABILITY_DOMAIN',
  'formatCertificateVerification',
  'verifyCertificate',
  'verifyCertificateDirectory',
]);
const EXPECTED_DECLARATIONS = Object.freeze([
  'KOVO_CERTIFICATE_CAPABILITY_DOMAIN',
  'KovoCertificateArtifactSource',
  'KovoCertificateCapabilityKind',
  'KovoCertificateFinding',
  'KovoCertificatePolicyV1',
  'KovoCertificateRootKind',
  'KovoCertificateV1',
  'KovoCertificateVerificationResult',
  'formatCertificateVerification',
  'verifyCertificate',
  'verifyCertificateDirectory',
]);

export function assertPackedVerifierManifest(manifest) {
  if (manifest?.name !== VERIFY_PACKAGE || typeof manifest.version !== 'string') {
    throw new Error('Packed verifier manifest has the wrong package identity');
  }
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = manifest[field] ?? {};
    if (
      typeof dependencies !== 'object' ||
      Array.isArray(dependencies) ||
      Object.keys(dependencies).length > 0
    ) {
      throw new Error(
        `${VERIFY_PACKAGE} packed ${field} must be empty; verifier runtime bytes are self-contained`,
      );
    }
  }
  if (manifest.bin?.['kovo-verify'] !== './dist/bin.mjs') {
    throw new Error('Packed verifier manifest does not expose dist/bin.mjs as kovo-verify');
  }
  if (
    manifest.exports?.['.']?.default !== './dist/index.mjs' ||
    manifest.exports?.['.']?.types !== './dist/index.d.mts'
  ) {
    throw new Error('Packed verifier root does not resolve its built runtime and declarations');
  }
}

export function findingsFromHumanVerifierReport(report) {
  const lines = report.trimEnd().split('\n');
  if (!/^kovo-verify\/v1 (?:PASS|FAIL) /u.test(lines[0] ?? '')) {
    throw new Error('Human verifier report is not kovo-verify/v1');
  }
  return lines.slice(1).map((line) => {
    const match = /^(CLOSURE|COVERAGE|SCHEMA|STABILITY) (\S+) (.*)$/u.exec(line);
    if (match === null) throw new Error(`Human verifier finding is malformed: ${line}`);
    return {
      code: match[2],
      message: match[3],
      obligation: match[1].toLowerCase(),
    };
  });
}

export function assertVerifierReportFindingParity(humanReport, jsonReport) {
  let envelope;
  try {
    envelope = JSON.parse(jsonReport);
  } catch {
    throw new Error('JSON verifier report is not valid JSON');
  }
  if (
    envelope?.version !== 'kovo-diagnostic/v1' ||
    !Array.isArray(envelope.diagnostics) ||
    envelope.result?.command !== 'verify' ||
    envelope.result?.protocol !== 'kovo.verify-report/v1' ||
    ![0, 1].includes(envelope.result?.exitCode) ||
    typeof envelope.result?.text !== 'string'
  ) {
    throw new Error('JSON verifier report does not match kovo-diagnostic/v1');
  }
  const humanFindings = findingsFromHumanVerifierReport(humanReport);
  const resultFindings = findingsFromHumanVerifierReport(envelope.result.text);
  const diagnosticFindings = envelope.diagnostics.map(({ code, message }) => ({ code, message }));
  const expectedDiagnostics = humanFindings.map(({ code, message }) => ({ code, message }));
  if (
    envelope.result.text !== humanReport ||
    JSON.stringify(resultFindings) !== JSON.stringify(humanFindings) ||
    JSON.stringify(diagnosticFindings) !== JSON.stringify(expectedDiagnostics)
  ) {
    throw new Error('Human and JSON verifier reports carry different findings');
  }
  return {
    envelope,
    findings: humanFindings,
    ok: envelope.result.exitCode === 0,
  };
}

export function checkPackedVerifierConsumer(args = process.argv.slice(2)) {
  const input = packedVerifierInput(args);
  assertPackedVerifierManifest(input.manifest);

  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), 'kovo-packed-verifier-consumer-'));
  try {
    writeFileSync(
      path.join(consumerRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'kovo-packed-verifier-consumer',
          private: true,
          type: 'module',
          version: '0.0.0',
        },
        null,
        2,
      )}\n`,
    );
    const packageRoot = path.join(consumerRoot, 'node_modules', '@kovojs', 'verify');
    materializeAttestedPackage(input.entries, packageRoot);
    const installedManifest = JSON.parse(
      readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    );
    assertPackedVerifierManifest(installedManifest);

    const fixture = writeCertificateFixture(consumerRoot);
    const bin = path.join(packageRoot, 'dist', 'bin.mjs');
    assertPackedInformationalContract(bin, installedManifest.version, consumerRoot);
    assertPackedVerificationContract(bin, fixture, consumerRoot);
    assertPackedApiContract(consumerRoot, fixture);
    assertPackedDeclarationContract(consumerRoot);
    assertPackedExample(consumerRoot, fixture);

    process.stdout.write(
      `Packed verifier consumer passed (11 declarations, 0 Kovo runtime dependencies, 24 flag orders).\n`,
    );
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
}

function packedVerifierInput(args) {
  const tarballIndex = args.indexOf('--tarball');
  if (tarballIndex !== -1) {
    if (args.length !== 2 || tarballIndex !== 0 || !args[1]) {
      throw new Error('usage: check-packed-verifier-consumer.mjs --tarball <path>');
    }
    const entries = validatedPackageTarballEntries(
      readPackageTarballSnapshot(path.resolve(args[1])),
    );
    const manifestEntry = entries.find((entry) => entry.name === 'package/package.json');
    if (manifestEntry === undefined) throw new Error('Packed verifier tarball has no package.json');
    return { entries, manifest: JSON.parse(manifestEntry.data.toString('utf8')) };
  }
  if (args.length > 0) {
    throw new Error('usage: check-packed-verifier-consumer.mjs [--tarball <path>]');
  }

  const packedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packedPackages = validatePackedReleaseManifest(packedManifest, releasePackages());
  const verifier = packedPackages.find((pkg) => pkg.name === VERIFY_PACKAGE);
  if (verifier === undefined) {
    throw new Error(`Packed release manifest is missing ${VERIFY_PACKAGE}`);
  }
  const tarball = path.resolve(repoRoot, verifier.tarball);
  const attested = verifyPackedAttestation(verifier, tarball);
  return { entries: attested.entries, manifest: verifier.manifest };
}

function materializeAttestedPackage(entries, packageRoot) {
  for (const entry of entries) {
    if (!entry.name.startsWith('package/') || entry.name.endsWith('/')) continue;
    const relative = entry.name.slice('package/'.length);
    const destination = path.join(packageRoot, ...relative.split('/'));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, entry.data);
  }
}

function assertPackedInformationalContract(bin, version, cwd) {
  for (const flag of ['-h', '--help']) {
    const result = captureNode(bin, [flag], cwd);
    assertProcess(result, `kovo-verify ${flag}`, 0, 'stdout');
    if (
      !result.stdout.includes('Usage:\n  kovo-verify <certificate.json>') ||
      !result.stdout.includes('Exit codes:')
    ) {
      throw new Error(`Packed kovo-verify ${flag} output is incomplete`);
    }
  }
  const versionResult = captureNode(bin, ['--version'], cwd);
  assertProcess(versionResult, 'kovo-verify --version', 0, 'stdout');
  if (versionResult.stdout !== `kovo-verify ${version}\n`) {
    throw new Error('Packed kovo-verify --version does not match the installed manifest');
  }
}

function assertPackedVerificationContract(bin, fixture, cwd) {
  const flagGroups = [
    [fixture.certificatePath],
    ['--policy', fixture.policyPath],
    ['--artifacts', fixture.artifactRoot],
    ['--format', 'json'],
  ];
  for (const order of permutations(flagGroups)) {
    const result = captureNode(bin, order.flat(), cwd);
    assertProcess(result, 'kovo-verify verified JSON report', 0, 'stdout');
    const payload = JSON.parse(result.stdout);
    if (
      payload?.version !== 'kovo-diagnostic/v1' ||
      !Array.isArray(payload.diagnostics) ||
      payload.diagnostics.length !== 0 ||
      payload.result?.command !== 'verify' ||
      payload.result?.exitCode !== 0 ||
      payload.result?.protocol !== 'kovo.verify-report/v1' ||
      !payload.result.text?.startsWith('kovo-verify/v1 PASS ')
    ) {
      throw new Error('Packed kovo-verify did not emit a valid verified JSON report');
    }
  }

  const common = ['--policy', fixture.policyPath, '--artifacts', fixture.artifactRoot];
  const verifiedHuman = captureNode(bin, [fixture.certificatePath, ...common], cwd);
  assertProcess(verifiedHuman, 'kovo-verify verified human report', 0, 'stdout');
  if (!verifiedHuman.stdout.startsWith('kovo-verify/v1 PASS ')) {
    throw new Error('Packed kovo-verify did not emit a versioned human success report');
  }

  const findingsHuman = captureNode(bin, [fixture.findingCertificatePath, ...common], cwd);
  const findingsJson = captureNode(
    bin,
    ['--format', 'json', ...common, fixture.findingCertificatePath],
    cwd,
  );
  assertProcess(findingsHuman, 'kovo-verify human findings', 1, 'stdout');
  assertProcess(findingsJson, 'kovo-verify JSON findings', 1, 'stdout');
  const findingPayload = assertVerifierReportFindingParity(
    findingsHuman.stdout,
    findingsJson.stdout,
  );
  if (findingPayload.findings.length === 0 || findingPayload.ok !== false) {
    throw new Error('Packed verifier findings report did not contain a finding');
  }
  const findingsGithub = captureNode(
    bin,
    ['--format', 'github', ...common, fixture.findingCertificatePath],
    cwd,
  );
  assertProcess(findingsGithub, 'kovo-verify GitHub findings', 1, 'stdout');
  if (
    !findingsGithub.stdout.includes('::error title=') ||
    !findingsGithub.stdout.includes(findingsHuman.stdout)
  ) {
    throw new Error('Packed verifier GitHub report lost its diagnostic or human proof facts');
  }

  const usage = captureNode(bin, ['--unknown'], cwd);
  assertProcess(usage, 'kovo-verify usage failure', 2, 'stderr');
  const missing = captureNode(
    bin,
    [
      '--format',
      'json',
      path.join(cwd, 'missing-certificate.json'),
      '--policy',
      fixture.policyPath,
      '--artifacts',
      fixture.artifactRoot,
    ],
    cwd,
  );
  assertProcess(missing, 'kovo-verify I/O failure', 2, 'stderr');
  const missingPayload = JSON.parse(missing.stderr);
  if (
    missingPayload?.version !== 'kovo-diagnostic/v1' ||
    missingPayload.result?.protocol !== 'kovo.verify-command-error/v1' ||
    missingPayload.result?.exitCode !== 2 ||
    !Array.isArray(missingPayload.diagnostics) ||
    missingPayload.diagnostics.length !== 1
  ) {
    throw new Error('Packed verifier JSON I/O error is not versioned and indeterminate');
  }
  const malformed = captureNode(
    bin,
    [
      fixture.malformedCertificatePath,
      '--policy',
      fixture.policyPath,
      '--artifacts',
      fixture.artifactRoot,
    ],
    cwd,
  );
  assertProcess(malformed, 'kovo-verify parse failure', 2, 'stderr');
}

function assertPackedApiContract(consumerRoot, fixture) {
  const consumerPath = path.join(consumerRoot, 'api-consumer.mjs');
  writeFileSync(
    consumerPath,
    `import { readFile } from 'node:fs/promises';
import path from 'node:path';

import * as verifier from '@kovojs/verify';

const expected = ${JSON.stringify(EXPECTED_RUNTIME_EXPORTS)};
if (JSON.stringify(Object.keys(verifier).sort()) !== JSON.stringify(expected)) {
  throw new Error('packed verifier runtime exports drifted');
}
const [certificatePath, policyPath, artifactRoot, modulePath] = process.argv.slice(2);
const certificate = JSON.parse(await readFile(certificatePath, 'utf8'));
const policy = new Uint8Array(await readFile(policyPath));
const directoryResult = await verifier.verifyCertificateDirectory(certificate, policy, artifactRoot);
if (!directoryResult.ok || !verifier.formatCertificateVerification(directoryResult).startsWith('kovo-verify/v1 PASS ')) {
  throw new Error('packed directory API did not verify the fixture');
}
const moduleBytes = new Uint8Array(await readFile(path.join(artifactRoot, ...modulePath.split('/'))));
const sourceResult = await verifier.verifyCertificate(certificate, policy, {
  listArtifactPaths: () => [modulePath],
  readArtifact: (candidate) => candidate === modulePath ? moduleBytes : undefined,
});
if (!sourceResult.ok || JSON.stringify(sourceResult) !== JSON.stringify(directoryResult)) {
  throw new Error('packed artifact-source and directory APIs diverged');
}
process.stdout.write('packed-verifier-api/v1 OK\\n');
`,
  );
  const result = captureNode(
    consumerPath,
    [fixture.certificatePath, fixture.policyPath, fixture.artifactRoot, fixture.modulePath],
    consumerRoot,
  );
  assertProcess(result, 'packed verifier API consumer', 0, 'stdout');
  if (result.stdout !== 'packed-verifier-api/v1 OK\n') {
    throw new Error('Packed verifier API consumer returned unexpected output');
  }
}

function assertPackedDeclarationContract(consumerRoot) {
  const consumerPath = path.join(consumerRoot, 'declaration-consumer.mts');
  writeFileSync(
    consumerPath,
    `import {
  KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
  type KovoCertificateArtifactSource,
  type KovoCertificateCapabilityKind,
  type KovoCertificateFinding,
  type KovoCertificatePolicyV1,
  type KovoCertificateRootKind,
  type KovoCertificateV1,
  type KovoCertificateVerificationResult,
  formatCertificateVerification,
  verifyCertificate,
  verifyCertificateDirectory,
} from '@kovojs/verify';

const capability: KovoCertificateCapabilityKind = 'filesystem';
const rootKind: KovoCertificateRootKind = 'application';
const finding: KovoCertificateFinding = {
  code: 'example',
  message: 'example',
  obligation: 'coverage',
};
const artifacts: KovoCertificateArtifactSource = {
  listArtifactPaths: () => [],
  readArtifact: () => undefined,
};
const certificate: KovoCertificateV1 = {
  artifacts: [],
  cap: {},
  domain: KOVO_CERTIFICATE_CAPABILITY_DOMAIN,
  doors: [],
  edges: [],
  opaque: [],
  policySha512: 'sha512-example',
  roots: [],
  schema: 'kovo.certificate/v1',
};
const policy: KovoCertificatePolicyV1 = {
  artifacts: [],
  doors: [],
  opaque: [],
  packages: [],
  roots: [],
  schema: 'kovo.certificate-policy/v1',
};
async function compileEveryDeclaration(): Promise<KovoCertificateVerificationResult> {
  void capability;
  void rootKind;
  void finding;
  void policy;
  void verifyCertificateDirectory;
  const result = await verifyCertificate(certificate, new Uint8Array(), artifacts);
  void formatCertificateVerification(result);
  return result;
}
void compileEveryDeclaration();
`,
  );
  writeFileSync(
    path.join(consumerRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ['ES2022'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: 'ES2022',
          types: [],
        },
        files: ['./declaration-consumer.mts'],
      },
      null,
      2,
    )}\n`,
  );
  const typeScript = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [typeScript, '-p', 'tsconfig.json'], {
    cwd: consumerRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assertProcess(result, 'packed verifier declaration consumer', 0, 'quiet');
  const declarationText = readFileSync(
    path.join(consumerRoot, 'node_modules', '@kovojs', 'verify', 'dist', 'index.d.mts'),
    'utf8',
  );
  for (const name of EXPECTED_DECLARATIONS) {
    if (!new RegExp(`\\b${name}\\b`, 'u').test(declarationText)) {
      throw new Error(`Packed verifier declarations omit ${name}`);
    }
  }
  const exportList = declarationText.match(/export \{ ([^}]+) \};/u)?.[1]?.split(', ');
  if (
    exportList === undefined ||
    JSON.stringify([...exportList].sort(compareStrings)) !==
      JSON.stringify([...EXPECTED_DECLARATIONS].sort(compareStrings))
  ) {
    throw new Error('Packed verifier declaration export list is not the exact 11-name family');
  }
}

function assertPackedExample(consumerRoot, fixture) {
  const examplePath = path.join(consumerRoot, 'check-release.mjs');
  copyFileSync(path.join(repoRoot, 'examples', 'verifier', 'check-release.mjs'), examplePath);
  const result = captureNode(
    examplePath,
    [fixture.certificatePath, fixture.policyPath, fixture.artifactRoot],
    consumerRoot,
  );
  assertProcess(result, 'packed verifier public example', 0, 'stdout');
  if (!result.stdout.startsWith('kovo-verify/v1 PASS ')) {
    throw new Error('Packed verifier public example did not render a successful report');
  }
}

function writeCertificateFixture(root) {
  const artifactRoot = path.join(root, 'artifacts');
  const modulePath = '@kovojs/server/dist/index.mjs';
  const source = "import 'node:fs';\nexport {};\n";
  const packageManifest = {
    exports: { '.': './dist/index.mjs' },
    name: '@kovojs/server',
    type: 'module',
    version: '0.0.0',
  };
  mkdirSync(path.join(artifactRoot, '@kovojs', 'server', 'dist'), { recursive: true });
  writeFileSync(path.join(artifactRoot, ...modulePath.split('/')), source);
  writeFileSync(
    path.join(artifactRoot, '@kovojs', 'server', 'package.json'),
    `${JSON.stringify(packageManifest)}\n`,
  );
  const policy = `${JSON.stringify(
    {
      artifacts: [{ path: modulePath, sha512: FIXTURE_ARTIFACT_SHA512 }],
      doors: [],
      opaque: [],
      packages: [{ manifest: packageManifest, name: '@kovojs/server' }],
      roots: [],
      schema: 'kovo.certificate-policy/v1',
    },
    null,
    2,
  )}\n`;
  const policyPath = path.join(root, 'policy.json');
  writeFileSync(policyPath, policy);

  const certificate = {
    artifacts: [modulePath],
    cap: { [modulePath]: ['filesystem'] },
    domain: [
      'crypto-acquisition',
      'database-driver',
      'digest',
      'dynamic-loader',
      'filesystem',
      'network',
      'process',
      'vm',
      'worker',
    ],
    doors: [],
    edges: [],
    opaque: [],
    policySha512: FIXTURE_POLICY_SHA512,
    roots: [],
    schema: 'kovo.certificate/v1',
  };
  const certificatePath = path.join(root, 'certificate.json');
  writeFileSync(certificatePath, `${JSON.stringify(certificate)}\n`);
  const findingCertificatePath = path.join(root, 'certificate-findings.json');
  writeFileSync(
    findingCertificatePath,
    `${JSON.stringify({ ...certificate, cap: { [modulePath]: [] } })}\n`,
  );
  const malformedCertificatePath = path.join(root, 'certificate-malformed.json');
  writeFileSync(malformedCertificatePath, '{not-json}\n');
  return {
    artifactRoot,
    certificatePath,
    findingCertificatePath,
    malformedCertificatePath,
    modulePath,
    policyPath,
  };
}

function captureNode(entry, args, cwd) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertProcess(result, label, expectedStatus, output) {
  if (result.error || result.signal || result.status !== expectedStatus) {
    throw new Error(
      `${label} expected exit ${expectedStatus}, observed ${String(result.status)}: ${
        result.error?.message ?? result.signal ?? result.stderr ?? result.stdout
      }`,
    );
  }
  if (output === 'stdout' && (result.stderr !== '' || result.stdout === '')) {
    throw new Error(`${label} must write stdout only`);
  }
  if (output === 'stderr' && (result.stdout !== '' || result.stderr === '')) {
    throw new Error(`${label} must write stderr only`);
  }
  if (output === 'quiet' && (result.stdout !== '' || result.stderr !== '')) {
    throw new Error(`${label} must not write output`);
  }
}

function permutations(values) {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((tail) => [
      value,
      ...tail,
    ]),
  );
}

function compareStrings(left, right) {
  return left.localeCompare(right);
}

if (isMainEntry(import.meta.url)) {
  await runGate(() => checkPackedVerifierConsumer(process.argv.slice(2)));
}

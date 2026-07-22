import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const [stage, ...args] = process.argv.slice(2);

await assertNetworkDenied();
assertChildProcessDenied();

if (stage === 'analyze') {
  const [subjectPath, outputPath, forbiddenKeyPath, forbiddenAppPath] = args;
  assertForbiddenRead(forbiddenKeyPath, 'signing material');
  assertForbiddenRead(forbiddenAppPath, 'app dependency closure');
  const subject = readCertificateSubject(subjectPath);
  const { analyzeKovoCertificate, validateCertificateLexicalAuthorityLedger } =
    await import('./kovo-certificate.mjs');
  const lexicalFindings = validateCertificateLexicalAuthorityLedger(subject.lexicalAuthority);
  if (lexicalFindings.length > 0) {
    throw new Error(
      `Certificate lexical authority findings:\n  - ${lexicalFindings.join('\n  - ')}`,
    );
  }
  writeJson(
    outputPath,
    analyzeKovoCertificate({
      internalDoorPosture: subject.internalDoorPosture,
      packageConfigs: subject.packageConfigs,
      posture: subject.posture,
      seedPackageNames: subject.seedPackageNames,
      snapshot: subject.snapshot,
    }),
  );
} else if (stage === 'generate') {
  const [analysisPath, policyPath, outputPath, forbiddenKeyPath, forbiddenAppPath] = args;
  assertForbiddenRead(forbiddenKeyPath, 'signing material');
  assertForbiddenRead(forbiddenAppPath, 'app dependency closure');
  const { generateKovoCertificateFromAnalysis, stableKovoCertificateJson } =
    await import('./kovo-certificate-format.mjs');
  const analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
  const policyBytes = readFileSync(policyPath);
  writeFileSync(
    outputPath,
    stableKovoCertificateJson(generateKovoCertificateFromAnalysis(analysis, policyBytes)),
    'utf8',
  );
} else if (stage === 'sign') {
  const [unsignedPath, keyPath, outputPath, forbiddenRepoPath, forbiddenAppPath] = args;
  assertForbiddenRead(forbiddenRepoPath, 'framework/app repository');
  assertForbiddenRead(forbiddenAppPath, 'app dependency closure');
  const { signKovoCertificate } = await import('./kovo-certificate-signature.mjs');
  const unsigned = readFileSync(unsignedPath);
  const privateKey = readFileSync(keyPath);
  const envelope = signKovoCertificate(unsigned, { privateKey });
  writeJson(outputPath, envelope);
} else {
  throw new Error(`Unknown hermetic proof stage: ${String(stage)}`);
}

function readCertificateSubject(filePath) {
  const value = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!isPlainRecord(value) || value.schema !== 'kovo.hermetic-certificate-subject/v1') {
    throw new Error('Hermetic certificate subject has an invalid schema.');
  }
  const expectedKeys = [
    'internalDoorPosture',
    'lexicalAuthority',
    'packageConfigs',
    'posture',
    'schema',
    'seedPackageNames',
    'snapshot',
  ];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error('Hermetic certificate subject has top-level schema drift.');
  }
  if (!Array.isArray(value.packageConfigs) || !Array.isArray(value.seedPackageNames)) {
    throw new Error('Hermetic certificate subject package census is invalid.');
  }
  const subjectRoot = path.dirname(filePath);
  const packageConfigs = value.packageConfigs.map((config, index) => {
    if (
      !isPlainRecord(config) ||
      JSON.stringify(Object.keys(config).sort()) !==
        JSON.stringify(['name', 'publishExports', 'rootDir']) ||
      typeof config.name !== 'string' ||
      !/^@kovojs\/[a-z0-9-]+$/u.test(config.name) ||
      typeof config.rootDir !== 'string'
    ) {
      throw new Error(`Hermetic certificate subject packageConfigs[${index}] is invalid.`);
    }
    return {
      name: config.name,
      publishExports: config.publishExports,
      rootDir: resolveSubjectPath(subjectRoot, config.rootDir),
    };
  });
  if (
    value.seedPackageNames.some(
      (entry) => typeof entry !== 'string' || !/^@kovojs\/[a-z0-9-]+$/u.test(entry),
    )
  ) {
    throw new Error('Hermetic certificate subject seed package census is invalid.');
  }
  return { ...value, packageConfigs };
}

function resolveSubjectPath(root, relativePath) {
  if (
    relativePath === '' ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath === '..' ||
    relativePath.startsWith('../')
  ) {
    throw new Error(`Hermetic certificate subject path is not canonical: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Hermetic certificate subject path escapes its root: ${relativePath}`);
  }
  return resolved;
}

async function assertNetworkDenied() {
  const endpoint = process.env.KOVO_HERMETIC_NETWORK_CANARY;
  if (endpoint === undefined) throw new Error('Hermetic network canary is required.');
  const separator = endpoint.lastIndexOf(':');
  const host = endpoint.slice(0, separator);
  const port = Number(endpoint.slice(separator + 1));
  if (host === '' || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Hermetic network canary endpoint is invalid.');
  }
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(undefined);
    }, 750);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error('Hermetic proof stage reached the network canary.'));
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

function assertChildProcessDenied() {
  try {
    execFileSync(process.execPath, ['--version'], { stdio: 'ignore' });
  } catch (error) {
    if (/permission|ERR_ACCESS_DENIED/iu.test(String(error))) return;
    throw error;
  }
  throw new Error('Hermetic proof stage could execute a child process or lifecycle command.');
}

function assertForbiddenRead(filePath, label) {
  let readable = false;
  try {
    readFileSync(filePath);
    readable = true;
  } catch {
    // Permission denial or an absent mount is the required posture.
  }
  if (readable) throw new Error(`Hermetic proof stage reached forbidden ${label}.`);
}

function isPlainRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

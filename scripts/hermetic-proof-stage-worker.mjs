import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';

const [stage, ...args] = process.argv.slice(2);

await assertNetworkDenied();
assertChildProcessDenied();

if (stage === 'analyze') {
  const [subjectPath, outputPath, forbiddenKeyPath, forbiddenAppPath] = args;
  assertForbiddenRead(forbiddenKeyPath, 'signing material');
  assertForbiddenRead(forbiddenAppPath, 'app dependency closure');
  const subject = readFileSync(subjectPath);
  writeJson(outputPath, {
    schema: 'kovo.hermetic-analysis/v1',
    subjectSha256: sha256(subject),
  });
} else if (stage === 'generate') {
  const [analysisPath, outputPath, forbiddenKeyPath, forbiddenAppPath] = args;
  assertForbiddenRead(forbiddenKeyPath, 'signing material');
  assertForbiddenRead(forbiddenAppPath, 'app dependency closure');
  const analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
  writeJson(outputPath, {
    analysis,
    schema: 'kovo.hermetic-unsigned-certificate/v1',
  });
} else if (stage === 'sign') {
  const [unsignedPath, keyPath, outputPath, forbiddenRepoPath, forbiddenAppPath] = args;
  assertForbiddenRead(forbiddenRepoPath, 'framework/app repository');
  assertForbiddenRead(forbiddenAppPath, 'app dependency closure');
  const unsigned = readFileSync(unsignedPath);
  const key = readFileSync(keyPath);
  writeJson(outputPath, {
    payloadSha256: sha256(unsigned),
    schema: 'kovo.hermetic-signature/v1',
    signature: createHmac('sha256', key).update(unsigned).digest('hex'),
  });
} else {
  throw new Error(`Unknown hermetic proof stage: ${String(stage)}`);
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

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

#!/usr/bin/env node
/**
 * Inspector-backed Node launcher that flushes a Chrome CPU profile before SIGTERM exit.
 *
 * Node's `--cpu-prof` does not flush when the benchmark adapter terminates a detached production
 * server with SIGTERM. This launcher starts the profiler before importing the generated server,
 * owns the signal, writes the raw V8 profile, and only then exits. It is an internal measurement
 * helper; the generated server remains the code under profile.
 */
import { writeFile } from 'node:fs/promises';
import inspector from 'node:inspector';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const profilePath = process.env.KOVO_PERF_CPU_PROFILE_PATH;
const entry = process.argv[2];
const samplingIntervalMicros = Number(process.env.KOVO_PERF_CPU_PROFILE_INTERVAL_US ?? 500);

if (!profilePath || !path.isAbsolute(profilePath)) {
  throw new TypeError('KOVO_PERF_CPU_PROFILE_PATH must be an absolute path');
}
if (!entry) throw new TypeError('profiled server entry is required');
if (
  !Number.isSafeInteger(samplingIntervalMicros) ||
  samplingIntervalMicros < 100 ||
  samplingIntervalMicros > 10_000
) {
  throw new TypeError('KOVO_PERF_CPU_PROFILE_INTERVAL_US must be an integer from 100 to 10000');
}

const session = new inspector.Session();
session.connect();

function post(method, params) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => (error ? reject(error) : resolve(result)));
  });
}

await post('Profiler.enable');
await post('Profiler.setSamplingInterval', { interval: samplingIntervalMicros });
await post('Profiler.start');

let stopping = false;
async function stopProfile(exitCode, reason) {
  if (stopping) return;
  stopping = true;
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  try {
    const result = await post('Profiler.stop');
    if (!result?.profile || !Array.isArray(result.profile.nodes)) {
      throw new TypeError('Inspector returned an invalid CPU profile');
    }
    await writeFile(profilePath, `${JSON.stringify(result.profile)}\n`, { mode: 0o600 });
  } catch (error) {
    process.stderr.write(
      `could not flush Kovo CPU profile after ${reason}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    exitCode = 1;
  } finally {
    session.disconnect();
  }
  process.exit(exitCode);
}

function onSigint() {
  void stopProfile(0, 'SIGINT');
}

function onSigterm() {
  void stopProfile(0, 'SIGTERM');
}

process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

try {
  const entryUrl = /^(?:data|file):/u.test(entry) ? entry : pathToFileURL(path.resolve(entry)).href;
  await import(entryUrl);
} catch (error) {
  process.stderr.write(
    `profiled server import failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  await stopProfile(1, 'server import failure');
}

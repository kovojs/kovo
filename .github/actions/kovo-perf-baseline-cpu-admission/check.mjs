import { createHash } from 'node:crypto';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

export const BASELINE_CPU_MODEL_SHA256_ENV = 'KOVO_PERF_BASELINE_CPU_MODEL_SHA256';
export const BASELINE_FAMILY_ENV = 'KOVO_PERF_BASELINE_FAMILY';
export const BASELINE_FOCUS_ENV = 'KOVO_PERF_BASELINE_FOCUS';

const baselineFamilies = new Set([
  'browser',
  'build-n24',
  'build-n216',
  'check',
  'dev-n24',
  'dev-n216',
  'server',
]);

/**
 * Admit a hosted runner only when an optional dispatch constraint matches the exact CPU model that
 * Node reports. This is an early collection filter, not a replacement for the full normalized
 * `kovo-performance-host/v2` identity recorded and ratified with each report.
 */
export function baselineCpuModelAdmission({ expectedSha256, cpuModel } = {}) {
  const expected = expectedSha256 ?? '';
  if (expected === '') {
    return { admitted: true, constrained: false };
  }
  if (!/^[0-9a-f]{64}$/u.test(expected)) {
    throw new Error(
      'baseline_cpu_model_sha256 must be exactly 64 lowercase hexadecimal characters',
    );
  }
  if (typeof cpuModel !== 'string' || cpuModel.length === 0) {
    throw new Error('Node os.cpus()[0].model is unavailable');
  }

  const actualSha256 = createHash('sha256').update(cpuModel).digest('hex');
  if (actualSha256 !== expected) {
    throw new Error(
      `baseline CPU model mismatch: expected ${expected}, observed ${actualSha256} for ${JSON.stringify(cpuModel)}`,
    );
  }
  return { actualSha256, admitted: true, constrained: true, cpuModel };
}

export function baselineFamilyAdmission({ family, focus = 'all' } = {}) {
  if (focus === 'all') return { admitted: true, constrained: false };
  if (!baselineFamilies.has(focus)) {
    throw new Error(`unsupported baseline_focus ${JSON.stringify(focus)}`);
  }
  if (!baselineFamilies.has(family)) {
    throw new Error(`baseline producer family is invalid: ${JSON.stringify(family)}`);
  }
  if (family !== focus) {
    throw new Error(`baseline_focus ${focus} excludes ${family}; stopping before setup`);
  }
  return { admitted: true, constrained: true, family, focus };
}

export function runBaselineCpuModelAdmission({ env = process.env, cpus = os.cpus() } = {}) {
  const cpuResult = baselineCpuModelAdmission({
    cpuModel: cpus[0]?.model,
    expectedSha256: env[BASELINE_CPU_MODEL_SHA256_ENV],
  });
  if (cpuResult.constrained) {
    console.log(
      `Baseline CPU model admitted: sha256:${cpuResult.actualSha256} (${cpuResult.cpuModel})`,
    );
  } else {
    console.log('Baseline CPU model admission is unconstrained for this trigger.');
  }
  const familyResult = baselineFamilyAdmission({
    family: env[BASELINE_FAMILY_ENV],
    focus: env[BASELINE_FOCUS_ENV] || 'all',
  });
  if (familyResult.constrained) {
    console.log(`Baseline family admitted: ${familyResult.family}.`);
  }
  return { cpu: cpuResult, family: familyResult };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runBaselineCpuModelAdmission();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

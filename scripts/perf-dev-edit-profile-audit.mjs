#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEV_LOOP_REPORT_SCHEMA,
  diagnosticProfileFindings,
} from '../benchmarks/corpora/dev-loop.mjs';
import {
  auditDevEditProfileArtifacts,
  DEV_EDIT_PROFILE_AUDIT_SCHEMA,
} from './perf-dev-edit-profile.mjs';
import { executionIdentityFindings } from './lib/perf-execution.mjs';
import { performanceHostFingerprintFindings } from './lib/perf-host.mjs';

export const DEV_EDIT_PROFILE_ARTIFACT_AUDIT_SCHEMA = 'kovo-dev-edit-profile-artifact-audit/v1';

export async function auditDevEditProfileReport(options) {
  const reportPath = path.resolve(requiredString(options.reportPath, 'report path'));
  const profileDir = path.resolve(requiredString(options.profileDir, 'profile directory'));
  const reportBytes = await readFile(reportPath);
  let report;
  try {
    report = JSON.parse(reportBytes.toString('utf8'));
  } catch (error) {
    throw new TypeError(`dev profile report is not JSON: ${errorMessage(error)}`);
  }
  const findings = [];
  if (report.schema !== DEV_LOOP_REPORT_SCHEMA) findings.push('dev profile report schema differs');
  if (report.framework !== 'kovo') findings.push('dev profile report is not Kovo');
  if (report.integrity?.complete !== true) findings.push('dev profile report is incomplete');
  if (report.verdict?.status !== 'diagnostic-only') {
    findings.push('dev profile report does not refuse timing claims');
  }
  if (
    report.source?.dirty !== false ||
    report.sourceAfter?.dirty !== false ||
    report.integrity?.source?.stable !== true ||
    report.source?.commit !== report.sourceAfter?.commit
  ) {
    findings.push('dev profile source identity is not clean and stable');
  }
  if (
    process.env.KOVO_PERF_SOURCE_SHA &&
    report.source?.commit !== process.env.KOVO_PERF_SOURCE_SHA
  ) {
    findings.push('dev profile source differs from KOVO_PERF_SOURCE_SHA');
  }
  findings.push(...diagnosticProfileFindings(report, true));
  findings.push(...performanceHostFingerprintFindings(report.host));
  findings.push(
    ...executionIdentityFindings(report.execution, {
      requireProvider: options.requireProvider ?? undefined,
    }),
  );
  if (options.requireProvider === 'github-actions' && !report.host?.runnerImage) {
    findings.push('hosted dev profile runner image identity is absent');
  }
  if (findings.length > 0) throw new Error([...new Set(findings)].join('; '));

  const raw = await auditDevEditProfileArtifacts({
    diagnostic: report.profile.diagnostic,
    profileDir,
  });
  return {
    complete: true,
    corpus: report.corpus,
    execution: report.execution,
    host: report.host,
    profile: raw,
    reportArtifact: {
      bytes: reportBytes.byteLength,
      file: path.basename(reportPath),
      sha256: sha256(reportBytes),
    },
    schema: DEV_EDIT_PROFILE_ARTIFACT_AUDIT_SCHEMA,
    source: report.source,
  };
}

export function parseDevEditProfileAuditArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--out', '--profile-dir', '--report', '--require-provider'].includes(key) || !value) {
      throw new TypeError(`unknown or incomplete dev profile audit option ${String(key)}`);
    }
    if (Object.hasOwn(values, key))
      throw new TypeError(`duplicate dev profile audit option ${key}`);
    values[key] = value;
  }
  const requireProvider = values['--require-provider'];
  if (requireProvider !== undefined && requireProvider !== 'github-actions') {
    throw new TypeError('dev profile audit provider must be github-actions when specified');
  }
  return {
    outPath: path.resolve(requiredString(values['--out'], 'out path')),
    profileDir: path.resolve(requiredString(values['--profile-dir'], 'profile directory')),
    reportPath: path.resolve(requiredString(values['--report'], 'report path')),
    requireProvider,
  };
}

async function writeAudit(outPath, report) {
  await mkdir(path.dirname(outPath), { recursive: true });
  const temporary = `${outPath}.tmp-${String(process.pid)}`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, outPath);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let options;
  try {
    options = parseDevEditProfileAuditArgs(process.argv.slice(2));
    await writeAudit(options.outPath, await auditDevEditProfileReport(options));
  } catch (error) {
    const failure = {
      complete: false,
      errors: [errorMessage(error)],
      profileSchema: DEV_EDIT_PROFILE_AUDIT_SCHEMA,
      schema: DEV_EDIT_PROFILE_ARTIFACT_AUDIT_SCHEMA,
    };
    if (options?.outPath) await writeAudit(options.outPath, failure).catch(() => undefined);
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

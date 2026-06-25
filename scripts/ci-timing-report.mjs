#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TARGET_MIN_MS = 2 * 60 * 1000;
const TARGET_MAX_MS = 5 * 60 * 1000;

export function durationMs(start, end) {
  const started = Date.parse(start);
  const ended = Date.parse(end);
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
}

export function bucketJobDurations(jobs, options = {}) {
  const minMs = options.minMs ?? TARGET_MIN_MS;
  const maxMs = options.maxMs ?? TARGET_MAX_MS;
  return jobs
    .map((job) => ({
      conclusion: job.conclusion,
      durationMs: durationMs(job.startedAt ?? job.createdAt, job.completedAt ?? job.updatedAt),
      name: job.name,
    }))
    .filter((job) => job.durationMs < minMs || job.durationMs > maxMs)
    .sort((a, b) => b.durationMs - a.durationMs || a.name.localeCompare(b.name));
}

export function summarizeRuns(runsWithJobs) {
  return runsWithJobs.map((run) => {
    const wallMs = durationMs(run.createdAt, run.updatedAt);
    return {
      conclusion: run.conclusion,
      databaseId: run.databaseId,
      jobsOutsideTarget: bucketJobDurations(run.jobs ?? []),
      status: run.status,
      url: run.url,
      wallMs,
    };
  });
}

export function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m${String(remainder).padStart(2, '0')}s`;
}

export function formatSummary(summary) {
  const lines = ['Recent completed CI runs:'];
  for (const run of summary) {
    lines.push(
      `- ${run.databaseId}: ${run.conclusion ?? run.status} wall=${formatDuration(run.wallMs)} ${run.url ?? ''}`.trim(),
    );
    for (const job of run.jobsOutsideTarget) {
      lines.push(
        `  - outside target: ${job.name} ${formatDuration(job.durationMs)} (${job.conclusion ?? 'unknown'})`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  const args = parseArgs(argv);
  const limit = Number(args.limit ?? 12);
  const workflow = String(args.workflow ?? 'CI');
  const runs = JSON.parse(
    execFileSync(
      'gh',
      [
        'run',
        'list',
        '--workflow',
        workflow,
        '--status',
        'completed',
        '--limit',
        String(limit),
        '--json',
        'databaseId,status,conclusion,createdAt,updatedAt,url',
      ],
      { encoding: 'utf8' },
    ),
  );
  const runsWithJobs = runs.map((run) => {
    const details = JSON.parse(
      execFileSync('gh', ['run', 'view', String(run.databaseId), '--json', 'jobs'], {
        encoding: 'utf8',
      }),
    );
    return { ...run, jobs: details.jobs ?? [] };
  });
  process.stdout.write(formatSummary(summarizeRuns(runsWithJobs)));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    args[key] = argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true;
  }
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exit(1);
  });
}

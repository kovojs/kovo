import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/devex-nightly.yml', import.meta.url), {
  encoding: 'utf8',
});

const ORDINARY_JOB_CONDITION =
  "if: ${{ github.event_name != 'workflow_dispatch' || inputs.ratify_hosted_budgets != true }}";
const RATIFICATION_JOB_CONDITION = 'if: ${{ inputs.ratify_hosted_budgets }}';

describe('DevEx Nightly workflow topology', () => {
  it('reserves a true ratification dispatch for the producer and hosted audit', () => {
    expect(jobConditions('package-producer')).toEqual([]);
    for (const job of ['benchmark', 'packed-journeys', 'full-catalog']) {
      expect(jobConditions(job)).toEqual([ORDINARY_JOB_CONDITION]);
    }
    expect(jobConditions('hosted-ratification')).toEqual([RATIFICATION_JOB_CONDITION]);
    expect(jobSource('hosted-ratification')).toMatch(
      /^    needs:\n      - package-producer\n    steps:/mu,
    );
  });

  it('keeps schedules and ordinary dispatches on the recurring jobs', () => {
    expect(dispatchTopology('schedule', undefined)).toEqual({
      hostedRatification: false,
      ordinaryJobs: true,
      packageProducer: true,
    });
    expect(dispatchTopology('workflow_dispatch', false)).toEqual({
      hostedRatification: false,
      ordinaryJobs: true,
      packageProducer: true,
    });
    expect(dispatchTopology('workflow_dispatch', true)).toEqual({
      hostedRatification: true,
      ordinaryJobs: false,
      packageProducer: true,
    });
  });
});

function dispatchTopology(eventName, ratifyHostedBudgets) {
  return {
    hostedRatification: ratifyHostedBudgets === true,
    ordinaryJobs: eventName !== 'workflow_dispatch' || ratifyHostedBudgets !== true,
    packageProducer: true,
  };
}

function jobConditions(job) {
  return jobSource(job)
    .split('\n')
    .filter((line) => /^ {4}if:/u.test(line))
    .map((line) => line.trim());
}

function jobSource(job) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${job}:`);
  if (start === -1) throw new Error(`DevEx Nightly workflow is missing job ${job}.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[a-z][a-z0-9-]*:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

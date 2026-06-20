// Flaky-test reporter for Kovo's Playwright integration suite.
//
// Detects tests that pass only after a retry (outcome() === 'flaky') and
// prints a clear annotation per flaky test plus a summary count at the end.
// When KOVO_FAIL_ON_FLAKY=1 is set, the reporter exits the process with a
// non-zero status so CI can opt into a hard flake gate.
//
// Wire into playwright.config.ts reporter array alongside 'dot'/'list' — this
// reporter is purely additive (it never suppresses other reporter output).

import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export default class FlakyReporter implements Reporter {
  private readonly flakyTests: Array<{ title: string; file: string; retries: number }> = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (test.outcome() !== 'flaky') return;
    this.flakyTests.push({
      file: test.location.file,
      retries: result.retry,
      title: test.titlePath().join(' > '),
    });
    // Emit an inline annotation so the flake is visible in streaming output.
    process.stdout.write(
      `\n[FLAKY] ${test.titlePath().join(' > ')} (passed on retry ${result.retry})\n`,
    );
  }

  onEnd(_result: FullResult): void {
    if (this.flakyTests.length === 0) return;

    process.stdout.write('\n--- Flaky test summary ---\n');
    for (const t of this.flakyTests) {
      process.stdout.write(`  FLAKY: ${t.title}\n`);
      process.stdout.write(`         ${t.file}\n`);
    }
    process.stdout.write(
      `\n${this.flakyTests.length} flaky test${this.flakyTests.length === 1 ? '' : 's'} detected (passed after retry).\n`,
    );

    if (process.env.KOVO_FAIL_ON_FLAKY === '1') {
      process.stdout.write(
        'KOVO_FAIL_ON_FLAKY=1: exiting non-zero because flaky tests were detected.\n',
      );
      process.exit(1);
    }
  }

  printsToStdio(): boolean {
    return true;
  }
}

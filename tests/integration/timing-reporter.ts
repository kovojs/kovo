import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

export default class TimingReporter implements Reporter {
  private readonly durations = new Map<string, number>();

  onTestEnd(test: TestCase, result: TestResult): void {
    const file = test.location.file.replaceAll('\\', '/');
    const key = `${test.parent.project()?.name ?? 'default'}:${file}`;
    this.durations.set(key, (this.durations.get(key) ?? 0) + result.duration / 1000);
  }

  onEnd(): void {
    const output = process.env.KOVO_PLAYWRIGHT_TIMING_JSON;
    if (!output) return;
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(
      output,
      `${JSON.stringify(
        Object.fromEntries(
          [...this.durations.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, seconds]) => [key, { seconds: Math.round(seconds * 1000) / 1000 }]),
        ),
        null,
        2,
      )}\n`,
    );
  }
}

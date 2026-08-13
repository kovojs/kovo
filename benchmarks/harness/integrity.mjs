/**
 * Refuse browser evidence shaped by transport failures, HTTP errors, or incomplete traversal.
 *
 * Kept outside run-all.mjs so the rejection policy itself is regression-testable without starting
 * browsers or production servers (plans/good-perf.md measurement contract).
 */
export function measurementIntegrityFindings(runs) {
  const problems = [];
  const notes = [];
  for (const run of runs) {
    if (run.integrity?.complete !== true || (run.integrity?.errors?.length ?? 0) > 0) {
      problems.push(
        `${run.app}/browser-adapter: ${
          run.integrity?.errors?.join('; ') || 'integrity verdict was absent or incomplete'
        }.`,
      );
    }
    for (const [conditionName, condition] of Object.entries(run.conditions ?? {})) {
      for (const [scenarioName, scenario] of Object.entries(condition)) {
        for (const iteration of scenario?.iterations ?? []) {
          const where = `${run.app}/${conditionName}/${scenarioName}`;
          if (iteration.rateLimitedResponses > 0) {
            problems.push(
              `${where}: ${iteration.rateLimitedResponses} HTTP 429 responses — the server shed ` +
                `load, so these timings are not comparable.`,
            );
          }
          if (iteration.errorResponses > 0) {
            problems.push(`${where}: ${iteration.errorResponses} HTTP >=400 responses.`);
          }
          if (iteration.failedRequests > 0) {
            problems.push(
              `${where}: ${iteration.failedRequests} requests failed at the network layer ` +
                `(${(iteration.failureReasons ?? []).join(', ') || 'no reason reported'}) — the ` +
                `page did not receive the bytes this iteration claims to have measured.`,
            );
          }
        }
      }
    }

    for (const cell of run.lighthouse ?? []) {
      const where = `${run.app}/lighthouse/${cell.formFactor}${cell.path}`;
      const network = cell.network;
      if (!network || network.tracked !== true) {
        notes.push(`${where}: HTTP statuses were not observable for this cell.`);
        continue;
      }
      if (network.rateLimitedResponses > 0) {
        problems.push(
          `${where}: ${network.rateLimitedResponses} HTTP 429 responses across ${cell.repeats} ` +
            `Lighthouse repeats — the server shed load while Lighthouse was scoring it.`,
        );
      }
      if (network.errorResponses > 0) {
        problems.push(`${where}: ${network.errorResponses} HTTP >=400 responses.`);
      }
      if (network.failedRequests > 0) {
        problems.push(`${where}: ${network.failedRequests} transport failures.`);
      }
      if (network.pageErrors > 0) {
        problems.push(`${where}: ${network.pageErrors} uncaught browser errors.`);
      }
    }

    for (const [index, iteration] of (run.bfcache?.iterations ?? []).entries()) {
      const where = `${run.app}/bfcache/${index}`;
      if (iteration.evidenceComplete !== true) {
        problems.push(`${where}: history traversal evidence was incomplete.`);
      }
      const network = iteration.network;
      if (!network) {
        notes.push(`${where}: HTTP statuses were not observable for this probe iteration.`);
        continue;
      }
      if (network.rateLimitedResponses > 0) {
        problems.push(
          `${where}: ${network.rateLimitedResponses} HTTP 429 responses — the back/forward-cache ` +
            `verdict was taken against a shedding server.`,
        );
      }
      if (network.errorResponses > 0) {
        problems.push(`${where}: ${network.errorResponses} HTTP >=400 responses.`);
      }
    }
  }
  return { notes: [...new Set(notes)], problems: [...new Set(problems)] };
}

export function assertMeasurementIntegrity(runs, writeNote = (note) => process.stderr.write(note)) {
  const { notes, problems } = measurementIntegrityFindings(runs);
  for (const note of notes) writeNote(`[integrity] untracked: ${note}\n`);
  if (problems.length > 0) {
    throw new Error(
      `Benchmark run rejected — the measurement was not clean:\n${problems
        .map((problem) => `  ${problem}`)
        .join('\n')}`,
    );
  }
}

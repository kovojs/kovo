const RUNTIME_FAILURE =
  /(?:ERR_MODULE_NOT_FOUND|Cannot find package|node:internal\/|SyntaxError:|ReferenceError:)/u;
const USAGE_FAILURE = /(?:usage:|unknown command)/iu;
const MISSING_GRAPH_DIAGNOSTIC =
  /(?:ERROR KV\d{3}[^\n]*(?:source graph|graph input|explicit artifact)|kovo:[^\n]*(?:source graph|graph input|explicit artifact)[^\n]*(?:required|missing|not found))/iu;

/**
 * Convert one fully observed packed CLI execution into the bounded known-failure outcome.
 * Unrecognized non-zero exits remain infrastructure errors rather than accidental passes.
 */
export function packedCliContractOutcome(mode, result) {
  if (
    result?.error ||
    result?.signal ||
    result?.status === null ||
    !Number.isInteger(result?.status)
  ) {
    return null;
  }
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const combined = `${stdout}\n${stderr}`;
  if (RUNTIME_FAILURE.test(combined)) return null;

  if (mode === 'help') {
    const renderedHelp = /(?:usage|commands):/iu.test(combined);
    if (result.status === 0 && renderedHelp && stderr.trim().length === 0) {
      return 'desired-behavior';
    }
    if (
      result.status === 1 &&
      (renderedHelp || /unknown command ["']--help["']/iu.test(combined))
    ) {
      return 'defect-reproduced';
    }
    return null;
  }

  if (mode === 'empty-check') {
    if (
      result.status === 1 &&
      MISSING_GRAPH_DIAGNOSTIC.test(combined) &&
      !USAGE_FAILURE.test(combined)
    ) {
      return 'desired-behavior';
    }
    if (
      result.status === 0 &&
      stderr.trim().length === 0 &&
      /^kovo-check\/v1\r?\nOK\r?\n?$/u.test(stdout)
    ) {
      return 'defect-reproduced';
    }
  }
  return null;
}

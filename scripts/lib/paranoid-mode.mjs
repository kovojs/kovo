export function isParanoidMode(env = process.env) {
  const value = env.KOVO_PARANOID;
  return value === '1' || value === 'true';
}

export function staticClassifierGateResult({ findings, scanned, cleanSummary, violationSummary }, options = {}) {
  const paranoidMode = options.paranoidMode ?? isParanoidMode(options.env);
  return {
    advisory: paranoidMode && findings.length > 0,
    findings,
    ok: paranoidMode || findings.length === 0,
    paranoidMode,
    summary:
      findings.length === 0
        ? cleanSummary(scanned, paranoidMode)
        : violationSummary(findings.length, paranoidMode),
  };
}

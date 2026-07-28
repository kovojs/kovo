/** Fail when a committed generated artifact differs from its authoritative rendering. */
export function assertGeneratedArtifactText({ actual, expected, label, regenerate }) {
  if (actual === expected) return;
  throw new Error(`${label} is stale; run ${regenerate}.`);
}

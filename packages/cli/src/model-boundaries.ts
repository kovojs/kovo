import replayModelBoundary from './replay-model-boundary.json' with { type: 'json' };
import type { KovoCheckResult } from './shared.js';

/** Stable, graph-independent honesty view for the bounded replay interleaving model (SPEC §10.3). */
export function modelBoundariesExplainResult(version: string): KovoCheckResult {
  const lines = [
    version,
    `MODEL-BOUNDARY ${replayModelBoundary.id} status=${replayModelBoundary.status}`,
    `AXIOM ${replayModelBoundary.atomicityAxiom.id} classification=${replayModelBoundary.atomicityAxiom.classification} verified=${String(replayModelBoundary.atomicityAxiom.verified)}`,
    `AXIOM-DETAIL ${JSON.stringify(replayModelBoundary.atomicityAxiom.detail)}`,
    `JUSTIFICATION ${JSON.stringify(replayModelBoundary.atomicityAxiom.justification)}`,
    [
      `BOUND replicas=${replayModelBoundary.bounds.replicas}`,
      `slots=${replayModelBoundary.bounds.slots}`,
      `identities=${replayModelBoundary.bounds.identities}`,
      `backwardClockSteps=${replayModelBoundary.bounds.backwardClockSteps}`,
      `crashPoints=${replayModelBoundary.bounds.crashPoints}`,
    ].join(' '),
  ];
  for (const action of replayModelBoundary.modeledActions) lines.push(`MODELED ${action}`);
  for (const action of replayModelBoundary.notModeledActions) {
    lines.push(`NOT-MODELED-ACTION ${action}`);
  }
  for (const phenomenon of replayModelBoundary.notModeledPhenomena) {
    lines.push(`NOT-MODELED-PHENOMENON ${phenomenon.id} ${JSON.stringify(phenomenon.detail)}`);
  }
  lines.push(
    [
      `SUMMARY modeledActions=${replayModelBoundary.modeledActions.length}`,
      `notModeledActions=${replayModelBoundary.notModeledActions.length}`,
      `notModeledPhenomena=${replayModelBoundary.notModeledPhenomena.length}`,
    ].join(' '),
  );
  return { exitCode: 0, output: `${lines.join('\n')}\n` };
}

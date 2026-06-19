import { diagnosticFor, type CompilerDiagnostic } from '../diagnostics.js';
import { callExpressions, type ComponentModuleModel } from '../scan/parse.js';

export function validateUntrackedClockReadsInDerives(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];

  for (const call of callExpressions(model)) {
    if (call.name !== 'derive' || !call.exportedConstName) continue;

    const reads = call.argumentTemporalReads[1] ?? [];
    for (const read of reads) {
      diagnostics.push({
        ...diagnosticFor(fileName, 'KV315', source, read.start, read.end - read.start),
        message: `${diagnosticFor(fileName, 'KV315').message} ${read.kind} in ${call.exportedConstName}`,
      });
    }
  }

  return diagnostics;
}

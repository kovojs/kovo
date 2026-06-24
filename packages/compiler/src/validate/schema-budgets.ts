import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import type { ComponentModuleModel } from '../scan/parse.js';

/** Lint unbounded breadth in untrusted wire schemas; runtime budgets remain the protection (SPEC §6.3/§11.3, KV430). */
export function validateWireSchemaBudgets(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  return model.wireSchemaBudgets.flatMap((schema) =>
    schema.collections.flatMap((collection) => {
      if (collection.bounded) return [];
      return [
        diagnostics.at(
          'KV430',
          { length: collection.end - collection.start, start: collection.start },
          `${schema.surfaceKind}="${schema.surfaceName}" schema="${schema.schemaRole}" collection="${collection.kind}" requires explicit .max(...).`,
        ),
      ];
    }),
  );
}

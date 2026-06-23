import {
  jsxElements,
  jsxExpressions,
  type ComponentModuleModel,
  type JsxExpressionModel,
  type SourceSpan,
} from '../scan/parse.js';
import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';

export function validateDeferJsxChildren(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const childContainers = new Set(
    jsxElements(model).flatMap((element) => element.childExpressionContainers.map(spanKey)),
  );

  return jsxExpressions(model)
    .filter((expression) => expression.callName === 'defer')
    .filter((expression) =>
      childContainers.has(
        spanKey({ start: expression.containerStart, end: expression.containerEnd }),
      ),
    )
    .map((expression) => deferJsxChildDiagnostic(diagnostics, expression));
}

function deferJsxChildDiagnostic(
  diagnostics: DiagnosticFactory,
  expression: JsxExpressionModel,
): CompilerDiagnostic {
  return diagnostics.at(
    'KV244',
    {
      start: expression.start,
      length: expression.end - expression.start,
    },
    'defer(...)',
  );
}

function spanKey(span: SourceSpan): string {
  return `${span.start}:${span.end}`;
}

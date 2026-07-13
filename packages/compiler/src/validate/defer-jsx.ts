import {
  jsxElements,
  jsxExpressions,
  type ComponentModuleModel,
  type JsxExpressionModel,
  type SourceSpan,
} from '../scan/parse.js';
import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
} from '../compiler-security-intrinsics.js';

export function validateDeferJsxChildren(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const childContainers = compilerCreateSet<string>();
  const elements = jsxElements(model);
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const containers = elements[elementIndex]!.childExpressionContainers;
    const containerLength = compilerArrayLength(containers, 'Defer JSX child containers');
    for (let containerIndex = 0; containerIndex < containerLength; containerIndex += 1) {
      const container = compilerOwnDataValue(
        containers,
        containerIndex,
        'Defer JSX child containers',
      ) as SourceSpan | undefined;
      if (!container)
        throw new TypeError(`Defer JSX child containers[${containerIndex}] must be own data.`);
      compilerSetAdd(childContainers, spanKey(container));
    }
  }

  const result: CompilerDiagnostic[] = [];
  const expressions = jsxExpressions(model);
  for (let index = 0; index < expressions.length; index += 1) {
    const expression = expressions[index]!;
    if (
      expression.callName === 'defer' &&
      compilerSetHas(
        childContainers,
        spanKey({ start: expression.containerStart, end: expression.containerEnd }),
      )
    ) {
      compilerArrayAppend(
        result,
        deferJsxChildDiagnostic(diagnostics, expression),
        'Defer JSX diagnostics',
      );
    }
  }
  return result;
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

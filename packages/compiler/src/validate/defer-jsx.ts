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
  compilerFailClosed,
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
  const elementLength = compilerArrayLength(elements, 'Defer JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(elements, elementIndex, 'Defer JSX elements') as
      | (typeof elements)[number]
      | undefined;
    if (!element) compilerFailClosed(`Defer JSX elements[${elementIndex}] must be own data.`);
    const containers = element.childExpressionContainers;
    const containerLength = compilerArrayLength(containers, 'Defer JSX child containers');
    for (let containerIndex = 0; containerIndex < containerLength; containerIndex += 1) {
      const container = compilerOwnDataValue(
        containers,
        containerIndex,
        'Defer JSX child containers',
      ) as SourceSpan | undefined;
      if (!container) {
        compilerFailClosed(`Defer JSX child containers[${containerIndex}] must be own data.`);
      }
      compilerSetAdd(childContainers, spanKey(container));
    }
  }

  const result: CompilerDiagnostic[] = [];
  const expressions = jsxExpressions(model);
  const expressionLength = compilerArrayLength(expressions, 'Defer JSX expressions');
  for (let index = 0; index < expressionLength; index += 1) {
    const expression = compilerOwnDataValue(expressions, index, 'Defer JSX expressions') as
      | (typeof expressions)[number]
      | undefined;
    if (!expression) compilerFailClosed(`Defer JSX expressions[${index}] must be own data.`);
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

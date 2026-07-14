import { securityClassifier } from '@kovojs/core/internal/security-markers';

import type { CompilerDiagnostic, DiagnosticFactory } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerFailClosed,
  compilerOwnDataValue,
} from '../compiler-security-intrinsics.js';
import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type JsxSpreadAttributeModel,
} from '../scan/parse.js';

/**
 * Refuse DOM-style callback props that survive lowering on a component tag.
 *
 * SPEC §5.2: only host elements and parser-proven `@kovojs/ui` boundaries have compiler-owned
 * browser event lowering. An `onX` on any other component tag is an executable closure crossing a
 * component prop boundary; it must not be mistaken for a host event and copied into the generated
 * client module.
 */
export const validateComponentEventProps = securityClassifier(
  'compiler.component-event-props.validate',
  function (diagnostics: DiagnosticFactory, model: ComponentModuleModel): CompilerDiagnostic[] {
    const result: CompilerDiagnostic[] = [];
    const elements = jsxElements(model);
    const elementLength = compilerArrayLength(elements, 'Component event-prop JSX elements');
    for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
      const element = compilerOwnDataValue(
        elements,
        elementIndex,
        'Component event-prop JSX elements',
      ) as JsxElementModel | undefined;
      if (!element) {
        compilerFailClosed(`Component event-prop JSX elements[${elementIndex}] must be own data.`);
      }
      const attributeLength = compilerArrayLength(
        element.attributes,
        'Component event-prop JSX attributes',
      );
      for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
        const attribute = compilerOwnDataValue(
          element.attributes,
          attributeIndex,
          'Component event-prop JSX attributes',
        ) as JsxAttributeModel | undefined;
        if (!attribute) {
          compilerFailClosed(
            `Component event-prop JSX attributes[${attributeIndex}] must be own data.`,
          );
        }
        if (attribute.componentEventProp !== true) continue;
        compilerArrayAppend(
          result,
          componentEventPropDiagnostic(diagnostics, element, {
            end: attribute.end,
            name: attribute.name,
            start: attribute.start,
          }),
          'Component event-prop diagnostics',
        );
      }
      const spreadLength = compilerArrayLength(
        element.spreadAttributes,
        'Component event-prop JSX spreads',
      );
      for (let spreadIndex = 0; spreadIndex < spreadLength; spreadIndex += 1) {
        const spread = compilerOwnDataValue(
          element.spreadAttributes,
          spreadIndex,
          'Component event-prop JSX spreads',
        ) as JsxSpreadAttributeModel | undefined;
        if (!spread) {
          compilerFailClosed(`Component event-prop JSX spreads[${spreadIndex}] must be own data.`);
        }
        const names = spread.componentEventPropNames ?? [];
        appendKnownComponentEventDiagnostics(result, diagnostics, element, spread, names);
      }
    }
    return result;
  },
);

function appendKnownComponentEventDiagnostics(
  result: CompilerDiagnostic[],
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
  span: Pick<JsxAttributeModel, 'end' | 'start'>,
  names: readonly string[],
): void {
  const nameLength = compilerArrayLength(names, 'Known component event-prop names');
  for (let nameIndex = 0; nameIndex < nameLength; nameIndex += 1) {
    const name = compilerOwnDataValue(names, nameIndex, 'Known component event-prop names');
    if (typeof name !== 'string') {
      compilerFailClosed(`Known component event-prop names[${nameIndex}] must be a string.`);
    }
    compilerArrayAppend(
      result,
      componentEventPropDiagnostic(diagnostics, element, {
        end: span.end,
        name,
        start: span.start,
      }),
      'Component event-prop diagnostics',
    );
  }
}

function componentEventPropDiagnostic(
  diagnostics: DiagnosticFactory,
  element: JsxElementModel,
  attribute: Pick<JsxAttributeModel, 'end' | 'name' | 'start'>,
): CompilerDiagnostic {
  const diagnostic = diagnostics.at('KV201', {
    start: attribute.start,
    length: attribute.end - attribute.start,
  });
  return {
    ...diagnostic,
    help: compilerArrayJoin(
      [
        `Would lower to: serializable props on <${element.tag}> and a DOM event handler on the native element that owns the behavior.`,
        `Blocked reason: ${attribute.name} on a component tag is an executable callback prop; treating it as a host event can copy server-only captures into the generated client module.`,
        'Fixes: pass serializable data props, and attach the event handler to a native element inside the component that owns the interaction.',
        'Escape: none; executable callback props cannot cross the component render boundary.',
        'SPEC §5.2 requires compiler-owned, auditable handler lowering and explicit serializable capture channels.',
      ],
      '\n',
    ),
    message: `Component event callback prop cannot cross the render boundary. <${element.tag}> ${attribute.name}`,
  };
}

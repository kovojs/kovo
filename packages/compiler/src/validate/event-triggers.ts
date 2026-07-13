import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
} from '../compiler-security-intrinsics.js';
import { jsxComments, jsxElements, type ComponentModuleModel } from '../scan/parse.js';

const declaredExecutionTriggers = compilerCreateSet<string>();
compilerSetAdd(declaredExecutionTriggers, 'idle');
compilerSetAdd(declaredExecutionTriggers, 'load');
compilerSetAdd(declaredExecutionTriggers, 'visible');

const delegatedDomEvents = compilerCreateSet<string>();
for (const name of [
  'beforeinput',
  'blur',
  'change',
  'click',
  'close',
  'contextmenu',
  'dblclick',
  'focus',
  'focusin',
  'focusout',
  'input',
  'keydown',
  'keyup',
  'pointercancel',
  'pointerdown',
  'pointerenter',
  'pointerleave',
  'pointermove',
  'pointerout',
  'pointerover',
  'pointerup',
  'reset',
  'submit',
  'toggle',
] as const) {
  compilerSetAdd(delegatedDomEvents, name);
}

export function validateEventTriggerNames(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const result: CompilerDiagnostic[] = [];
  const attributes = eventTriggerAttributes(model);
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (!isKnownEventOrTrigger(attribute.name)) {
      compilerArrayAppend(
        result,
        eventTriggerDiagnostic(diagnostics, 'KV212', attribute),
        'Event-trigger diagnostics',
      );
      continue;
    }

    if (attribute.name === 'load' && !hasKv211Justification(model, attribute.index)) {
      compilerArrayAppend(
        result,
        eventTriggerDiagnostic(diagnostics, 'KV211', attribute),
        'Event-trigger diagnostics',
      );
    }
  }
  return result;
}

function eventTriggerAttributes(
  model: ComponentModuleModel,
): Array<{ index: number; name: string }> {
  const result: Array<{ index: number; name: string }> = [];
  const elements = jsxElements(model);
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const attributeLength = compilerArrayLength(element.attributes, 'Event-trigger attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Event-trigger attributes',
      ) as (typeof element.attributes)[number] | undefined;
      if (!attribute)
        throw new TypeError(`Event-trigger attributes[${attributeIndex}] must be own data.`);
      const name = attribute.executionTriggerName;
      if (name !== undefined) {
        compilerArrayAppend(
          result,
          { index: attribute.start, name },
          'Event-trigger attribute facts',
        );
      }
    }
  }
  return result;
}

function isKnownEventOrTrigger(name: string): boolean {
  return (
    compilerSetHas(declaredExecutionTriggers, name) || compilerSetHas(delegatedDomEvents, name)
  );
}

function hasKv211Justification(model: ComponentModuleModel, index: number): boolean {
  // SPEC §5.2: consume the typed `justifiedDiagnostics` parser fact rather than re-scanning the raw
  // comment text for the KV211 code at validation time.
  const comments = jsxComments(model);
  for (let commentIndex = 0; commentIndex < comments.length; commentIndex += 1) {
    const comment = comments[commentIndex]!;
    if (comment.attachedAttributeStart !== index || !comment.justifiedDiagnostics) continue;
    const codeLength = compilerArrayLength(
      comment.justifiedDiagnostics,
      'JSX justified diagnostic codes',
    );
    for (let codeIndex = 0; codeIndex < codeLength; codeIndex += 1) {
      if (
        compilerOwnDataValue(
          comment.justifiedDiagnostics,
          codeIndex,
          'JSX justified diagnostic codes',
        ) === 'KV211'
      ) {
        return true;
      }
    }
  }
  return false;
}

function eventTriggerDiagnostic(
  diagnostics: DiagnosticFactory,
  code: 'KV211' | 'KV212',
  attribute: { index: number; name: string },
): CompilerDiagnostic {
  return diagnostics.at(
    code,
    { start: attribute.index, length: attribute.name.length + 3 },
    `on:${attribute.name}`,
  );
}

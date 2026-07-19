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
import { jsxComments, jsxElements, type ComponentModuleModel } from '../scan/parse.js';

const declaredExecutionTriggers = compilerCreateSet<string>();
compilerSetAdd(declaredExecutionTriggers, 'idle');
compilerSetAdd(declaredExecutionTriggers, 'load');
compilerSetAdd(declaredExecutionTriggers, 'visible');

const delegatedDomEvents = compilerCreateSet<string>();
// Keep this compiler-owned typed-event vocabulary byte-for-byte aligned with the runtime's
// defaultDelegatedEvents plus its synthesized pointerenter/pointerleave pair (SPEC §4.4/§5.2).
const delegatedDomEventNames = [
  'animationend',
  'beforetoggle',
  'blur',
  'cancel',
  'change',
  'click',
  'contextmenu',
  'focus',
  'input',
  'keydown',
  'keyup',
  'paste',
  'pointerdown',
  'pointerenter',
  'pointerleave',
  'pointermove',
  'pointerup',
  'scroll',
  'submit',
] as const;
const delegatedDomEventNameLength = compilerArrayLength(
  delegatedDomEventNames,
  'Delegated DOM event names',
);
for (let index = 0; index < delegatedDomEventNameLength; index += 1) {
  const name = compilerOwnDataValue(delegatedDomEventNames, index, 'Delegated DOM event names');
  if (typeof name !== 'string') {
    compilerFailClosed(`Delegated DOM event names[${index}] must be a string.`);
  }
  compilerSetAdd(delegatedDomEvents, name);
}

export function validateEventTriggerNames(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
): CompilerDiagnostic[] {
  const result: CompilerDiagnostic[] = [];
  const attributes = eventTriggerAttributes(model);
  const attributeLength = compilerArrayLength(attributes, 'Event-trigger facts');
  for (let index = 0; index < attributeLength; index += 1) {
    const attribute = compilerOwnDataValue(attributes, index, 'Event-trigger facts') as
      | (typeof attributes)[number]
      | undefined;
    if (!attribute) compilerFailClosed(`Event-trigger facts[${index}] must be own data.`);
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
  const elementLength = compilerArrayLength(elements, 'Event-trigger elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(elements, elementIndex, 'Event-trigger elements') as
      | (typeof elements)[number]
      | undefined;
    if (!element) {
      compilerFailClosed(`Event-trigger elements[${elementIndex}] must be own data.`);
    }
    const attributeLength = compilerArrayLength(element.attributes, 'Event-trigger attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Event-trigger attributes',
      ) as (typeof element.attributes)[number] | undefined;
      if (!attribute) {
        compilerFailClosed(`Event-trigger attributes[${attributeIndex}] must be own data.`);
      }
      // Authored TSX uses typed onClick/onIdle/onVisible/onLoad props. Raw on:* is emitted IR and
      // is rejected by the authoring-surface gate; retaining only executionTriggerName here would
      // therefore make this validator unreachable from supported authoring syntax.
      const name = attribute.executionTriggerName ?? attribute.domEventName;
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
  const commentLength = compilerArrayLength(comments, 'JSX comments');
  for (let commentIndex = 0; commentIndex < commentLength; commentIndex += 1) {
    const comment = compilerOwnDataValue(comments, commentIndex, 'JSX comments') as
      | (typeof comments)[number]
      | undefined;
    if (!comment) compilerFailClosed(`JSX comments[${commentIndex}] must be own data.`);
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

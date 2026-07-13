import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerFailClosed,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
  compilerStringSplit,
} from '../compiler-security-intrinsics.js';
import { deriveComponentNames } from '../component-names.js';
import { type CompilerDiagnostic, type DiagnosticFactory } from '../diagnostics.js';
import {
  jsxElements,
  type ComponentModel,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type SourceSpan,
} from '../scan/parse.js';
import type { CompileComponentOptions } from '../types.js';

interface ComponentNameRegistration {
  component: ComponentModel;
  domName: string;
  effectiveName: string;
  span: SourceSpan | null;
}

interface FragmentTargetRegistration {
  component: ComponentModel;
  targetName: string;
  span: SourceSpan | null;
}

interface ViewTransitionRegistration {
  attribute: JsxAttributeModel & { value: string };
  component: ComponentModel | null;
  element: JsxElementModel;
  name: string;
}

export function validateDuplicateComponentNames(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const byName = compilerCreateMap<string, ComponentNameRegistration>();
  const registryNames = stringSet(
    registryFactStrings(options, 'registryFacts', 'components'),
    'Registry component names',
  );
  const previousNames = registryFactStrings(options, 'previousRegistryFacts', 'components');
  const previousRegistryNames = stringSet(previousNames, 'Previous registry component names');

  const componentLength = compilerArrayLength(model.components, 'Component name models');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = ownArrayEntry(model.components, componentIndex, 'Component name models');
    const registration = componentNameRegistration(component, options.fileName);
    if (compilerSetHas(registryNames, registration.effectiveName)) {
      appendDiagnostic(found, registryComponentNameDiagnostic(diagnostics, registration));
    }
    if (
      previousNames.length > 0 &&
      !compilerSetHas(previousRegistryNames, registration.effectiveName)
    ) {
      const previousName = previousRegistryNameForDomLeaf(previousNames, registration.domName);
      if (previousName) {
        appendDiagnostic(
          found,
          changedComponentNameDiagnostic(diagnostics, previousName, registration),
        );
      }
    }

    const previous = compilerMapGet(byName, registration.effectiveName);
    if (!previous) {
      compilerMapSet(byName, registration.effectiveName, registration);
      continue;
    }

    appendDiagnostic(found, duplicateComponentNameDiagnostic(diagnostics, previous, registration));
  }

  return found;
}

export function validateDuplicateFragmentTargetNames(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const byName = compilerCreateMap<string, FragmentTargetRegistration>();
  const registryNames = stringSet(
    registryFactStrings(options, 'registryFacts', 'fragmentTargets'),
    'Registry fragment target names',
  );

  const registrations = fragmentTargetRegistrations(model, options.fileName);
  const registrationLength = compilerArrayLength(registrations, 'Fragment target registrations');
  for (let index = 0; index < registrationLength; index += 1) {
    const registration = ownArrayEntry(registrations, index, 'Fragment target registrations');
    if (compilerSetHas(registryNames, registration.targetName)) {
      appendDiagnostic(found, registryFragmentTargetNameDiagnostic(diagnostics, registration));
    }

    const previous = compilerMapGet(byName, registration.targetName);
    if (!previous) {
      compilerMapSet(byName, registration.targetName, registration);
      continue;
    }

    appendDiagnostic(
      found,
      duplicateFragmentTargetNameDiagnostic(diagnostics, previous, registration),
    );
  }

  return found;
}

export function validateDuplicateStaticViewTransitionNames(
  diagnostics: DiagnosticFactory,
  model: ComponentModuleModel,
  options: CompileComponentOptions,
): CompilerDiagnostic[] {
  const found: CompilerDiagnostic[] = [];
  const byName = compilerCreateMap<string, ViewTransitionRegistration>();
  const registryNames = stringSet(
    registryFactStrings(options, 'registryFacts', 'viewTransitions'),
    'Registry view-transition names',
  );

  const registrations = viewTransitionRegistrations(model);
  const registrationLength = compilerArrayLength(registrations, 'View-transition registrations');
  for (let index = 0; index < registrationLength; index += 1) {
    const registration = ownArrayEntry(registrations, index, 'View-transition registrations');
    if (compilerSetHas(registryNames, registration.name)) {
      appendDiagnostic(found, registryViewTransitionNameDiagnostic(diagnostics, registration));
    }

    const previous = compilerMapGet(byName, registration.name);
    if (!previous) {
      compilerMapSet(byName, registration.name, registration);
      continue;
    }

    appendDiagnostic(
      found,
      duplicateViewTransitionNameDiagnostic(diagnostics, previous, registration),
    );
  }

  return found;
}

function componentNameRegistration(
  component: ComponentModel,
  fileName: string,
): ComponentNameRegistration {
  const names = deriveComponentNames(fileName, component);
  return {
    component,
    domName: names.domName,
    effectiveName: names.registryKey,
    span: component.localNameSpan ?? null,
  };
}

function previousRegistryNameForDomLeaf(
  previousRegistryNames: readonly string[],
  domName: string,
): string | null {
  const nameLength = compilerArrayLength(
    previousRegistryNames,
    'Previous registry component names',
  );
  for (let index = 0; index < nameLength; index += 1) {
    const previousName = ownArrayEntry(
      previousRegistryNames,
      index,
      'Previous registry component names',
    );
    if (registryNameLeaf(previousName) === domName) return previousName;
  }
  return null;
}

function registryNameLeaf(registryName: string): string {
  const parts = compilerStringSplit(registryName, '/');
  const partLength = compilerArrayLength(parts, 'Registry name path parts');
  return partLength === 0
    ? registryName
    : ownArrayEntry(parts, partLength - 1, 'Registry name path parts');
}

function fragmentTargetRegistrations(
  model: ComponentModuleModel,
  fileName: string,
): FragmentTargetRegistration[] {
  const registrations: FragmentTargetRegistration[] = [];
  const componentLength = compilerArrayLength(model.components, 'Fragment target components');
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const component = ownArrayEntry(model.components, componentIndex, 'Fragment target components');
    if (componentOption(component, 'disableServerRefresh')?.staticValue === true) continue;

    const queries = componentOption(component, 'queries')?.objectEntries;
    if (!queries || compilerArrayLength(queries, 'Fragment target query entries') === 0) continue;

    compilerArrayAppend(
      registrations,
      {
        component,
        span: component.localNameSpan ?? null,
        targetName: deriveComponentNames(fileName, component).registryKey,
      },
      'Fragment target registrations',
    );
  }
  return registrations;
}

function viewTransitionRegistrations(model: ComponentModuleModel): ViewTransitionRegistration[] {
  const registrations: ViewTransitionRegistration[] = [];
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'View-transition elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = ownArrayEntry(elements, elementIndex, 'View-transition elements');
    const attributeLength = compilerArrayLength(element.attributes, 'View-transition attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const candidate = ownArrayEntry(
        element.attributes,
        attributeIndex,
        'View-transition attributes',
      );
      if (candidate.name !== 'viewTransitionName' || candidate.value === undefined) continue;
      const attribute = candidate as JsxAttributeModel & { value: string };
      compilerArrayAppend(
        registrations,
        {
          attribute,
          component: componentForElement(model, element),
          element,
          name: attribute.value,
        },
        'View-transition registrations',
      );
      break;
    }
  }
  return registrations;
}

function componentOption(
  component: ComponentModel,
  key: string,
): ComponentModel['options'][number] | undefined {
  const optionLength = compilerArrayLength(component.options, 'Component options');
  for (let index = 0; index < optionLength; index += 1) {
    const option = ownArrayEntry(component.options, index, 'Component options');
    if (option.key === key) return option;
  }
  return undefined;
}

function duplicateComponentNameDiagnostic(
  diagnostics: DiagnosticFactory,
  first: ComponentNameRegistration,
  duplicate: ComponentNameRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV237;
  const duplicateSpan = duplicate.span;
  return {
    ...diagnostics.at('KV237', {
      start: duplicateSpan?.start,
      length: duplicateSpan ? duplicateSpan.end - duplicateSpan.start : undefined,
    }),
    help: compilerArrayJoin(
      [
        definition.help,
        `Effective name: ${duplicate.effectiveName}`,
        `First definition: ${componentLabel(first.component)}`,
        `Duplicate definition: ${componentLabel(duplicate.component)}`,
        'SPEC §6.1.1 package prefixes remain the cross-package namespace mechanism; app-authored/vendored components in one module must not share an effective wire name.',
      ],
      '\n',
    ),
    message: `${definition.message} ${duplicate.effectiveName} is used by ${componentLabel(first.component)} and ${componentLabel(duplicate.component)}.`,
  };
}

function registryComponentNameDiagnostic(
  diagnostics: DiagnosticFactory,
  duplicate: ComponentNameRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV237;
  const duplicateSpan = duplicate.span;
  return {
    ...diagnostics.at('KV237', {
      start: duplicateSpan?.start,
      length: duplicateSpan ? duplicateSpan.end - duplicateSpan.start : undefined,
    }),
    help: compilerArrayJoin(
      [
        definition.help,
        `Effective name: ${duplicate.effectiveName}`,
        `Registry definition: ${duplicate.effectiveName}`,
        `Duplicate definition: ${componentLabel(duplicate.component)}`,
        'SPEC §6.1.1 keeps effective names app-wide unique; registryFacts.components carries names already known to the app graph.',
      ],
      '\n',
    ),
    message: `${definition.message} ${duplicate.effectiveName} is already present in registry facts and is reused by ${componentLabel(duplicate.component)}.`,
  };
}

function changedComponentNameDiagnostic(
  diagnostics: DiagnosticFactory,
  previousName: string,
  current: ComponentNameRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV241;
  const span = current.span;
  return {
    ...diagnostics.at('KV241', {
      start: span?.start,
      length: span ? span.end - span.start : undefined,
    }),
    help: compilerArrayJoin(
      [
        definition.help,
        `Previous registry key: ${previousName}`,
        `Current registry key: ${current.effectiveName}`,
        `DOM leaf: ${current.domName}`,
        'Registry writer: previousRegistryFacts.components',
      ],
      '\n',
    ),
    message: `${definition.message} ${previousName} -> ${current.effectiveName}.`,
  };
}

function duplicateFragmentTargetNameDiagnostic(
  diagnostics: DiagnosticFactory,
  first: FragmentTargetRegistration,
  duplicate: FragmentTargetRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV238;
  const duplicateSpan = duplicate.span;
  return {
    ...diagnostics.at('KV238', {
      start: duplicateSpan?.start,
      length: duplicateSpan ? duplicateSpan.end - duplicateSpan.start : undefined,
    }),
    help: compilerArrayJoin(
      [
        definition.help,
        `Fragment target: ${duplicate.targetName}`,
        `First writer: ${componentLabel(first.component)}`,
        `Duplicate writer: ${componentLabel(duplicate.component)}`,
        registryFragmentTargetSnapshot(duplicate.targetName),
      ],
      '\n',
    ),
    message: `${definition.message} ${duplicate.targetName} is used by ${componentLabel(first.component)} and ${componentLabel(duplicate.component)}.`,
  };
}

function registryFragmentTargetNameDiagnostic(
  diagnostics: DiagnosticFactory,
  duplicate: FragmentTargetRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV238;
  const duplicateSpan = duplicate.span;
  return {
    ...diagnostics.at('KV238', {
      start: duplicateSpan?.start,
      length: duplicateSpan ? duplicateSpan.end - duplicateSpan.start : undefined,
    }),
    help: compilerArrayJoin(
      [
        definition.help,
        `Fragment target: ${duplicate.targetName}`,
        `Registry writer: registryFacts.fragmentTargets`,
        `Duplicate writer: ${componentLabel(duplicate.component)}`,
        registryFragmentTargetSnapshot(duplicate.targetName),
      ],
      '\n',
    ),
    message: `${definition.message} ${duplicate.targetName} is already present in registry facts and is reused by ${componentLabel(duplicate.component)}.`,
  };
}

function duplicateViewTransitionNameDiagnostic(
  diagnostics: DiagnosticFactory,
  first: ViewTransitionRegistration,
  duplicate: ViewTransitionRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV239;
  return {
    ...diagnostics.at('KV239', {
      start: duplicate.attribute.start,
      length: duplicate.attribute.end - duplicate.attribute.start,
    }),
    help: compilerArrayJoin(
      [
        definition.help,
        `View-transition name: ${duplicate.name}`,
        `First writer: ${viewTransitionLabel(first)}`,
        `Duplicate writer: ${viewTransitionLabel(duplicate)}`,
        registryViewTransitionSnapshot(duplicate.name),
        'Scope: module-local static rendered source plus registryFacts.viewTransitions when supplied; dynamic names require page-composition proof outside this validator.',
      ],
      '\n',
    ),
    message: `${definition.message} ${duplicate.name} is used by ${viewTransitionLabel(first)} and ${viewTransitionLabel(duplicate)}.`,
  };
}

function registryViewTransitionNameDiagnostic(
  diagnostics: DiagnosticFactory,
  duplicate: ViewTransitionRegistration,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions.KV239;
  return {
    ...diagnostics.at('KV239', {
      start: duplicate.attribute.start,
      length: duplicate.attribute.end - duplicate.attribute.start,
    }),
    help: compilerArrayJoin(
      [
        definition.help,
        `View-transition name: ${duplicate.name}`,
        `Registry writer: registryFacts.viewTransitions`,
        `Duplicate writer: ${viewTransitionLabel(duplicate)}`,
        registryViewTransitionSnapshot(duplicate.name),
        'Scope: module-local static rendered source plus registryFacts.viewTransitions when supplied; dynamic names require page-composition proof outside this validator.',
      ],
      '\n',
    ),
    message: `${definition.message} ${duplicate.name} is already present in registry facts and is reused by ${viewTransitionLabel(duplicate)}.`,
  };
}

function componentLabel(component: ComponentModel): string {
  return component.localName ?? 'anonymous component';
}

function componentForElement(
  model: ComponentModuleModel,
  element: JsxElementModel,
): ComponentModel | null {
  const componentLength = compilerArrayLength(model.components, 'View-transition components');
  if (componentLength === 1) {
    return ownArrayEntry(model.components, 0, 'View-transition components');
  }
  for (let index = 0; index < componentLength; index += 1) {
    const component = ownArrayEntry(model.components, index, 'View-transition components');
    if (
      component.renderHost !== undefined &&
      element.start >= component.renderHost.start &&
      element.end <= component.renderHost.end
    ) {
      return component;
    }
  }
  return null;
}

function viewTransitionLabel(registration: ViewTransitionRegistration): string {
  const component = registration.component ? `${componentLabel(registration.component)} ` : '';
  return `${component}<${registration.element.tag}>`;
}

function registryFragmentTargetSnapshot(targetName: string): string {
  return `Would emit registry:\ninterface FragmentTargets {\n  '${targetName}': ...;\n}`;
}

function registryViewTransitionSnapshot(name: string): string {
  return `Would emit registry:\ninterface ViewTransitions {\n  '${name}': unknown;\n}`;
}

function registryFactStrings(
  options: CompileComponentOptions,
  factsProperty: 'previousRegistryFacts' | 'registryFacts',
  valueProperty: 'components' | 'fragmentTargets' | 'viewTransitions',
): string[] {
  const facts = compilerOwnDataValue(options, factsProperty, 'Component name compile options');
  if (facts === undefined) return [];
  if (!facts || typeof facts !== 'object' || compilerArrayIsArray(facts)) {
    compilerFailClosed(`Component name ${factsProperty} must be an object.`);
  }
  const values = compilerOwnDataValue(facts, valueProperty, `Component name ${factsProperty}`);
  if (values === undefined) return [];
  if (!compilerArrayIsArray(values)) {
    compilerFailClosed(`Component name ${factsProperty}.${valueProperty} must be an array.`);
  }
  const result: string[] = [];
  const valueLength = compilerArrayLength(
    values,
    `Component name ${factsProperty}.${valueProperty}`,
  );
  for (let index = 0; index < valueLength; index += 1) {
    const value = compilerOwnDataValue(
      values,
      index,
      `Component name ${factsProperty}.${valueProperty}`,
    );
    if (typeof value !== 'string') {
      compilerFailClosed(
        `Component name ${factsProperty}.${valueProperty}[${index}] must be a string.`,
      );
    }
    compilerArrayAppend(result, value, `Component name ${factsProperty}.${valueProperty}`);
  }
  return result;
}

function stringSet(values: readonly string[], label: string): Set<string> {
  const result = compilerCreateSet<string>();
  const valueLength = compilerArrayLength(values, label);
  for (let index = 0; index < valueLength; index += 1) {
    compilerSetAdd(result, ownArrayEntry(values, index, label));
  }
  return result;
}

function appendDiagnostic(diagnostics: CompilerDiagnostic[], diagnostic: CompilerDiagnostic): void {
  compilerArrayAppend(diagnostics, diagnostic, 'Component name diagnostics');
}

function ownArrayEntry<T>(values: readonly T[], index: number, label: string): T {
  const value = compilerOwnDataValue(values, index, label) as T | undefined;
  if (value === undefined) compilerFailClosed(`${label}[${index}] must be own data.`);
  return value;
}

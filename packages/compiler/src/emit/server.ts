import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { compilerIrHeader } from '../ir.js';
import {
  componentOptionObjectKeys,
  componentRenderHost,
  componentRenderHostElement,
  componentStateReturnObjectModel,
  firstComponentModel,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import {
  applySourceReplacements,
  escapeAttribute,
  splitDepValue,
  type SourceReplacement,
} from '../shared.js';
import {
  emitElementParamTypes,
  type HandlerLowering,
  type RenderEquivalenceCheck,
} from '../types.js';

export interface ServerRenderLowering {
  replacements: SourceReplacement[];
}

export function emitServerModule(renderedSource: string): string {
  return `${compilerIrHeader}
export function renderSource() {
  return ${templateLiteral(renderedSource)};
}
`;
}

export function serverRenderLowering(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
): ServerRenderLowering {
  return { replacements: serverRenderPatches(handlers, model) };
}

export function renderEquivalenceCheck(
  artifact: string,
  expected: string,
  serverSource: string,
): RenderEquivalenceCheck {
  const actual = emittedServerRenderSource(serverSource);

  return {
    actual,
    artifact,
    expected,
    ok: actual === expected,
  };
}

function emittedServerRenderSource(serverSource: string): string {
  const executable = executableRenderSource(serverSource);
  if (!executable) return '';

  try {
    const actual = runInNewContext(executable, {}, { timeout: 1000 });
    return typeof actual === 'string' ? actual : '';
  } catch {
    return '';
  }
}

function executableRenderSource(serverSource: string): string | null {
  const sourceFile = ts.createSourceFile('render.server.ts', serverSource, ts.ScriptTarget.Latest);
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'renderSource' &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
        true,
  );
  if (!declaration) return null;

  const exportModifier = declaration.modifiers?.find(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
  if (!exportModifier) return null;

  const prelude = serverSource.slice(0, exportModifier.getStart(sourceFile)).trim();
  if (prelude !== compilerIrHeader) return null;

  // SPEC 5.2.3 requires render(src) to equal render(compile(src)); execute the emitted
  // renderSource body instead of re-reading its template literal as inert text.
  return `${applySourceReplacements(serverSource, [
    {
      end: exportModifier.getEnd(),
      replacement: '',
      start: exportModifier.getStart(sourceFile),
    },
  ])}
;renderSource();`;
}

function serverRenderPatches(
  handlers: readonly HandlerLowering[],
  model: ComponentModuleModel,
): SourceReplacement[] {
  const host = componentRenderHost(model);
  const patches: SourceReplacement[] = [];
  const hostHandlers = host
    ? handlers.filter(
        (handler) => handler.attributeStart >= host.start && handler.attributeEnd <= host.end,
      )
    : [];

  for (const handler of handlers) {
    if (hostHandlers.includes(handler)) continue;
    patches.push({
      end: handler.attributeEnd,
      replacement: handlerAttributeReplacement(handler),
      start: handler.attributeStart,
    });
  }

  if (host) {
    const hostElement = componentRenderHostElement(model);
    if (!hostElement) return patches;

    patches.push(...hostHandlers.map(handlerSourceReplacement));
    patches.push(...renderHostStampPatches(model, hostElement));
  }

  return patches;
}

function handlerSourceReplacement(handler: HandlerLowering): SourceReplacement {
  return {
    end: handler.attributeEnd,
    replacement: handlerAttributeReplacement(handler),
    start: handler.attributeStart,
  };
}

function handlerAttributeReplacement(handler: HandlerLowering): string {
  return [
    `${handler.attributeName}="${handler.attributeValue}"`,
    emitElementParamTypes(handler.params),
    ...handler.params.map((param) => `${param.attributeName}="${escapeAttribute(param.value)}"`),
  ]
    .filter(Boolean)
    .join(' ');
}

function renderHostStampPatches(
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
): SourceReplacement[] {
  const patches: SourceReplacement[] = [];
  const insertedAttributes: string[] = [];
  const componentIdentity = componentIdentityStamp(model, hostElement);
  const declaredQueryDeps = declaredQueryDepsStamp(model, hostElement);
  const stateJson = staticStateJson(model);

  if (componentIdentity) insertedAttributes.push(componentIdentity);

  if (declaredQueryDeps) {
    const existing = hostElement.attributes.find((attribute) => attribute.name === 'fw-deps');
    if (existing) {
      patches.push({
        end: existing.end,
        replacement: declaredQueryDeps,
        start: existing.start,
      });
    } else {
      insertedAttributes.push(declaredQueryDeps);
    }
  }

  if (stateJson) insertedAttributes.push(`fw-state="${escapeAttribute(stateJson)}"`);

  if (insertedAttributes.length > 0) {
    const insertion = openingTagAttributeInsertion(hostElement, insertedAttributes);
    patches.push({
      end: insertion.position,
      replacement: insertion.replacement,
      start: insertion.position,
    });
  }

  return patches;
}

// SPEC.md §4.2: component identity is the fw-c stamp. The compiler omits it
// when the host tag already spells the component name (dashed tags are inert
// sugar) and emits it explicitly on native hosts (`<tr fw-c="cart-row">`), so
// authored sugar never hand-writes the stamp (§4.8 residual-string rule).
function componentIdentityStamp(
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
): string | null {
  const componentName = firstComponentModel(model)?.explicitName;
  if (!componentName) return null;

  const tagName = hostElement.tag;
  if (tagName !== tagName.toLowerCase()) return null;
  if (tagName === componentName || tagName.includes('-')) return null;
  if (hostElement.attributes.some((attribute) => attribute.name === 'fw-c')) return null;

  return `fw-c="${escapeAttribute(componentName)}"`;
}

function declaredQueryDepsStamp(
  model: ComponentModuleModel,
  hostElement: JsxElementModel,
): string | null {
  const deps = componentOptionObjectKeys(model, 'queries');
  if (deps.length === 0) return null;

  const existing = hostElement.attributes.find((attribute) => attribute.name === 'fw-deps');
  const existingDeps = splitDepValue(existing?.value ?? '');
  const depValue = mergeDepValues(existingDeps, deps).join(' ');
  return `fw-deps="${escapeAttribute(depValue)}"`;
}

function mergeDepValues(existing: readonly string[], declared: readonly string[]): string[] {
  return [...new Set([...existing, ...declared])];
}

function staticStateJson(model: ComponentModuleModel): string | null {
  const stateObject = componentStateReturnObjectModel(model);
  return stateObject?.staticValue ? JSON.stringify(stateObject.staticValue) : null;
}

function openingTagAttributeInsertion(
  hostElement: JsxElementModel,
  attributes: readonly string[],
): { position: number; replacement: string } {
  const attributeSource = attributes.join(' ');
  if (!hostElement.selfClosing) {
    return { position: hostElement.openingEnd - 1, replacement: ` ${attributeSource}` };
  }

  const position = hostElement.openingEnd - 2;
  return {
    position,
    replacement: hostElement.selfClosingSlashHasLeadingWhitespace
      ? `${attributeSource} `
      : ` ${attributeSource} `,
  };
}

function templateLiteral(value: string): string {
  return `\`${value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')}\``;
}

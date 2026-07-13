import type {
  Component,
  ComponentErrorBoundary,
  ComponentDefinitionInput,
  ComponentRenderResult,
  ComponentRenderSlots,
  JsonValue,
} from '@kovojs/core';
import {
  componentMutationFailureSlots,
  renderComponent,
  type ComponentRenderOptions,
} from './component-render.js';
import { createAppDeclarationSnapshotContext, snapshotAppQuery } from './app-snapshot.js';
import { stampKovoComponentRoot } from './component-root-stamps.js';
import { queryWithGeneratedReads } from './generated-query-registry.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import { renderServerRenderable } from './renderable.js';
import { recordQueryRuntimeWarnings, runQuery, type QueryDefinition } from './query.js';
import type { LiveTargetRenderContext, LiveTargetRenderer } from './mutation-wire.js';
import type { ErrorBoundaryRenderer } from './mutation-wire.js';
import { revealUntrustedRequestValue } from './untrusted-request-body.js';
import {
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessGetOwnPropertyDescriptor,
  witnessFreeze,
  witnessIsArray,
  witnessObjectKeys,
} from './security-witness-intrinsics.js';

/** @internal Generated component query binding used by live-target renderers (SPEC §9.1). */
export interface ComponentLiveTargetQueryBinding<Request = unknown> {
  args?: (props: Record<string, unknown>) => unknown;
  name: string;
  query: QueryDefinition<string, unknown, unknown, Request>;
}

/** @internal Options for compiler-emitted component live-target renderers (SPEC §9.1). */
export interface ComponentLiveTargetRendererOptions<
  Definition extends ComponentDefinitionInput = ComponentDefinitionInput,
  Request = unknown,
  State extends JsonValue = JsonValue,
> {
  component: Component<Definition>;
  componentId: string;
  queries?: readonly ComponentLiveTargetQueryBinding<Request>[];
  renderOptions?: (
    context: LiveTargetRenderContext<Request>,
  ) => ComponentRenderOptions<State> | Promise<ComponentRenderOptions<State>>;
  slots?: (
    context: LiveTargetRenderContext<Request>,
  ) => ComponentRenderSlots | Promise<ComponentRenderSlots>;
  errorBoundary?: ComponentErrorBoundary;
}

/**
 * @internal Build the generated live-target renderer for one query-backed component.
 *
 * Compiler-emitted modules use this helper so app authors do not write data-loading or
 * fragment-routing code. It reloads every declared query from serializable component props
 * and renders the component through the same `renderComponent()` path as full-page rendering
 * (SPEC §9.1).
 */
export function componentLiveTargetRenderer<
  const Definition extends ComponentDefinitionInput,
  Request = unknown,
  State extends JsonValue = JsonValue,
>(
  options: ComponentLiveTargetRendererOptions<Definition, Request, State>,
): LiveTargetRenderer<Request> {
  const component = requiredOwnRendererValue<Component<Definition>>(
    options,
    'component',
    'Live-target renderer options',
  );
  const componentId = requiredOwnRendererValue<string>(
    options,
    'componentId',
    'Live-target renderer options',
  );
  if (typeof component !== 'function' || typeof componentId !== 'string') {
    throw new TypeError(
      'Live-target renderer options require stable component and componentId data.',
    );
  }
  const explicitQueries = optionalOwnRendererValue(
    options,
    'queries',
    'Live-target renderer options',
  );
  const renderOptions = optionalOwnRendererValue(
    options,
    'renderOptions',
    'Live-target renderer options',
  );
  const slots = optionalOwnRendererValue(options, 'slots', 'Live-target renderer options');
  if (renderOptions !== undefined && typeof renderOptions !== 'function') {
    throw new TypeError('Live-target renderer renderOptions must be a stable function.');
  }
  if (slots !== undefined && typeof slots !== 'function') {
    throw new TypeError('Live-target renderer slots must be a stable function.');
  }
  const explicitErrorBoundary = optionalOwnRendererValue(
    options,
    'errorBoundary',
    'Live-target renderer options',
  );
  const queryBindings = normalizeLiveTargetQueryBindings(
    (explicitQueries ??
      componentLiveTargetQueryBindings<Request>(
        component,
      )) as readonly ComponentLiveTargetQueryBinding<Request>[],
  );
  const mutationBindings = componentLiveTargetMutationBindings(component);
  const queryKeys: string[] = [];
  const queryDefinitions: QueryDefinition<string, unknown, unknown, Request>[] = [];
  for (let index = 0; index < queryBindings.length; index += 1) {
    const binding = queryBindings[index]!;
    witnessArrayAppend(queryKeys, binding.query.key, 'Live-target query key');
    witnessArrayAppend(queryDefinitions, binding.query, 'Live-target query definition');
  }

  const renderer: LiveTargetRenderer<Request> & {
    queryBindings: readonly ComponentLiveTargetQueryBinding<Request>[];
  } = {
    component: componentId,
    ...componentLiveTargetErrorBoundary(
      explicitErrorBoundary ?? componentDefinitionValue(component, 'errorBoundary'),
    ),
    queries: witnessFreeze(queryKeys),
    queryBindings,
    queryDefinitions: witnessFreeze(queryDefinitions),
    async render(context) {
      const queries = await loadLiveTargetQueries(queryBindings, context);
      const resolvedRenderOptions = await componentLiveTargetRenderOptions(
        mutationBindings,
        renderOptions as ComponentLiveTargetRendererOptions<
          Definition,
          Request,
          State
        >['renderOptions'],
        slots as ComponentLiveTargetRendererOptions<Definition, Request, State>['slots'],
        context,
      );
      const csrf = context.csrf === false ? undefined : context.csrf;
      const html = await runWithJsxRequestContext(
        context.request,
        {
          attestationAuthority: context.attestationAuthority,
          ...(csrf === undefined ? {} : { csrf }),
          ...(context.failure === undefined || context.mutationKey === undefined
            ? {}
            : {
                mutationFailure: {
                  failure: context.failure,
                  input: context.input,
                  mutationKey: context.mutationKey,
                  target: context.target,
                },
              }),
        },
        () => renderComponent(component, { ...context.props, ...queries }, resolvedRenderOptions),
      );
      return stampKovoComponentRoot({
        attestationAuthority: context.attestationAuthority,
        component,
        componentName: componentId,
        html,
        props: context.props,
        request: context.request,
        target: context.target,
      });
    },
  };

  return witnessFreeze(renderer);
}

function normalizeLiveTargetQueryBindings<Request>(
  bindings: readonly ComponentLiveTargetQueryBinding<Request>[],
): readonly ComponentLiveTargetQueryBinding<Request>[] {
  if (!witnessIsArray(bindings)) {
    throw new TypeError('Live-target query bindings must be a dense array.');
  }
  const querySnapshotContext = createAppDeclarationSnapshotContext();
  const normalized: ComponentLiveTargetQueryBinding<Request>[] = [];
  for (let index = 0; index < bindings.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(bindings, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Live-target query bindings must be dense own data properties.');
    }
    const binding = descriptor.value as object;
    if (!isRecord(binding)) {
      throw new TypeError('Live-target query bindings must be stable objects.');
    }
    const name = requiredOwnRendererValue<string>(binding, 'name', 'Live-target query binding');
    const query = requiredOwnRendererValue<QueryDefinition<string, unknown, unknown, Request>>(
      binding,
      'query',
      'Live-target query binding',
    );
    const args = optionalOwnRendererValue(binding, 'args', 'Live-target query binding');
    if (typeof name !== 'string' || (args !== undefined && typeof args !== 'function')) {
      throw new TypeError('Live-target query bindings require stable name, query, and args data.');
    }
    const normalizedQuery = queryWithGeneratedReads(query);
    const snapshottedQuery = snapshotAppQuery(
      normalizedQuery,
      querySnapshotContext,
    ) as QueryDefinition<string, unknown, unknown, Request>;
    witnessArrayAppend(
      normalized,
      witnessFreeze({
        ...(args === undefined
          ? {}
          : { args: args as ComponentLiveTargetQueryBinding<Request>['args'] }),
        name,
        query: snapshottedQuery,
      }),
      'Live-target query binding snapshot',
    );
  }
  return witnessFreeze(normalized);
}

function componentLiveTargetErrorBoundary(source: unknown): {
  errorBoundary?: ErrorBoundaryRenderer;
} {
  if (source === undefined) return {};
  if (!isRecord(source)) {
    throw new TypeError('Live-target renderer errorBoundary must be a stable object.');
  }
  const fallback = requiredOwnRendererValue<ComponentErrorBoundary['fallback']>(
    source,
    'fallback',
    'Live-target renderer errorBoundary',
  );
  const target = optionalOwnRendererValue(source, 'target', 'Live-target renderer errorBoundary');
  if (target !== undefined && typeof target !== 'string') {
    throw new TypeError('Live-target renderer errorBoundary.target must be a stable string.');
  }

  return {
    errorBoundary: witnessFreeze({
      ...(target === undefined ? {} : { target }),
      render(error) {
        const renderedFallback = typeof fallback === 'function' ? fallback(error) : fallback;
        return renderBoundaryFallback(renderedFallback as ComponentRenderResult);
      },
    }),
  };
}

function renderBoundaryFallback(fallback: ComponentRenderResult): string {
  const rendered = renderServerRenderable(fallback as Parameters<typeof renderServerRenderable>[0]);
  return typeof rendered === 'string' ? rendered : '';
}

function componentLiveTargetQueryBindings<Request>(
  component: Component<any>,
): ComponentLiveTargetQueryBinding<Request>[] {
  if (!isRecord(component.definition.queries)) return [];
  const bindings: ComponentLiveTargetQueryBinding<Request>[] = [];
  const names = witnessObjectKeys(component.definition.queries);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(component.definition.queries, name);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`Component live-target query ${name} must be an own data property.`);
    }
    const binding = descriptor.value;
    const queryBinding = componentQueryBinding<Request>(name, binding);
    if (queryBinding !== undefined) {
      witnessArrayAppend(bindings, queryBinding, 'Component live-target query binding');
    }
  }
  return bindings;
}

function componentQueryBinding<Request>(
  name: string,
  binding: unknown,
): ComponentLiveTargetQueryBinding<Request> | undefined {
  if (isQueryArgsBinding<Request>(binding)) {
    return { args: binding.args, name, query: queryWithGeneratedReads(binding.query) };
  }
  if (isQueryDefinition<Request>(binding)) {
    return { name, query: queryWithGeneratedReads(binding) };
  }
  return undefined;
}

function isQueryArgsBinding<Request>(value: unknown): value is {
  args: (props: Record<string, unknown>) => unknown;
  query: QueryDefinition<string, unknown, unknown, Request>;
} {
  return isRecord(value) && typeof value.args === 'function' && isQueryDefinition(value.query);
}

function isQueryDefinition<Request>(
  value: unknown,
): value is QueryDefinition<string, unknown, unknown, Request> {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    (value.reads === undefined || witnessIsArray(value.reads))
  );
}

async function loadLiveTargetQueries<Request>(
  bindings: readonly ComponentLiveTargetQueryBinding<Request>[],
  context: LiveTargetRenderContext<Request>,
): Promise<Record<string, unknown>> {
  const values = witnessCreateNullRecord<unknown>() as Record<string, unknown>;

  for (let index = 0; index < bindings.length; index += 1) {
    const binding = bindings[index]!;
    const props = revealLiveTargetValue(context.props) as Record<string, unknown>;
    const input = revealLiveTargetValue(binding.args ? binding.args(props) : undefined);
    const result = await runQuery(binding.query, input, context.request, {
      ...(context.maxListItems === undefined ? {} : { maxListItems: context.maxListItems }),
      trustedInput: true,
    });
    if (!result.ok) {
      throw new Error(`Live target query failed: ${binding.query.key}`);
    }
    recordQueryRuntimeWarnings(context.request, result.warnings);
    values[binding.name] = result.value;
  }

  return values;
}

function revealLiveTargetValue(value: unknown): unknown {
  return revealUntrustedRequestValue(value, 'verified live-target descriptor input');
}

async function componentLiveTargetRenderOptions<
  const Definition extends ComponentDefinitionInput,
  Request,
  State extends JsonValue,
>(
  mutationBindings: readonly ComponentLiveTargetMutationBinding[],
  renderOptions: ComponentLiveTargetRendererOptions<Definition, Request, State>['renderOptions'],
  slots: ComponentLiveTargetRendererOptions<Definition, Request, State>['slots'],
  context: LiveTargetRenderContext<Request>,
): Promise<ComponentRenderOptions<State>> {
  const resolvedRenderOptions = (await renderOptions?.(context)) ?? {};
  const resolvedSlots = await slots?.(context);

  return {
    ...resolvedRenderOptions,
    slots: {
      ...componentLiveTargetDefaultSlots(mutationBindings, context),
      ...resolvedRenderOptions.slots,
      ...resolvedSlots,
    },
  };
}

function componentLiveTargetDefaultSlots<Request>(
  mutationBindings: readonly ComponentLiveTargetMutationBinding[],
  context: LiveTargetRenderContext<Request>,
): ComponentRenderSlots {
  const forms =
    mutationBindings.length === 0 ? undefined : componentMutationDefaultForms(mutationBindings);

  let slots: ComponentRenderSlots = {
    ...(forms === undefined ? {} : { forms }),
    ...(context.request === undefined ? {} : { request: context.request }),
  };

  if (!context.failure || !context.mutationKey) {
    return slots;
  }

  for (let index = 0; index < mutationBindings.length; index += 1) {
    const binding = mutationBindings[index]!;
    if (binding.key === context.mutationKey) {
      slots = componentMutationFailureSlots(binding.name, context.failure, slots, {
        submitted: context.input,
      });
    }
  }

  return slots;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !witnessIsArray(value);
}

function componentMutationDefaultForms(
  mutationBindings: readonly ComponentLiveTargetMutationBinding[],
): Record<string, { failure: null }> {
  const forms = witnessCreateNullRecord<{ failure: null }>() as Record<string, { failure: null }>;
  for (let index = 0; index < mutationBindings.length; index += 1) {
    forms[mutationBindings[index]!.name] = { failure: null };
  }
  return forms;
}

interface ComponentLiveTargetMutationBinding {
  key: string;
  name: string;
}

function componentLiveTargetMutationBindings(
  component: Component<any>,
): readonly ComponentLiveTargetMutationBinding[] {
  const mutations = componentDefinitionValue(component, 'mutations');
  if (!isRecord(mutations)) return witnessFreeze([]);

  const bindings: ComponentLiveTargetMutationBinding[] = [];
  const names = witnessObjectKeys(mutations);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(mutations, name);
    if (descriptor === undefined || !('value' in descriptor) || !isRecord(descriptor.value)) {
      continue;
    }
    const key = optionalOwnRendererValue(
      descriptor.value,
      'key',
      `Component live-target mutation ${name}`,
    );
    if (typeof key !== 'string') continue;
    witnessArrayAppend(
      bindings,
      witnessFreeze({ key, name }),
      'Component live-target mutation binding snapshot',
    );
  }
  return witnessFreeze(bindings);
}

function componentDefinitionValue(component: Component<any>, property: PropertyKey): unknown {
  const definition = requiredOwnRendererValue<object>(
    component,
    'definition',
    'Live-target component',
  );
  if (!isRecord(definition)) {
    throw new TypeError('Live-target component definition must be a stable object.');
  }
  return optionalOwnRendererValue(definition, property, 'Live-target component definition');
}

function requiredOwnRendererValue<Value>(
  source: object,
  property: PropertyKey,
  label: string,
): Value {
  const descriptor = witnessGetOwnPropertyDescriptor(source, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
  }
  return descriptor.value as Value;
}

function optionalOwnRendererValue(source: object, property: PropertyKey, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(source, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
  }
  return descriptor.value;
}

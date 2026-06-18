import type {
  Component,
  ComponentErrorBoundary,
  ComponentDefinitionInput,
  ComponentRenderSlots,
  JsonValue,
} from '@kovojs/core';
import {
  componentMutationFailureSlots,
  renderComponent,
  type ComponentRenderOptions,
} from './component-render.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import { runQuery, type QueryDefinition } from './query.js';
import type { LiveTargetRenderContext, LiveTargetRenderer } from './mutation-wire.js';
import type { ErrorBoundaryRenderer } from './mutation-wire.js';

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
  const queryBindings =
    options.queries ?? componentLiveTargetQueryBindings<Request>(options.component);

  return {
    component: options.componentId,
    ...componentLiveTargetErrorBoundary(options),
    queries: queryBindings.map((binding) => binding.query.key),
    queryDefinitions: queryBindings.map((binding) => binding.query),
    async render(context) {
      const queries = await loadLiveTargetQueries(queryBindings, context);
      const renderOptions = await componentLiveTargetRenderOptions(options, context);
      return runWithJsxRequestContext(
        context.request,
        {
          ...(context.csrf === undefined ? {} : { csrf: context.csrf }),
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
        () => renderComponent(options.component, { ...context.props, ...queries }, renderOptions),
      );
    },
  };
}

function componentLiveTargetErrorBoundary<
  const Definition extends ComponentDefinitionInput,
  Request,
  State extends JsonValue,
>(
  options: ComponentLiveTargetRendererOptions<Definition, Request, State>,
): { errorBoundary?: ErrorBoundaryRenderer } {
  const boundary = options.errorBoundary ?? options.component.definition.errorBoundary;
  if (!boundary) return {};

  return {
    errorBoundary: {
      ...(boundary.target === undefined ? {} : { target: boundary.target }),
      render(error) {
        const fallback =
          typeof boundary.fallback === 'function' ? boundary.fallback(error) : boundary.fallback;
        return String(fallback ?? '');
      },
    },
  };
}

function componentLiveTargetQueryBindings<Request>(
  component: Component<ComponentDefinitionInput>,
): ComponentLiveTargetQueryBinding<Request>[] {
  if (!isRecord(component.definition.queries)) return [];

  return Object.entries(component.definition.queries).flatMap(([name, binding]) => {
    const queryBinding = componentQueryBinding<Request>(name, binding);
    return queryBinding === undefined ? [] : [queryBinding];
  });
}

function componentQueryBinding<Request>(
  name: string,
  binding: unknown,
): ComponentLiveTargetQueryBinding<Request> | undefined {
  if (isQueryArgsBinding<Request>(binding)) {
    return { args: binding.args, name, query: binding.query };
  }
  if (isQueryDefinition<Request>(binding)) {
    return { name, query: binding };
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
  return isRecord(value) && typeof value.key === 'string' && Array.isArray(value.reads);
}

async function loadLiveTargetQueries<Request>(
  bindings: readonly ComponentLiveTargetQueryBinding<Request>[],
  context: LiveTargetRenderContext<Request>,
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {};

  for (const binding of bindings) {
    const input = binding.args ? binding.args(context.props) : undefined;
    const result = await runQuery(binding.query, input, context.request);
    if (!result.ok) {
      throw new Error(`Live target query failed: ${binding.query.key}`);
    }
    values[binding.name] = result.value;
  }

  return values;
}

async function componentLiveTargetRenderOptions<
  const Definition extends ComponentDefinitionInput,
  Request,
  State extends JsonValue,
>(
  options: ComponentLiveTargetRendererOptions<Definition, Request, State>,
  context: LiveTargetRenderContext<Request>,
): Promise<ComponentRenderOptions<State>> {
  const renderOptions = (await options.renderOptions?.(context)) ?? {};
  const slots = await options.slots?.(context);

  return {
    ...renderOptions,
    slots: {
      ...componentLiveTargetDefaultSlots(options.component, context),
      ...renderOptions.slots,
      ...slots,
    },
  };
}

function componentLiveTargetDefaultSlots<Request>(
  component: Component<ComponentDefinitionInput>,
  context: LiveTargetRenderContext<Request>,
): ComponentRenderSlots {
  const forms = isRecord(component.definition.mutations)
    ? Object.fromEntries(
        Object.keys(component.definition.mutations).map((key) => [key, { failure: null }]),
      )
    : undefined;

  let slots: ComponentRenderSlots = {
    ...(forms === undefined ? {} : { forms }),
    ...(context.request === undefined ? {} : { request: context.request }),
  };

  if (!context.failure || !context.mutationKey || !isRecord(component.definition.mutations)) {
    return slots;
  }

  for (const [name, mutation] of Object.entries(component.definition.mutations)) {
    if (isMutationDefinitionLike(mutation) && mutation.key === context.mutationKey) {
      slots = componentMutationFailureSlots(name, context.failure, slots);
    }
  }

  return slots;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMutationDefinitionLike(value: unknown): value is { key: string } {
  return isRecord(value) && typeof value.key === 'string';
}

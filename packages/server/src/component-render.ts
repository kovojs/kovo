import type {
  Component,
  ComponentDefinitionInput,
  ComponentRenderSlots,
  JsonValue,
} from '@kovojs/core';
import { renderHtmlValue } from './html.js';
import type { MutationFail } from './mutation.js';
import type { ValidationFailurePayload } from './schema.js';

/**
 * Runtime inputs for rendering a component outside the full document pipeline.
 *
 * This mirrors the SPEC §4.5 composition call shape: callers may provide
 * compiler-hoisted slots and a serializable component state value, while query
 * data stays the explicit second argument to `renderComponent(...)`.
 *
 * @internal
 */
export interface ComponentRenderOptions<State extends JsonValue = JsonValue> {
  /** Named slot renderers hoisted from fragment-target children. */
  slots?: ComponentRenderSlots;
  /** Serializable component state for stateful server component renders. */
  state?: State;
}

/**
 * Options for rendering a component with one SPEC §6.3 mutation form failure
 * injected into its `forms.<name>.failure` slot.
 *
 * @internal
 */
export interface ComponentMutationFailureRenderOptions<
  State extends JsonValue = JsonValue,
> extends ComponentRenderOptions<State> {
  /** Component-local key from `mutations: { ... }`, e.g. `addToCart`. */
  formName: string;
}

/**
 * Render a component descriptor with the SPEC §4.5 composition argument.
 *
 * Fragment-target children are compiler-hoisted into named slot functions; mutation fragment
 * renderers call back through the same component render function with fresh query values and the
 * stamped, serializable slot output.
 *
 * @internal
 */
export function renderComponent<
  const Definition extends ComponentDefinitionInput,
  Queries,
  State extends JsonValue = JsonValue,
>(
  component: Component<Definition>,
  queries: Queries,
  options: ComponentRenderOptions<State> = {},
): string {
  const state = options.state ?? (component.definition.state?.() as State | undefined);
  const slots = options.slots ?? {};
  const render = component.definition.render as (
    queries: Queries,
    state: State | undefined,
    slots: ComponentRenderSlots,
  ) => unknown;

  return renderHtmlValue(render(queries, state, slots));
}

/**
 * Render a component failure target with SPEC §6.3/§9.2 mutation form state injected.
 *
 * Enhanced mutation failures rerender the submitted form target through the same component
 * render function; this helper prepares the `forms.<mutation>.failure` slot value that
 * app-authored TSX reads during that render.
 *
 * @internal
 */
export function renderComponentMutationFailure<
  const Definition extends ComponentDefinitionInput,
  Queries,
  State extends JsonValue = JsonValue,
>(
  component: Component<Definition>,
  queries: Queries,
  failure: MutationFail,
  options: ComponentMutationFailureRenderOptions<State>,
): string {
  const { formName, slots, ...renderOptions } = options;

  return renderComponent(component, queries, {
    ...renderOptions,
    slots: componentMutationFailureSlots(formName, failure, slots),
  });
}

/**
 * Build component render slots with one typed mutation-form failure state.
 *
 * This lower-level helper is useful when a component render helper needs to
 * merge a mutation failure with existing slots before calling
 * `renderComponent(...)` or `definition.render(...)` directly.
 *
 * @internal
 */
export function componentMutationFailureSlots(
  formName: string,
  failure: MutationFail,
  slots: ComponentRenderSlots = {},
): ComponentRenderSlots {
  const forms = isRecord(slots.forms) ? slots.forms : {};

  return {
    ...slots,
    forms: {
      ...forms,
      [formName]: {
        failure: componentMutationFailureValue(failure),
      },
    },
  };
}

function componentMutationFailureValue(failure: MutationFail): unknown {
  if (failure.error.code === 'VALIDATION' && isValidationFailurePayload(failure.error.payload)) {
    return {
      code: 'VALIDATION',
      fieldErrors: Object.fromEntries(
        failure.error.payload.issues.map((issue) => [issue.path.join('.'), issue.message]),
      ),
    };
  }

  return {
    code: failure.error.code,
    payload: failure.error.payload,
  };
}

function isValidationFailurePayload(value: unknown): value is ValidationFailurePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'issues' in value &&
    Array.isArray(value.issues) &&
    value.issues.every(
      (issue) =>
        typeof issue === 'object' &&
        issue !== null &&
        'message' in issue &&
        typeof issue.message === 'string' &&
        'path' in issue &&
        Array.isArray(issue.path) &&
        issue.path.every((part: unknown) => typeof part === 'string'),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

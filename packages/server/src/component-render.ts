import type {
  Component,
  ComponentDefinitionInput,
  ComponentRenderSlots,
  JsonValue,
} from '@kovojs/core';
import { isRenderedHtml, renderHtmlValue, unwrapCoercedRenderedHtml } from './html.js';
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
  /** Raw submitted form input used to expose `forms.<mutation>.submitted` on failure rerenders. */
  submitted?: unknown;
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

  return renderComponentValue(render(queries, state, slots));
}

function renderComponentValue(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (isRenderedHtml(value)) return value.html;
  if (typeof value === 'string') return unwrapCoercedRenderedHtml(value);

  return renderHtmlValue(value);
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
  const { formName, slots, submitted, ...renderOptions } = options;

  return renderComponent(component, queries, {
    ...renderOptions,
    slots: componentMutationFailureSlots(formName, failure, slots, { submitted }),
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
  options: { submitted?: unknown } = {},
): ComponentRenderSlots {
  const forms = isRecord(slots.forms) ? slots.forms : {};
  const submitted = componentMutationSubmittedValues(options.submitted);

  return {
    ...slots,
    forms: {
      ...forms,
      [formName]: {
        failure: componentMutationFailureValue(failure),
        ...(submitted === undefined ? {} : { submitted }),
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

function componentMutationSubmittedValues(
  rawInput: unknown,
): Record<string, JsonValue> | undefined {
  if (rawInput instanceof FormData) {
    return submittedEntriesToRecord(Array.from(rawInput.entries()));
  }
  if (!isRecord(rawInput)) return undefined;
  return submittedEntriesToRecord(Object.entries(rawInput));
}

function submittedEntriesToRecord(
  entries: readonly (readonly [string, unknown])[],
): Record<string, JsonValue> | undefined {
  const submitted: Record<string, JsonValue> = {};
  for (const [name, value] of entries) {
    if (isFrameworkFormField(name)) continue;
    const jsonValue = submittedJsonValue(value);
    if (jsonValue === undefined) continue;
    const existing = submitted[name];
    submitted[name] =
      existing === undefined
        ? jsonValue
        : Array.isArray(existing)
          ? [...existing, jsonValue]
          : [existing, jsonValue];
  }
  return Object.keys(submitted).length === 0 ? undefined : submitted;
}

function submittedJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const values = value.map(submittedJsonValue);
    return values.every((item): item is JsonValue => item !== undefined) ? values : undefined;
  }
  if (!isRecord(value)) return undefined;
  if (isFileLike(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, entryValue]) => [key, submittedJsonValue(entryValue)] as const)
    .filter((entry): entry is readonly [string, JsonValue] => entry[1] !== undefined);
  return Object.fromEntries(entries);
}

function isFrameworkFormField(name: string): boolean {
  return name === 'Kovo-Idem' || name === 'kovo-csrf' || name === 'kovo-form-key';
}

function isFileLike(value: Record<string, unknown>): boolean {
  return (
    typeof value.arrayBuffer === 'function' &&
    typeof value.name === 'string' &&
    typeof value.size === 'number'
  );
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

import type {
  AppMutationResponseOptions,
  AppMutationResponsePolicy,
  AppMutationResponses,
} from './app-types.js';
import type { StylesheetAsset } from './hints.js';
import type { ErrorBoundaryRenderer, FragmentRenderer } from './mutation-wire.js';

const responseOptionFields = new Set<PropertyKey>([
  'failureStylesheets',
  'failureTarget',
  'fragmentRenderers',
  'redirectTo',
  'renderFailureFragment',
  'renderFailurePage',
]);

/** Snapshot app mutation response configuration before the request lifecycle opens (SPEC §9.5). */
export function snapshotAppMutationResponses(value: unknown): AppMutationResponses {
  const source = ownDataRecord(value, 'createApp mutationResponses');
  const snapshot: Record<string, AppMutationResponsePolicy> = Object.create(null) as Record<
    string,
    AppMutationResponsePolicy
  >;
  for (const key of Object.keys(source)) {
    const policy = ownDataValue(source, key, `createApp mutationResponses.${key}`);
    if (typeof policy === 'function') {
      snapshot[key] = policy as AppMutationResponsePolicy;
      continue;
    }
    snapshot[key] = normalizeAppMutationResponseOptions(
      policy,
      `createApp mutationResponses.${key}`,
    );
  }
  return Object.freeze(snapshot);
}

/** Validate and close a static or post-lifecycle response decoration. */
export function normalizeAppMutationResponseOptions(
  value: unknown,
  label = 'mutation response policy',
): AppMutationResponseOptions {
  const source = ownDataRecord(value, label);
  for (const key of Reflect.ownKeys(source)) {
    if (key === 'csrf') {
      throw new TypeError(
        `${label}.csrf is forbidden: response decoration cannot replace pre-body CSRF posture (SPEC §6.6/§10.3).`,
      );
    }
    if (!responseOptionFields.has(key)) {
      throw new TypeError(`${label}.${String(key)} is not a supported response decoration option.`);
    }
  }

  const failureTarget = ownDataValue(source, 'failureTarget', `${label}.failureTarget`);
  const failureStylesheets = ownDataValue(
    source,
    'failureStylesheets',
    `${label}.failureStylesheets`,
  );
  const fragmentRenderers = ownDataValue(source, 'fragmentRenderers', `${label}.fragmentRenderers`);
  const redirectTo = ownDataValue(source, 'redirectTo', `${label}.redirectTo`);
  const renderFailureFragment = ownDataValue(
    source,
    'renderFailureFragment',
    `${label}.renderFailureFragment`,
  );
  const renderFailurePage = ownDataValue(source, 'renderFailurePage', `${label}.renderFailurePage`);

  if (failureTarget !== undefined && typeof failureTarget !== 'string') {
    throw new TypeError(`${label}.failureTarget must be a string.`);
  }
  if (renderFailureFragment !== undefined && typeof renderFailureFragment !== 'function') {
    throw new TypeError(`${label}.renderFailureFragment must be a function.`);
  }
  if (renderFailurePage !== undefined && typeof renderFailurePage !== 'function') {
    throw new TypeError(`${label}.renderFailurePage must be a function.`);
  }
  const normalizedRedirect =
    redirectTo === undefined ? undefined : normalizeRedirectDecoration(redirectTo, label);

  return Object.freeze({
    ...(failureTarget === undefined ? {} : { failureTarget }),
    ...(failureStylesheets === undefined
      ? {}
      : {
          failureStylesheets: snapshotStylesheets(
            failureStylesheets,
            `${label}.failureStylesheets`,
          ),
        }),
    ...(fragmentRenderers === undefined
      ? {}
      : {
          fragmentRenderers: snapshotFragmentRenderers(
            fragmentRenderers,
            `${label}.fragmentRenderers`,
          ),
        }),
    ...(normalizedRedirect === undefined ? {} : { redirectTo: normalizedRedirect }),
    ...(renderFailureFragment === undefined
      ? {}
      : {
          renderFailureFragment: renderFailureFragment as NonNullable<
            AppMutationResponseOptions['renderFailureFragment']
          >,
        }),
    ...(renderFailurePage === undefined
      ? {}
      : {
          renderFailurePage: renderFailurePage as NonNullable<
            AppMutationResponseOptions['renderFailurePage']
          >,
        }),
  });
}

function snapshotFragmentRenderers(value: unknown, label: string): readonly FragmentRenderer[] {
  return Object.freeze(
    denseArray(value, label).map((entry, index) =>
      snapshotFragmentRenderer(entry, `${label}[${index}]`),
    ),
  );
}

function snapshotFragmentRenderer(value: unknown, label: string): FragmentRenderer {
  const source = ownDataRecord(value, label);
  const target = ownDataValue(source, 'target', `${label}.target`);
  const render = ownDataValue(source, 'render', `${label}.render`);
  const mode = ownDataValue(source, 'mode', `${label}.mode`);
  const updateCoverage = ownDataValue(source, 'updateCoverage', `${label}.updateCoverage`);
  const errorBoundary = ownDataValue(source, 'errorBoundary', `${label}.errorBoundary`);
  const stylesheets = ownDataValue(source, 'stylesheets', `${label}.stylesheets`);
  if (typeof target !== 'string' || typeof render !== 'function') {
    throw new TypeError(`${label} requires stable string target and render function.`);
  }
  if (mode !== undefined && mode !== 'append' && mode !== 'prepend' && mode !== 'replace') {
    throw new TypeError(`${label}.mode must be append, prepend, or replace.`);
  }
  if (updateCoverage !== undefined && updateCoverage !== 'fragment' && updateCoverage !== 'plan') {
    throw new TypeError(`${label}.updateCoverage must be fragment or plan.`);
  }
  return Object.freeze({
    target,
    render: render as FragmentRenderer['render'],
    ...(mode === undefined ? {} : { mode }),
    ...(updateCoverage === undefined ? {} : { updateCoverage }),
    ...(errorBoundary === undefined
      ? {}
      : { errorBoundary: snapshotErrorBoundary(errorBoundary, `${label}.errorBoundary`) }),
    ...(stylesheets === undefined
      ? {}
      : { stylesheets: snapshotStylesheets(stylesheets, `${label}.stylesheets`) }),
  });
}

function snapshotErrorBoundary(value: unknown, label: string): ErrorBoundaryRenderer {
  const source = ownDataRecord(value, label);
  const render = ownDataValue(source, 'render', `${label}.render`);
  const target = ownDataValue(source, 'target', `${label}.target`);
  if (typeof render !== 'function' || (target !== undefined && typeof target !== 'string')) {
    throw new TypeError(`${label} requires a render function and optional string target.`);
  }
  return Object.freeze({
    render: render as ErrorBoundaryRenderer['render'],
    ...(target === undefined ? {} : { target }),
  });
}

function snapshotStylesheets(value: unknown, label: string): readonly (string | StylesheetAsset)[] {
  return Object.freeze(
    denseArray(value, label).map((entry, index) =>
      typeof entry === 'string' ? entry : snapshotStylesheet(entry, `${label}[${index}]`),
    ),
  );
}

function snapshotStylesheet(value: unknown, label: string): StylesheetAsset {
  const source = ownDataRecord(value, label);
  const href = ownDataValue(source, 'href', `${label}.href`);
  const criticalCss = ownDataValue(source, 'criticalCss', `${label}.criticalCss`);
  const cspHash = ownDataValue(source, 'cspHash', `${label}.cspHash`);
  const deferFull = ownDataValue(source, 'deferFull', `${label}.deferFull`);
  const preload = ownDataValue(source, 'preload', `${label}.preload`);
  if (typeof href !== 'string') throw new TypeError(`${label}.href must be a string.`);
  for (const [field, entry] of [
    ['criticalCss', criticalCss],
    ['cspHash', cspHash],
  ] as const) {
    if (entry !== undefined && typeof entry !== 'string') {
      throw new TypeError(`${label}.${field} must be a string.`);
    }
  }
  for (const [field, entry] of [
    ['deferFull', deferFull],
    ['preload', preload],
  ] as const) {
    if (entry !== undefined && typeof entry !== 'boolean') {
      throw new TypeError(`${label}.${field} must be boolean.`);
    }
  }
  return Object.freeze({
    href,
    ...(criticalCss === undefined ? {} : { criticalCss: criticalCss as string }),
    ...(cspHash === undefined ? {} : { cspHash: cspHash as string }),
    ...(deferFull === undefined ? {} : { deferFull: deferFull as boolean }),
    ...(preload === undefined ? {} : { preload: preload as boolean }),
  });
}

function normalizeRedirectDecoration(
  value: unknown,
  label: string,
): NonNullable<AppMutationResponseOptions['redirectTo']> {
  if (typeof value === 'string') return value;
  if (typeof value === 'function') {
    return value as NonNullable<AppMutationResponseOptions['redirectTo']>;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label}.redirectTo must be a string, redirect value, or function.`);
  }
  const source = value as Record<PropertyKey, unknown>;
  const location = ownDataValue(source, 'location', `${label}.redirectTo.location`);
  const status = ownDataValue(source, 'status', `${label}.redirectTo.status`);
  if (typeof location !== 'string' || status !== 303) {
    throw new TypeError(`${label}.redirectTo must contain string location and status 303.`);
  }
  return Object.freeze({ location, status });
}

function denseArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a dense array.`);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    result.push(ownDataValue(value, index, `${label}[${index}]`));
  }
  return result;
}

function ownDataRecord(value: unknown, label: string): Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a stable own-data object.`);
  }
  return value as Record<PropertyKey, unknown>;
}

function ownDataValue(source: object, key: PropertyKey, label: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${label} must be a stable own data property.`);
  return descriptor.value;
}

import type { RuntimeErrorReporter } from './error-policy.js';
import { createMutationIdem, readMutationChangeHeader } from './mutation-response.js';
import { readLiveTargetSnapshot } from './mutation-targets.js';
import type { TargetCollectorRoot } from './mutation-targets.js';
import type { MutationChangeRecord } from './optimism.js';
import { definedProps } from './defined-props.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedFormLike {
  action: string;
  getAttribute?(name: string): string | null;
  id?: string | { toString(): string } | undefined;
  method?: string | undefined;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedMutationFetchOptions {
  body: unknown;
  headers: Record<string, string>;
  keepalive: boolean;
  method: string;
  onUploadProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface UploadProgress {
  loaded: number;
  total?: number;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface EnhancedMutationResponseLike {
  body?: ReadableStream<Uint8Array> | null;
  headers?: {
    get(name: string): string | null;
  };
  ok?: boolean;
  status?: number;
  text(): Promise<string>;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export type EnhancedMutationFetch = (
  url: string,
  options: EnhancedMutationFetchOptions,
) => Promise<EnhancedMutationResponseLike>;

export interface FetchEnhancedMutationOptions {
  fetch: EnhancedMutationFetch;
  form: EnhancedFormLike;
  formData: unknown;
  idem?: string;
  onError?: RuntimeErrorReporter;
  onUploadProgress?: (progress: UploadProgress) => void;
  root: TargetCollectorRoot;
  signal?: AbortSignal;
  streaming?: boolean;
}

export interface FetchedEnhancedMutation {
  body: string;
  /** The `Kovo-Build` response header value, if present (SPEC §9.1.1). */
  buildToken?: string | undefined;
  changes: MutationChangeRecord[];
  idem: string;
  response: EnhancedMutationResponseLike;
  streamBody?: ReadableStream<Uint8Array> | undefined;
  targets: string[];
}

export async function fetchEnhancedMutation(
  options: FetchEnhancedMutationOptions,
  idem = options.idem ?? readFormDataIdem(options.formData) ?? createMutationIdem(),
): Promise<FetchedEnhancedMutation> {
  const targetSnapshot = readLiveTargetSnapshot(options.root);
  const submittedFormTarget = readSubmittedFormTarget(options.form);
  const headers: Record<string, string> = {
    Accept: options.streaming
      ? 'text/vnd.kovo.fragment+html; stream=1'
      : 'text/vnd.kovo.fragment+html',
    'Kovo-Fragment': 'true',
    'Kovo-Idem': idem,
    'Kovo-Live-Targets': targetSnapshot.liveHeader,
    'Kovo-Targets': targetSnapshot.header,
  };
  if (submittedFormTarget !== undefined) {
    headers['Kovo-Form-Target'] = submittedFormTarget;
  }
  if (options.streaming) {
    headers['Kovo-Stream'] = 'true';
  }
  const response = await options.fetch(options.form.action, {
    body: options.formData,
    headers,
    keepalive: !options.streaming,
    method: (options.form.method ?? 'post').toUpperCase(),
    ...definedProps({ onUploadProgress: options.onUploadProgress, signal: options.signal }),
  });
  const reauth = response.headers?.get('Kovo-Reauth') ?? response.headers?.get('kovo-reauth');
  if (response.status === 401 && reauth) {
    followReauthDirective(reauth);
    return {
      body: '',
      changes: [],
      idem,
      response,
      targets: targetSnapshot.targets,
    };
  }
  const changes = readMutationChangeHeader(response, options.onError);
  // SPEC §9.1.1: read build token from response header for delta validation.
  const buildToken =
    response.headers?.get('Kovo-Build') ?? response.headers?.get('kovo-build') ?? undefined;

  return {
    body: options.streaming && response.body ? '' : await response.text(),
    buildToken,
    changes,
    idem,
    response,
    ...(options.streaming && response.body ? { streamBody: response.body } : {}),
    targets: targetSnapshot.targets,
  };
}

function followReauthDirective(location: string): void {
  // SPEC §6.5: the server's 401 Kovo-Reauth directive is the enhanced
  // mutation equivalent of the no-JS 303 login redirect.
  const globalLocation = (globalThis as { location?: Location }).location;
  globalLocation?.assign(location);
}

function readFormDataIdem(formData: unknown): string | undefined {
  if (
    formData === null ||
    typeof formData !== 'object' ||
    typeof (formData as { get?: unknown }).get !== 'function'
  ) {
    return undefined;
  }
  const value = (formData as { get(name: string): unknown }).get('Kovo-Idem');
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readSubmittedFormTarget(form: EnhancedFormLike): string | undefined {
  const target =
    form.getAttribute?.('kovo-fragment-target') ??
    form.getAttribute?.('id') ??
    (typeof form.id === 'string' ? form.id : undefined) ??
    form.getAttribute?.('kovo-c') ??
    undefined;

  return target === '' ? undefined : target;
}

export function isFailedMutationResponse(response: EnhancedMutationResponseLike): boolean {
  return response.ok === false || (response.status !== undefined && response.status >= 400);
}

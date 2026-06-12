import type { CsrfValidationOptions } from './csrf.js';
import type { RequestLifecycleOptions } from './guards.js';
import type { StylesheetAsset } from './hints.js';
import type { MutationFail, MutationSuccess } from './mutation.js';
import type { MutationReplayStore } from './replay.js';
import {
  readHeader,
  type HeaderSource,
  type MutationResponseHeaders,
  type ServerResponseBase,
} from './response.js';

export interface FragmentRenderer {
  errorBoundary?: ErrorBoundaryRenderer;
  mode?: 'append' | 'replace';
  render(input: unknown): string | Promise<string>;
  stylesheets?: readonly (string | StylesheetAsset)[];
  target: string;
}

export interface ErrorBoundaryRenderer {
  render(error: unknown, input: unknown): string | Promise<string>;
  target?: string;
}

export interface MutationWireRequest<
  Request,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  csrf?: CsrfValidationOptions<Request>;
  failureTarget?: string;
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragment?: boolean;
  fragmentRenderers?: readonly FragmentRenderer[];
  idem?: string;
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  replayStore?: MutationReplayStore<MutationWireResponse>;
  rawInput: unknown;
  request: Request;
  targets?: readonly string[];
}

export interface MutationWireHeaders {
  fragment: boolean;
  idem?: string;
  targets: readonly string[];
}

export type MutationWireHeaderSource = HeaderSource;

export interface MutationWireRequestOptions<
  Request,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  csrf?: CsrfValidationOptions<Request>;
  failureTarget?: string;
  failureStylesheets?: readonly (string | StylesheetAsset)[];
  fragmentRenderers?: readonly FragmentRenderer[];
  headers: MutationWireHeaderSource;
  rawInput: unknown;
  renderFailureFragment?: (failure: MutationFail, rawInput: unknown) => string | Promise<string>;
  replayStore?: MutationReplayStore<MutationWireResponse>;
  request: Request;
}

export interface MutationWireResponse extends ServerResponseBase<
  string,
  MutationResponseHeaders,
  200 | 422 | 429 | 500
> {}

export interface NoJsMutationRequest<
  Request,
  Value,
  SessionValue = unknown,
> extends RequestLifecycleOptions<Request, SessionValue> {
  csrf?: CsrfValidationOptions<Request>;
  rawInput: unknown;
  redirectTo: string | ((result: MutationSuccess<Value>) => string);
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
  request: Request;
}

export interface NoJsMutationResponse extends ServerResponseBase<
  string,
  MutationResponseHeaders,
  303 | 422 | 429 | 500
> {}

export interface MutationEndpointRequest<
  Request,
  Value,
  SessionValue = unknown,
> extends MutationWireRequestOptions<Request, SessionValue> {
  redirectTo: string | ((result: MutationSuccess<Value>) => string);
  renderFailurePage?: (failure: MutationFail) => string | Promise<string>;
}

export type MutationEndpointResponse = MutationWireResponse | NoJsMutationResponse;

export function readMutationWireHeaders(headers: MutationWireHeaderSource): MutationWireHeaders {
  const fragment = readHeader(headers, 'FW-Fragment')?.toLowerCase() === 'true';
  const idem = readHeader(headers, 'FW-Idem')?.trim();
  const targets = dedupe(
    (readHeader(headers, 'FW-Targets') ?? '')
      .split(/[;,]/)
      .map((target) => target.trim())
      .map((target) => target.split('=')[0]?.trim() ?? '')
      .filter(Boolean),
  );

  return {
    fragment,
    ...(idem ? { idem } : {}),
    targets,
  };
}

export function mutationWireRequestFromHeaders<Request>(
  options: MutationWireRequestOptions<Request>,
): MutationWireRequest<Request> {
  const headers = readMutationWireHeaders(options.headers);

  return {
    fragment: headers.fragment,
    rawInput: options.rawInput,
    request: options.request,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.sessionProvider === undefined ? {} : { sessionProvider: options.sessionProvider }),
    ...(options.failureTarget === undefined ? {} : { failureTarget: options.failureTarget }),
    ...(options.failureStylesheets === undefined
      ? {}
      : { failureStylesheets: options.failureStylesheets }),
    ...(options.fragmentRenderers === undefined
      ? {}
      : { fragmentRenderers: options.fragmentRenderers }),
    ...(options.csrf === undefined ? {} : { csrf: options.csrf }),
    ...(headers.idem === undefined ? {} : { idem: headers.idem }),
    ...(options.renderFailureFragment === undefined
      ? {}
      : { renderFailureFragment: options.renderFailureFragment }),
    ...(options.replayStore === undefined ? {} : { replayStore: options.replayStore }),
    targets: headers.targets,
  };
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

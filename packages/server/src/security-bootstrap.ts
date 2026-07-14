/**
 * Framework-owned server trust-root bootstrap (SPEC §6.6).
 *
 * Supported Kovo runners evaluate this module before loading authored app, Vite-plugin, or
 * generated server modules. Importing every runtime-neutral authority membrane here makes pristine
 * capture order a construction property of the runner instead of trying to authenticate mutable
 * JavaScript functions from their source text or a finite probe corpus. Supported runners also
 * preload their profile entry before the app graph: server/build entries capture build controls,
 * while the root server barrel captures tree-shakeable Node-only command controls. That split keeps
 * unused `node:child_process` out of Cloudflare Workers without permitting app-first evaluation.
 *
 * This is deliberately private. Code that executes in the process before a supported Kovo entry
 * can replace host controls before this module runs and is therefore privileged host compromise,
 * not an app-level input Kovo can distinguish inside the same realm.
 */

import {
  assertRequestSafeRuntimeRealmLocked,
  lockRequestSafeRuntimeRealm,
} from '@kovojs/core/internal/classifier-verdict';

import '@kovojs/core/internal/client-module-url';
import '@kovojs/core/internal/filesystem';
import '@kovojs/core/internal/render-plan-token';

import './auth-principal.js';
import { assertCapabilityIntrinsics } from './capability-intrinsics.js';
import './client-module-registry-intrinsics.js';
import { assertConfidentialAtRestIntrinsics } from './confidential-at-rest-intrinsics.js';
import { assertEgressIntrinsics } from './egress-intrinsics.js';
import { assertJsxFormHelperIntrinsics } from './jsx-form-helper-intrinsics.js';
import { assertLoggingIntrinsics } from './logging-intrinsics.js';
import './mutation-wire-intrinsics.js';
import { assertRequestBodyIntrinsics } from './request-body-intrinsics.js';
import { assertRequestStateIntrinsics } from './request-state-intrinsics.js';
import { assertResponseSecurityIntrinsics } from './response-security-intrinsics.js';
import { loadAndPinServerRuntimeEnvironment } from '@kovojs/server/internal/runtime-environment';
import { assertSecurityWitnessIntrinsics } from './security-witness-intrinsics.js';
import { assertTaskSecurityIntrinsics } from './task-security-intrinsics.js';

// Keep this sequence explicit: no caller-controlled iterator or callback participates in the
// trust-root transition. These checks are health assertions over controls already captured by the
// runner; they are not provenance tests and must never be used to bless a late bootstrap.
assertSecurityWitnessIntrinsics();
loadAndPinServerRuntimeEnvironment();
assertCapabilityIntrinsics();
assertConfidentialAtRestIntrinsics();
assertEgressIntrinsics();
assertJsxFormHelperIntrinsics();
assertLoggingIntrinsics();
assertRequestBodyIntrinsics();
assertRequestStateIntrinsics();
assertResponseSecurityIntrinsics();
assertTaskSecurityIntrinsics();

/**
 * @internal Lock classifier-reviewed globals at the last trusted server-runner boundary.
 *
 * This is explicit because the Vitest host must retain its timer controls while importing server
 * modules. Supported generated/dev/build runners call it before authored modules; tests that prove
 * the irreversible transition run in a child realm. Node builtins are not classifier-trusted
 * request intrinsics, so the shared lock is intentionally runtime-neutral.
 */
export function lockServerRequestSafeRuntimeRealm(): void {
  lockRequestSafeRuntimeRealm();
}

/** @internal Refuse programmatic request dispatch until a supported runner established order. */
export function assertServerRequestSafeRuntimeRealmLocked(
  operation = 'createRequestHandler()',
): void {
  try {
    assertRequestSafeRuntimeRealmLocked();
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === 'Kovo request-safe runtime realm is not locked.'
    ) {
      throw new TypeError(
        `${operation} refuses an unbootstrapped custom runner. Import @kovojs/server/runtime-bootstrap as the literal first entry-module import, before any authored app or package module (SPEC §6.6).`,
      );
    }
    throw error;
  }
}

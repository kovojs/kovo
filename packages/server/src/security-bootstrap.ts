/**
 * Framework-owned server trust-root bootstrap (SPEC §6.6).
 *
 * Supported Kovo runners evaluate this module before loading authored app, Vite-plugin, or
 * generated server modules. Importing every authority-bearing intrinsic membrane here makes the
 * pristine capture order a construction property of the runner instead of trying to authenticate
 * mutable JavaScript functions from their source text or a finite probe corpus.
 *
 * This is deliberately private. Code that executes in the process before a supported Kovo entry
 * can replace host controls before this module runs and is therefore privileged host compromise,
 * not an app-level input Kovo can distinguish inside the same realm.
 */

import '@kovojs/core/internal/client-module-url';
import '@kovojs/core/internal/filesystem';
import '@kovojs/core/internal/render-plan-token';

import { assertBuildSecurityIntrinsics } from './build-security-intrinsics.js';
import { assertCapabilityIntrinsics } from './capability-intrinsics.js';
import './client-module-registry-intrinsics.js';
import { assertCommandIntrinsics } from './command-intrinsics.js';
import { assertConfidentialAtRestIntrinsics } from './confidential-at-rest-intrinsics.js';
import { assertEgressIntrinsics } from './egress-intrinsics.js';
import { assertJsxFormHelperIntrinsics } from './jsx-form-helper-intrinsics.js';
import { assertLoggingIntrinsics } from './logging-intrinsics.js';
import './mutation-wire-intrinsics.js';
import { assertRequestBodyIntrinsics } from './request-body-intrinsics.js';
import { assertRequestStateIntrinsics } from './request-state-intrinsics.js';
import { assertResponseSecurityIntrinsics } from './response-security-intrinsics.js';
import { assertSecurityWitnessIntrinsics } from './security-witness-intrinsics.js';
import { assertTaskSecurityIntrinsics } from './task-security-intrinsics.js';

// Keep this sequence explicit: no caller-controlled iterator or callback participates in the
// trust-root transition. These checks are health assertions over controls already captured by the
// runner; they are not provenance tests and must never be used to bless a late bootstrap.
assertSecurityWitnessIntrinsics();
assertBuildSecurityIntrinsics();
assertCapabilityIntrinsics();
assertCommandIntrinsics();
assertConfidentialAtRestIntrinsics();
assertEgressIntrinsics();
assertJsxFormHelperIntrinsics();
assertLoggingIntrinsics();
assertRequestBodyIntrinsics();
assertRequestStateIntrinsics();
assertResponseSecurityIntrinsics();
assertTaskSecurityIntrinsics();

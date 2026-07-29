// Keep the shared bootstrap-order witness as this exported entry's first executable dependency.
import './internal/runtime-lock.js';

export type {
  BetterAuthAppBindings,
  BetterAuthAppBindingsOptions,
  BetterAuthAppCredentialResult,
  BetterAuthAppRequest,
  BetterAuthAppSignInMutation,
  BetterAuthAppSignOutMutation,
} from './app-bindings.js';
export type { BetterAuthRoleRequest, BetterAuthRoleSession, BetterAuthRoleUser } from './guards.js';
export { authed, role } from './guards.js';
export type { BetterAuthCsrfRequestLike, BetterAuthEnvironmentCsrfOptions } from './environment.js';
export { betterAuthCsrfFromEnvironment } from './environment.js';
export { mount } from './mount.js';
export type { BetterAuthMountAdapter } from './mount-adapter.js';
export type {
  BetterAuthPasswordResetMailDoor,
  BetterAuthPasswordResetMailMessage,
  BetterAuthPasswordResetMailSender,
  BetterAuthPasswordResetOptions,
} from './password-reset-mail.js';
export { betterAuthPasswordResetMailDoor } from './password-reset-mail.js';
export type {
  BetterAuthSafeField,
  BetterAuthSanitizedRecord,
  BetterAuthSanitizedSessionPayload,
  BetterAuthSanitizedValue,
  BetterAuthSessionMapper,
} from './session.js';

export type { BetterAuthRoleRequest, BetterAuthRoleSession, BetterAuthRoleUser } from './guards.js';
export { authed, role } from './guards.js';
export type { BetterAuthMountOptions } from './mount.js';
export { mount } from './mount.js';
export {
  betterAuthSignInEmailMutation,
  betterAuthSignOutMutation,
  betterAuthSignUpEmailMutation,
} from './mutations.js';
export type { BetterAuthSessionMapper, BetterAuthSessionPayload } from './session.js';
export { betterAuthSession } from './session.js';

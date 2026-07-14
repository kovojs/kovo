/**
 * Package-internal access to the bootstrap-pinned operator environment for reviewed first-party
 * integrations. App-authored imports from this subpath are forbidden by SPEC §5.2.
 *
 * @internal
 */
export {
  loadAndPinServerRuntimeEnvironment,
  pinServerRuntimeEnvironment,
  runtimeEnvironmentSnapshot,
  runtimeEnvironmentValue,
} from '../runtime-environment-authority.js';

import './security-bootstrap.js';

export {
  advancePrincipalEpoch,
  createMemoryPrincipalEpochStore,
  initializePrincipalEpoch,
  PrincipalEpochStaleError,
  PrincipalEpochUnavailableError,
  tombstonePrincipalEpoch,
} from './principal-epoch.js';
export type {
  PrincipalEpochAdvanceReason,
  PrincipalEpochLookupOptions,
  PrincipalEpochState,
  PrincipalEpochStore,
  PrincipalEpochTombstoneReason,
} from './principal-epoch.js';

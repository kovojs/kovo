import './security-bootstrap.js';

export { createDelegationAuthority, onBehalfOf } from './delegation.js';
export type {
  CreateDelegationAuthorityOptions,
  DelegationAuthority,
  DelegationRight,
  DelegationRightKind,
  OnBehalfOfOptions,
} from './delegation.js';

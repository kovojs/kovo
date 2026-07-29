import './security-bootstrap.js';

export {
  erasePrincipal,
  PrincipalErasureIncompleteError,
  verifyPrincipalErasureReceipt,
} from './principal-erasure.js';
export type {
  ErasePrincipalOptions,
  PrincipalErasureReceipt,
  PrincipalErasureStorageSet,
} from './principal-erasure.js';

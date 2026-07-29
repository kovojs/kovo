import './security-bootstrap.js';

export {
  createConfidentialAtRestCipher,
  decryptAtRest,
  encryptAtRest,
  rewrapAtRest,
} from './confidential-at-rest.js';
export type {
  ConfidentialAtRestCipher,
  ConfidentialAtRestCipherOptions,
  DecryptAtRestOptions,
  EncryptedAtRest,
  EncryptAtRestOptions,
} from './confidential-at-rest.js';

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify as verifySignature,
} from 'node:crypto';

/** Sign exact kovo.certificate/v1 bytes with caller-supplied PKCS8 Ed25519 key bytes. */
export function signKovoCertificate(certificateBytes, { privateKey } = {}) {
  if (privateKey === undefined) {
    throw new TypeError('Kovo certificate signing requires caller-supplied PKCS8 key bytes');
  }
  const bytes = Buffer.from(certificateBytes);
  const signingKey = createPrivateKey({
    format: 'der',
    key: Buffer.from(privateKey),
    type: 'pkcs8',
  });
  const publicKeySpki = createPublicKey(signingKey).export({ format: 'der', type: 'spki' });
  const envelope = {
    algorithm: 'ed25519',
    certificateSha512: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    publicKeySpki: Buffer.from(publicKeySpki).toString('base64url'),
    schema: 'kovo.certificate-signature/v1',
    signature: sign(null, bytes, signingKey).toString('base64url'),
  };
  if (!verifyKovoCertificateSignature(bytes, envelope)) {
    throw new Error('Kovo certificate signer produced an unverifiable signature');
  }
  return envelope;
}

/** Verify the exact detached envelope without importing the search-side analyzer or generator. */
export function verifyKovoCertificateSignature(certificateBytes, envelope) {
  try {
    if (!isPlainRecord(envelope)) return false;
    if (
      canonicalJson(Object.keys(envelope).sort(compareStrings)) !==
      canonicalJson(['algorithm', 'certificateSha512', 'publicKeySpki', 'schema', 'signature'])
    ) {
      return false;
    }
    if (
      envelope.schema !== 'kovo.certificate-signature/v1' ||
      envelope.algorithm !== 'ed25519' ||
      !validSha512(envelope.certificateSha512) ||
      typeof envelope.publicKeySpki !== 'string' ||
      typeof envelope.signature !== 'string'
    ) {
      return false;
    }
    const bytes = Buffer.from(certificateBytes);
    const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    if (actual !== envelope.certificateSha512) return false;
    const publicKey = Buffer.from(envelope.publicKeySpki, 'base64url');
    const signature = Buffer.from(envelope.signature, 'base64url');
    if (
      publicKey.toString('base64url') !== envelope.publicKeySpki ||
      signature.toString('base64url') !== envelope.signature
    ) {
      return false;
    }
    return verifySignature(null, bytes, { format: 'der', key: publicKey, type: 'spki' }, signature);
  } catch {
    return false;
  }
}

/** Check exact Ed25519 SPKI bytes through the existing script-side crypto acquisition door. */
export function isEd25519Spki(publicKeySpki) {
  try {
    return ed25519SpkiKey(publicKeySpki) !== undefined;
  } catch {
    return false;
  }
}

/** Verify exact Ed25519 bytes through the existing script-side crypto acquisition door. */
export function verifyEd25519Spki(payloadBytes, publicKeySpki, signatureBytes) {
  try {
    const signature = Buffer.from(signatureBytes);
    if (signature.length !== 64) return false;
    const publicKey = ed25519SpkiKey(publicKeySpki);
    if (publicKey === undefined) return false;
    return verifySignature(null, Buffer.from(payloadBytes), publicKey, signature);
  } catch {
    return false;
  }
}

function ed25519SpkiKey(publicKeySpki) {
  const publicKey = createPublicKey({
    format: 'der',
    key: Buffer.from(publicKeySpki),
    type: 'spki',
  });
  return publicKey.asymmetricKeyType === 'ed25519' ? publicKey : undefined;
}

function validSha512(value) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) return false;
  try {
    const encoded = value.slice('sha512-'.length);
    return (
      Buffer.from(encoded, 'base64').length === 64 &&
      Buffer.from(encoded, 'base64').toString('base64') === encoded
    );
  } catch {
    return false;
  }
}

function isPlainRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort(compareStrings)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

import certificate from '../../../security/kovo-certificate-v1.json' with { type: 'json' };
import policy from '../../../security/kovo-certificate-policy-v1.json' with { type: 'json' };

/** Byte-stable release certificate emitted beside every build graph (Plan 3 §2.1). */
export const kovoCertificateV1Json = `${JSON.stringify(certificate, null, 2)}\n`;

/** Byte-stable copy of the reviewer policy; callers must obtain/trust it independently. */
export const kovoCertificatePolicyV1Json = `${JSON.stringify(policy, null, 2)}\n`;

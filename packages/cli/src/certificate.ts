import certificate from '../../../security/kovo-certificate-v1.json' with { type: 'json' };

/** Byte-stable release certificate emitted beside every build graph (Plan 3 §2.1). */
export const kovoCertificateV1Json = `${JSON.stringify(certificate, null, 2)}\n`;

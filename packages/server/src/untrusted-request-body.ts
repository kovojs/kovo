export type UntrustedRequestBodyCarrier = 'json' | 'form';

export type UntrustedRequestBodyFailureReason =
  | 'invalid-form'
  | 'invalid-json'
  | 'unsupported-content-type';

export type UntrustedRequestBodyResult =
  | { carrier: UntrustedRequestBodyCarrier; ok: true; value: unknown }
  | { ok: false; reason: UntrustedRequestBodyFailureReason };

/**
 * SPEC §9.2: attacker-controlled mutation/endpoint bodies are expected client
 * input. Parse failures return typed outcomes so callers can choose their local
 * fail-closed response shape without routing malformed bodies through onError.
 */
export async function readUntrustedRequestBody(
  request: Request,
): Promise<UntrustedRequestBodyResult> {
  const carrier = requestBodyCarrier(request.headers.get('content-type'));

  if (carrier === 'json') {
    try {
      return { carrier, ok: true, value: await request.json() };
    } catch {
      return { ok: false, reason: 'invalid-json' };
    }
  }

  if (carrier === 'form') {
    try {
      return { carrier, ok: true, value: await request.formData() };
    } catch {
      return { ok: false, reason: 'invalid-form' };
    }
  }

  return { ok: false, reason: 'unsupported-content-type' };
}

/**
 * SPEC §6.6/§9.1: endpoint CSRF validation may inspect only a clone of the
 * request body so protected raw handlers receive the original stream. Parse
 * failures and non-record JSON cannot carry the named token field, so they map
 * to `{}` and fail through the normal synchronizer-token path.
 */
export async function readCsrfCarrierFromRequest(request: Request): Promise<unknown> {
  const result = await readUntrustedRequestBody(request.clone());
  if (!result.ok) return {};
  if (result.carrier === 'json' && !isObjectLike(result.value)) return {};
  return result.value;
}

function requestBodyCarrier(
  contentTypeHeader: string | null,
): UntrustedRequestBodyCarrier | undefined {
  const contentType = contentTypeHeader?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) return 'json';
  if (
    contentType === '' ||
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    return 'form';
  }
  return undefined;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

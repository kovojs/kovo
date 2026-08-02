import { request as nodeHttpRequest } from 'node:http';

const RESPONSE_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Make one loopback probe request under an absolute wall-clock allowance. Node's socket timeout is
 * an inactivity timer and can be extended forever by trickled bytes, so it cannot own this phase.
 */
export function requestKnownFailureHttpResponse(url, timeoutMs, options = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('packed HTTP request timeout must be a positive safe integer');
  }
  if (
    typeof options !== 'object' ||
    options === null ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => key !== 'accept')
  ) {
    throw new TypeError('packed HTTP request options may contain only accept');
  }
  if (options.accept !== undefined && options.accept !== 'application/json') {
    throw new TypeError('packed HTTP request accept must be application/json when provided');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const request = nodeHttpRequest(
      url,
      {
        headers: options.accept === undefined ? undefined : { Accept: options.accept },
        method: 'GET',
      },
      (response) => {
        let body = '';
        let bodyBytes = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          bodyBytes += Buffer.byteLength(chunk);
          if (bodyBytes > RESPONSE_BODY_LIMIT_BYTES) {
            const error = new Error('packed HTTP probe response exceeded 2 MiB');
            finish(reject, error);
            request.destroy(error);
          }
        });
        response.once('aborted', () =>
          finish(reject, new Error('packed HTTP probe response aborted before completion')),
        );
        response.once('error', (error) => finish(reject, error));
        response.once('end', () =>
          finish(resolve, { body, headers: response.headers, status: response.statusCode ?? 0 }),
        );
      },
    );
    request.once('error', (error) => finish(reject, error));
    timer = setTimeout(() => {
      const error = new Error(
        `packed HTTP probe exceeded its ${String(timeoutMs)}ms absolute deadline`,
      );
      finish(reject, error);
      request.destroy(error);
    }, timeoutMs);
    request.end();
  });
}

/** Require the exact generated starter health contract, not Vite's HTML/404 fallback surface. */
export function isKnownFailurePackedHealthResponse(response) {
  const contentType = String(response.headers['content-type'] ?? '');
  const cacheControl = String(response.headers['cache-control'] ?? '');
  if (!/\bapplication\/json\b/iu.test(contentType) || !/\bno-store\b/iu.test(cacheControl)) {
    return false;
  }
  try {
    const payload = JSON.parse(response.body);
    return (
      payload !== null &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      payload.ok === true &&
      Object.keys(payload).length === 1
    );
  } catch {
    return false;
  }
}

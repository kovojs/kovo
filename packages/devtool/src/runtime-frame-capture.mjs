// Connect/Vite development middleware that observes Kovo's already-sanitized
// enhanced round-trip carriers and records only redacted runtime-frame facts.
//
// Query output is parsed as a bounded stream. The parser never accumulates a
// response body or query value: it retains only a validated query name, three
// boolean carrier facts, and a byte count. The wrapper preserves the exact
// response write/end call shape and never participates in app backpressure.
import { RUNTIME_FRAME_MAX_BODY_BYTES } from './runtime-frames.mjs';

const QUERY_OPEN = '<kovo-query';
const QUERY_CLOSE = '</kovo-query>';
const MAX_CONCURRENT_CAPTURES = 16;
const MAX_CONCURRENT_CAPTURES_LIMIT = 128;
const MAX_FACTS = 64;
const MAX_NAME_LENGTH = 256;
const MAX_TAG_CHARACTERS = 4_096;
const GRAPH_NAME = /^[A-Za-z0-9_./:@-]+$/u;
const nativeReflectApply = Reflect.apply;

/**
 * @param {{
 *   app: string,
 *   store: { recordRoundTrip(input: unknown): unknown },
 *   maxBodyBytes?: number,
 *   maxConcurrentCaptures?: number
 * }} options
 */
export function runtimeFrameCaptureMiddleware({
  app,
  store,
  maxBodyBytes = RUNTIME_FRAME_MAX_BODY_BYTES,
  maxConcurrentCaptures = MAX_CONCURRENT_CAPTURES,
}) {
  if (typeof app !== 'string' || app.length === 0) {
    throw new TypeError('runtimeFrameCaptureMiddleware: app is required.');
  }
  if (typeof store?.recordRoundTrip !== 'function') {
    throw new TypeError('runtimeFrameCaptureMiddleware: a runtime frame store is required.');
  }
  if (
    !Number.isSafeInteger(maxBodyBytes) ||
    maxBodyBytes < 1 ||
    maxBodyBytes > RUNTIME_FRAME_MAX_BODY_BYTES
  ) {
    throw new TypeError('runtimeFrameCaptureMiddleware: maxBodyBytes is invalid.');
  }
  if (
    !Number.isSafeInteger(maxConcurrentCaptures) ||
    maxConcurrentCaptures < 1 ||
    maxConcurrentCaptures > MAX_CONCURRENT_CAPTURES_LIMIT
  ) {
    throw new TypeError('runtimeFrameCaptureMiddleware: maxConcurrentCaptures is invalid.');
  }

  let activeCaptures = 0;
  return function captureKovoRuntimeFrame(request, response, next) {
    const url = typeof request.url === 'string' ? request.url : '/';
    const targetsHeader = requestHeader(request.headers, 'kovo-targets');
    if (!url.startsWith('/_m/') && targetsHeader === undefined) {
      next();
      return;
    }

    safeRecord(store, {
      app,
      phase: 'pending',
      targetsHeader,
      url,
    });

    const ownsCaptureSlot = activeCaptures < maxConcurrentCaptures;
    if (ownsCaptureSlot) activeCaptures += 1;
    const queryCapture = ownsCaptureSlot ? createRuntimeQueryCapture(maxBodyBytes) : undefined;
    const ownWrite = Object.getOwnPropertyDescriptor(response, 'write');
    const ownEnd = Object.getOwnPropertyDescriptor(response, 'end');
    const originalWrite = response.write;
    const originalEnd = response.end;
    if (typeof originalWrite !== 'function' || typeof originalEnd !== 'function') {
      if (ownsCaptureSlot) activeCaptures -= 1;
      next();
      return;
    }

    let completed = false;
    let captureFailed = !ownsCaptureSlot;
    const observeChunk = (chunk, encoding) => {
      if (captureFailed) return;
      try {
        queryCapture.write(chunk, encoding);
      } catch {
        captureFailed = true;
      }
    };
    const wrappedWrite = function wrappedRuntimeFrameWrite(chunk, encoding) {
      observeChunk(chunk, encoding);
      return nativeReflectApply(originalWrite, this, arguments);
    };
    const wrappedEnd = function wrappedRuntimeFrameEnd(chunk, encoding) {
      observeChunk(chunk, encoding);
      return nativeReflectApply(originalEnd, this, arguments);
    };
    const finish = () => {
      if (completed) return;
      completed = true;
      try {
        response.removeListener?.('finish', finish);
        response.removeListener?.('close', finish);
        restoreResponseMethod(response, 'write', wrappedWrite, ownWrite);
        restoreResponseMethod(response, 'end', wrappedEnd, ownEnd);
      } catch {
        // A frozen response wrapper is still owned by the host, not the devtool.
      }
      if (ownsCaptureSlot) activeCaptures -= 1;
      let captured = { queries: [], truncated: true };
      if (!captureFailed) {
        try {
          captured = queryCapture.finish();
        } catch {
          captureFailed = true;
        }
      }
      let changesHeader;
      try {
        changesHeader =
          typeof response.getHeader === 'function'
            ? responseHeader(response.getHeader('Kovo-Changes'))
            : undefined;
      } catch {
        changesHeader = undefined;
      }
      safeRecord(store, {
        app,
        changesHeader,
        phase: 'settled',
        queries: captured.queries,
        queriesTruncated: captured.truncated,
        status: response.statusCode,
        targetsHeader,
        url,
      });
    };

    try {
      response.write = wrappedWrite;
      response.end = wrappedEnd;
      response.once?.('finish', finish);
      response.once?.('close', finish);
    } catch {
      if (ownsCaptureSlot) activeCaptures -= 1;
      try {
        restoreResponseMethod(response, 'write', wrappedWrite, ownWrite);
        restoreResponseMethod(response, 'end', wrappedEnd, ownEnd);
      } catch {
        // The host response remains untouched if its methods are non-writable.
      }
      next();
      return;
    }

    try {
      next();
    } catch (error) {
      finish();
      throw error;
    }
  };
}

function createRuntimeQueryCapture(maxBodyBytes) {
  const decoder = new TextDecoder();
  const queries = [];
  let bodyBytes = 0;
  let closed = false;
  let mode = 'seek';
  let openMatch = 0;
  let closeMatch = 0;
  let tagCharacters = 0;
  let attributeMode = 'between';
  let attributeName = '';
  let attributeNameValid = true;
  let attributeHasValue = false;
  let attributeQuote = '';
  let nameValue = '';
  let nameValueValid = true;
  let draft;
  let contentBytes = 0;
  let truncated = false;
  let result;

  const processText = (value, encoding = 'utf8') => {
    for (const character of value) {
      let characterBytes;
      try {
        characterBytes = Buffer.byteLength(character, encoding);
      } catch {
        truncated = true;
        mode = 'done';
        return;
      }
      processCharacter(character, characterBytes);
      if (mode === 'done') return;
    }
  };

  const processCharacter = (character, characterBytes) => {
    if (mode === 'seek') {
      if (character === QUERY_OPEN.charAt(openMatch)) {
        openMatch += 1;
        if (openMatch === QUERY_OPEN.length) {
          if (queries.length >= MAX_FACTS) {
            truncated = true;
            mode = 'done';
          } else {
            mode = 'boundary';
            openMatch = 0;
          }
        }
      } else {
        openMatch = character === QUERY_OPEN.charAt(0) ? 1 : 0;
      }
      return;
    }
    if (mode === 'boundary') {
      if (character === '>') {
        beginQueryContent();
      } else if (isAsciiWhitespace(character)) {
        beginTag();
      } else if (character === '/') {
        beginTag();
      } else {
        truncated = true;
        mode = 'seek';
        openMatch = character === QUERY_OPEN.charAt(0) ? 1 : 0;
      }
      return;
    }
    if (mode === 'tag') {
      processTagCharacter(character);
      return;
    }
    if (mode === 'content') {
      if (character === QUERY_CLOSE.charAt(closeMatch)) {
        closeMatch += 1;
        if (closeMatch === QUERY_CLOSE.length) finishQuery();
        return;
      }
      if (closeMatch > 0) {
        contentBytes = Math.min(RUNTIME_FRAME_MAX_BODY_BYTES, contentBytes + closeMatch);
        closeMatch = 0;
        if (character === QUERY_CLOSE.charAt(0)) {
          closeMatch = 1;
          return;
        }
      }
      contentBytes = Math.min(RUNTIME_FRAME_MAX_BODY_BYTES, contentBytes + characterBytes);
    }
  };

  const beginTag = () => {
    draft = { delta: false, keyed: false, name: undefined, settlesPendingWork: false };
    tagCharacters = 0;
    attributeMode = 'between';
    resetAttribute();
    mode = 'tag';
  };

  const beginQueryContent = () => {
    if (draft === undefined) {
      draft = { delta: false, keyed: false, name: undefined, settlesPendingWork: false };
    }
    contentBytes = 0;
    closeMatch = 0;
    mode = 'content';
  };

  const processTagCharacter = (character) => {
    tagCharacters += 1;
    if (tagCharacters > MAX_TAG_CHARACTERS) {
      truncated = true;
      mode = 'done';
      return;
    }
    if (attributeMode === 'between') {
      if (isAsciiWhitespace(character) || character === '/') return;
      if (character === '>') {
        beginQueryContent();
        return;
      }
      startAttribute(character);
      return;
    }
    if (attributeMode === 'name') {
      if (character === '=') {
        attributeHasValue = true;
        attributeMode = 'before-value';
      } else if (isAsciiWhitespace(character)) {
        attributeMode = 'after-name';
      } else if (character === '>') {
        commitAttribute();
        beginQueryContent();
      } else {
        appendAttributeName(character);
      }
      return;
    }
    if (attributeMode === 'after-name') {
      if (isAsciiWhitespace(character)) return;
      if (character === '=') {
        attributeHasValue = true;
        attributeMode = 'before-value';
        return;
      }
      commitAttribute();
      if (character === '>') beginQueryContent();
      else startAttribute(character);
      return;
    }
    if (attributeMode === 'before-value') {
      if (isAsciiWhitespace(character)) return;
      if (character === '"' || character === "'") {
        attributeQuote = character;
        attributeMode = 'quoted-value';
      } else if (character === '>') {
        commitAttribute();
        beginQueryContent();
      } else {
        attributeMode = 'unquoted-value';
        appendAttributeValue(character);
      }
      return;
    }
    if (attributeMode === 'quoted-value') {
      if (character === attributeQuote) {
        commitAttribute();
        attributeMode = 'between';
      } else {
        appendAttributeValue(character);
      }
      return;
    }
    if (attributeMode === 'unquoted-value') {
      if (isAsciiWhitespace(character)) {
        commitAttribute();
        attributeMode = 'between';
      } else if (character === '>') {
        commitAttribute();
        beginQueryContent();
      } else {
        appendAttributeValue(character);
      }
    }
  };

  const startAttribute = (character) => {
    resetAttribute();
    attributeMode = 'name';
    appendAttributeName(character);
  };

  const appendAttributeName = (character) => {
    if (!/[A-Za-z0-9_:-]/u.test(character) || attributeName.length >= 32) {
      attributeNameValid = false;
      return;
    }
    attributeName += character.toLowerCase();
  };

  const appendAttributeValue = (character) => {
    if (attributeName !== 'name') return;
    if (nameValue.length >= MAX_NAME_LENGTH || !/[A-Za-z0-9_./:@-]/u.test(character)) {
      nameValueValid = false;
      return;
    }
    nameValue += character;
  };

  const commitAttribute = () => {
    if (draft === undefined || !attributeNameValid) {
      resetAttribute();
      return;
    }
    if (
      attributeName === 'name' &&
      attributeHasValue &&
      nameValueValid &&
      GRAPH_NAME.test(nameValue)
    ) {
      draft.name = nameValue;
    } else if (attributeName === 'delta' && !attributeHasValue) {
      draft.delta = true;
    } else if (attributeName === 'key' && attributeHasValue) {
      draft.keyed = true;
    } else if (attributeName === 'settles' && attributeHasValue) {
      draft.settlesPendingWork = true;
    }
    resetAttribute();
  };

  const resetAttribute = () => {
    attributeName = '';
    attributeNameValid = true;
    attributeHasValue = false;
    attributeQuote = '';
    nameValue = '';
    nameValueValid = true;
  };

  const finishQuery = () => {
    if (draft?.name === undefined) {
      truncated = true;
    } else {
      queries.push({
        bytes: contentBytes,
        delta: draft.delta,
        keyed: draft.keyed,
        name: draft.name,
        settlesPendingWork: draft.settlesPendingWork,
        value: 'redacted',
      });
    }
    draft = undefined;
    contentBytes = 0;
    closeMatch = 0;
    mode = 'seek';
  };

  return Object.freeze({
    finish() {
      if (result !== undefined) return result;
      if (!closed) {
        closed = true;
        if (!truncated) processText(decoder.decode());
        if (mode !== 'seek' || openMatch > 0) truncated = true;
      }
      result = Object.freeze({
        queries: Object.freeze(queries.slice()),
        truncated,
      });
      return result;
    },
    write(chunk, encoding) {
      if (
        closed ||
        truncated ||
        chunk === undefined ||
        chunk === null ||
        typeof chunk === 'function'
      )
        return;
      if (typeof chunk === 'string') {
        const selectedEncoding = typeof encoding === 'string' ? encoding : 'utf8';
        for (const character of chunk) {
          let characterBytes;
          try {
            characterBytes = Buffer.byteLength(character, selectedEncoding);
          } catch {
            truncated = true;
            mode = 'done';
            return;
          }
          if (bodyBytes + characterBytes > maxBodyBytes) {
            truncated = true;
            mode = 'done';
            return;
          }
          bodyBytes += characterBytes;
          processCharacter(character, characterBytes);
          if (mode === 'done') return;
        }
        return;
      }
      let bytes;
      if (ArrayBuffer.isView(chunk)) {
        bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      } else if (chunk instanceof ArrayBuffer) {
        bytes = new Uint8Array(chunk);
      } else {
        truncated = true;
        mode = 'done';
        return;
      }
      const remaining = maxBodyBytes - bodyBytes;
      const selected = bytes.byteLength > remaining ? bytes.subarray(0, remaining) : bytes;
      bodyBytes += selected.byteLength;
      processText(decoder.decode(selected, { stream: true }));
      if (selected.byteLength !== bytes.byteLength) {
        truncated = true;
        mode = 'done';
      }
    },
  });
}

function safeRecord(store, input) {
  try {
    store.recordRoundTrip(input);
  } catch {
    // A debugging observer is never allowed to affect the app response path.
  }
}

function restoreResponseMethod(response, name, wrapper, descriptor) {
  if (response[name] !== wrapper) return;
  if (descriptor === undefined) delete response[name];
  else Object.defineProperty(response, name, descriptor);
}

function isAsciiWhitespace(value) {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t' || value === '\f';
}

function requestHeader(headers, name) {
  if (headers === undefined || headers === null || typeof headers !== 'object') return undefined;
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

function responseHeader(value) {
  return typeof value === 'string' ? value : undefined;
}

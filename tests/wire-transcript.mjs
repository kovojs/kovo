export const requestMarker = '>>> REQUEST';
export const responseMarker = '<<< RESPONSE';

export const parseWireTranscript = (fixtureBody) => {
  const exchanges = [];
  let cursor = 0;

  while (true) {
    const requestStart = fixtureBody.indexOf(requestMarker, cursor);
    if (requestStart === -1) {
      return exchanges;
    }

    const requestBodyStart = fixtureBody.indexOf('\n', requestStart);
    const responseStart = fixtureBody.indexOf(responseMarker, requestBodyStart);
    if (requestBodyStart === -1 || responseStart === -1) {
      throw new Error('Wire transcript contains an incomplete request/response pair');
    }

    const responseBodyStart = fixtureBody.indexOf('\n', responseStart);
    const nextRequestStart = fixtureBody.indexOf(`\n${requestMarker}`, responseBodyStart);
    if (responseBodyStart === -1) {
      throw new Error('Wire transcript response marker is missing a status line');
    }

    const requestBlock = fixtureBody.slice(requestBodyStart + 1, responseStart).trimEnd();
    const responseBlock =
      nextRequestStart === -1
        ? fixtureBody.slice(responseBodyStart + 1)
        : fixtureBody.slice(responseBodyStart + 1, nextRequestStart);

    exchanges.push({
      request: parseWireRequestBlock(requestBlock),
      response: parseWireResponseBlock(responseBlock),
    });

    cursor = nextRequestStart === -1 ? fixtureBody.length : nextRequestStart + 1;
  }
};

export const parseWireResponses = (fixtureBody) =>
  parseWireTranscript(fixtureBody).map((exchange) => exchange.response);

const parseWireRequestBlock = (block) => {
  const separator = block.indexOf('\n\n');
  const head = separator === -1 ? block : block.slice(0, separator);
  const body = separator === -1 ? '' : block.slice(separator + 2);
  const [requestLine, ...headerLines] = head.split('\n');
  if (!requestLine) {
    throw new Error('Wire transcript request is missing request line');
  }

  const [method, path] = requestLine.split(' ');
  if (!method || !path) {
    throw new Error(`Malformed wire transcript request line: ${requestLine}`);
  }

  return {
    body,
    headers: parseHeaderLines(headerLines),
    method,
    path,
    requestLine,
  };
};

const parseWireResponseBlock = (block) => {
  const separator = block.indexOf('\n\n');
  const head = separator === -1 ? block.trimEnd() : block.slice(0, separator);
  const body = separator === -1 ? '' : block.slice(separator + 2);
  const [statusLine, ...headerLines] = head.split('\n');
  if (!statusLine) {
    throw new Error('Wire transcript response is missing status line');
  }

  const statusMatch = /^HTTP\/1\.1 (?<status>\d{3}) (?<statusText>.+)$/.exec(statusLine);
  if (!statusMatch?.groups) {
    throw new Error(`Malformed wire transcript status line: ${statusLine}`);
  }

  const { status, statusText } = statusMatch.groups;
  if (!status || !statusText) {
    throw new Error(`Malformed wire transcript status line: ${statusLine}`);
  }

  const headers = parseHeaderLines(headerLines);

  return {
    body,
    headers,
    headersByName: Object.fromEntries(headers.map(([name, value]) => [name.toLowerCase(), value])),
    status: Number(status),
    statusLine,
    statusText,
  };
};

const parseHeaderLines = (lines) =>
  lines
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf(':');
      if (separator === -1) {
        throw new Error(`Malformed wire transcript header: ${line}`);
      }

      return [line.slice(0, separator), line.slice(separator + 1).trim()];
    });

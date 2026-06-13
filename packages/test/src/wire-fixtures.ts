export interface WireTranscriptRequest {
  body: string;
  headers: Record<string, string>;
  headersByName: Record<string, string>;
  method: string;
  path: string;
  requestLine: string;
  startLine: string;
}

export interface WireTranscriptResponse {
  body: string;
  headers: Record<string, string>;
  headersByName: Record<string, string>;
  status: number;
  statusLine: string;
  statusText: string;
  startLine: string;
}

export interface WireTranscriptExchange {
  request: WireTranscriptRequest;
  response: WireTranscriptResponse;
}

export interface WireFixture {
  exchanges: WireTranscriptExchange[];
  request: WireTranscriptRequest;
  response: WireTranscriptResponse;
  title: string;
}

const requestMarker = '>>> REQUEST';
const responseMarker = '<<< RESPONSE';

export function parseWireFixture(source: string): WireFixture {
  const title = parseWireFixtureTitle(source);
  const exchanges = parseWireTranscript(source);
  const [firstExchange] = exchanges;
  if (!firstExchange) {
    throw new Error('Wire fixture includes at least one request/response exchange');
  }

  return {
    exchanges,
    request: firstExchange.request,
    response: firstExchange.response,
    title,
  };
}

export function parseWireResponses(source: string): WireTranscriptResponse[] {
  return parseWireTranscript(source).map((exchange) => exchange.response);
}

export function parseWireTranscript(source: string): WireTranscriptExchange[] {
  const exchanges: WireTranscriptExchange[] = [];
  let cursor = 0;

  while (true) {
    const requestMarkerStart = source.indexOf(requestMarker, cursor);
    if (requestMarkerStart === -1) {
      return exchanges;
    }

    const requestBlockStart = source.indexOf('\n', requestMarkerStart);
    const responseMarkerStart =
      requestBlockStart === -1 ? -1 : source.indexOf(responseMarker, requestBlockStart);
    if (requestBlockStart === -1 || responseMarkerStart === -1) {
      throw new Error('Wire transcript contains an incomplete request/response pair');
    }

    const responseBlockStart = source.indexOf('\n', responseMarkerStart);
    if (responseBlockStart === -1) {
      throw new Error('Wire transcript response marker is missing a status line');
    }

    const nextRequestMarkerStart = source.indexOf(`\n${requestMarker}`, responseBlockStart);
    const requestBlock = source.slice(requestBlockStart + 1, responseMarkerStart).trimEnd();
    const responseBlock =
      nextRequestMarkerStart === -1
        ? source.slice(responseBlockStart + 1)
        : source.slice(responseBlockStart + 1, nextRequestMarkerStart);

    exchanges.push({
      request: parseWireRequestBlock(requestBlock),
      response: parseWireResponseBlock(responseBlock),
    });

    cursor = nextRequestMarkerStart === -1 ? source.length : nextRequestMarkerStart + 1;
  }
}

function parseWireFixtureTitle(source: string): string {
  const [firstLine = ''] = source.split('\n', 1);
  if (!firstLine.startsWith('### ')) {
    throw new Error('Wire fixture starts with a scenario title');
  }

  const title = firstLine.slice('### '.length).trim();
  if (title.length === 0) {
    throw new Error('Wire fixture title is not empty');
  }

  return title;
}

function parseWireRequestBlock(block: string): WireTranscriptRequest {
  const { body, head } = splitHttpBlock(block);
  const [requestLine = '', ...headerLines] = head.split('\n');
  if (requestLine.length === 0) {
    throw new Error('Wire transcript request is missing request line');
  }

  const [method, path] = requestLine.split(' ');
  if (!method || !path) {
    throw new Error(`Malformed wire transcript request line: ${requestLine}`);
  }

  const headers = parseHeaderLines(headerLines);
  return {
    body,
    headers,
    headersByName: lowercaseHeaderNames(headers),
    method,
    path,
    requestLine,
    startLine: requestLine,
  };
}

function parseWireResponseBlock(block: string): WireTranscriptResponse {
  const { body, head } = splitHttpBlock(block);
  const [statusLine = '', ...headerLines] = head.split('\n');
  if (statusLine.length === 0) {
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
    headersByName: lowercaseHeaderNames(headers),
    status: Number(status),
    statusLine,
    statusText,
    startLine: statusLine,
  };
}

function splitHttpBlock(block: string): { body: string; head: string } {
  const separator = block.indexOf('\n\n');
  return separator === -1
    ? { body: '', head: block }
    : { body: block.slice(separator + 2), head: block.slice(0, separator) };
}

function parseHeaderLines(lines: string[]): Record<string, string> {
  return Object.fromEntries(
    lines
      .filter((line) => line.length > 0)
      .map((line) => {
        const separator = line.indexOf(':');
        if (separator === -1) {
          throw new Error(`Malformed wire transcript header: ${line}`);
        }

        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
  );
}

function lowercaseHeaderNames(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

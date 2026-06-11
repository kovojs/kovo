export type WireTranscriptExchange = {
  request: WireTranscriptRequest;
  response: WireTranscriptResponse;
};

export type WireTranscriptRequest = {
  body: string;
  headers: Array<readonly [string, string]>;
  method: string;
  path: string;
  requestLine: string;
};

export type WireTranscriptResponse = {
  body: string;
  headers: Array<readonly [string, string]>;
  headersByName: Record<string, string>;
  status: number;
  statusLine: string;
  statusText: string;
};

export const requestMarker: '>>> REQUEST';
export const responseMarker: '<<< RESPONSE';

export function parseWireTranscript(fixtureBody: string): WireTranscriptExchange[];

export function parseWireResponses(fixtureBody: string): WireTranscriptResponse[];

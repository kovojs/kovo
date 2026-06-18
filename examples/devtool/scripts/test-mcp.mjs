#!/usr/bin/env node
// Smoke test: spawn the MCP server over stdio and exercise it through the SDK
// client — proves it's a real MCP server, not just callable functions.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({ command: 'node', args: [join(HERE, 'mcp-server.mjs')] });
const client = new Client({ name: 'test', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const res = await client.callTool({ name: 'kovo_explain', arguments: { query: 'cart/add', app: 'commerce', limit: 2 } });
const sc = res.structuredContent;
console.log('callTool kovo_explain("cart/add"):', sc.count, 'cards; top =', sc.results[0].label, sc.results[0].kind);
console.log('--- text (first 12 lines) ---');
console.log(res.content[0].text.split('\n').slice(0, 12).join('\n'));

await client.close();
console.log('\nOK — stdio round-trip works.');

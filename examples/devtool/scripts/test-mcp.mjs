#!/usr/bin/env node
// Smoke test: spawn the package's `kovo-devtool mcp` bin over stdio and exercise
// it through the SDK client — proves the package ships a real MCP server.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const bin = join(HERE, '..', '..', '..', 'packages', 'devtool', 'bin', 'kovo-devtool.mjs');

const transport = new StdioClientTransport({
  command: 'node',
  args: [
    bin,
    'mcp',
    '--graph',
    '../commerce/src/generated/graph.json',
    '--src',
    '../commerce/src',
    '--label',
    'Commerce',
  ],
  cwd: join(HERE, '..'),
});
const client = new Client({ name: 'test', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('tools:', tools.map((t) => t.name).join(', '));

const res = await client.callTool({
  name: 'kovo_explain',
  arguments: { query: 'cart/add', app: 'commerce', limit: 2 },
});
const sc = res.structuredContent;
console.log(
  'callTool kovo_explain("cart/add"):',
  sc.count,
  'cards; top =',
  sc.results[0].label,
  sc.results[0].kind,
);
console.log(res.content[0].text.split('\n').slice(0, 10).join('\n'));

await client.close();
console.log('\nOK — package MCP bin works over stdio.');

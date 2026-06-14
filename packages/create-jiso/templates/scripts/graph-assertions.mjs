import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function fwExplain(args) {
  return execFileSync('fw', ['explain', ...args, 'graph.json'], { encoding: 'utf8' });
}

function explainLine(output, prefix) {
  const line = output.split('\n').find((item) => item.startsWith(prefix));
  assert.ok(line, `Missing fw explain line: ${prefix}`);
  return line.slice(prefix.length);
}

function explainList(value) {
  return value === '-' ? [] : value.split(',').filter(Boolean);
}

const cartQuery = fwExplain(['query', 'cart']);
const cartConsumers = explainList(explainLine(cartQuery, 'consumers: ')).filter((consumer) =>
  consumer.startsWith('component:'),
);

assert.deepEqual(cartConsumers.sort(), ['component:CartBadge', 'component:CartPanel']);
assert.match(explainLine(cartQuery, 'invalidated-by: '), /(^|,)cart\/add(,|$)/);
assert.match(explainLine(cartQuery, 'domain-writes: '), /(^|,)cart\.addItem(,|$)/);

const cartAdd = fwExplain(['mutation', 'cart/add', '--optimistic']);
assert.equal(explainLine(cartAdd, 'session: '), 'starterSession');
assert.deepEqual(explainList(explainLine(cartAdd, 'input-fields: ')), ['productId', 'quantity']);
assert.match(cartAdd, /^updates: cart->component:CartBadge,component:CartPanel,page:\/cart$/m);
assert.match(cartAdd, /^OPTIMISTIC cart await-fragment$/m);
assert.match(cartAdd, /^OPTIMISTIC-SUMMARY .*\bUNHANDLED=0\b/m);

const cartPage = fwExplain(['page', '/cart']);
assert.equal(explainLine(cartPage, 'prefetch: '), 'false');
assert.match(explainLine(cartPage, 'meta: '), /title=Jiso Starter Cart/);
assert.deepEqual(explainList(explainLine(cartPage, 'i18n: ')), ['en-US:cartTitle']);
assert.deepEqual(explainList(explainLine(cartPage, 'modulepreloads: ')), []);
assert.deepEqual(explainList(explainLine(cartPage, 'stylesheets: ')), ['/src/styles.css']);
assert.deepEqual(explainList(explainLine(cartPage, 'queries: ')), ['cart']);

process.stdout.write('graph-assertions/v1\nOK\n');

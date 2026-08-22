import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA = 'kovo-matched-server-semantic-contract/v1';
export const MATCHED_SERVER_SEMANTIC_EVIDENCE_SCHEMA = 'kovo-matched-server-semantic-evidence/v1';
export const MATCHED_SERVER_SEMANTIC_SOURCE_SCHEMA = 'kovo-matched-server-semantic-source/v1';

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const authoritativeFiles = Object.freeze({
  catalog: new URL('./catalog.json', import.meta.url),
  fixture: new URL('./matched-fixture.json', import.meta.url),
  helper: new URL('./server-semantic-contract.mjs', import.meta.url),
});
const fixture = JSON.parse(readFileSync(authoritativeFiles.fixture, 'utf8'));
const catalog = JSON.parse(readFileSync(authoritativeFiles.catalog, 'utf8'));

validateAuthoritativeData(fixture, catalog);

export const MATCHED_SERVER_DETAIL_SLUG = fixture.serverSemantic.detailProductSlug;

export const MATCHED_SERVER_SEMANTIC_SOURCE = deepFreeze(sourceIdentity());

const contracts = deepFreeze({
  detail: expectedProjection('detail'),
  listing: expectedProjection('listing'),
});
const contractEvidence = deepFreeze(
  Object.fromEntries(
    Object.entries(contracts).map(([route, contract]) => {
      const tokens = semanticTokens(contract);
      return [
        route,
        {
          schema: MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA,
          sha256: sha256(canonicalJson(contract)),
          tokenCount: tokens.length,
        },
      ];
    }),
  ),
);

/**
 * Return the canonical observable contract for one matched production-server route.
 *
 * The contract is fixture-derived and intentionally excludes framework-only stamps, document
 * wrappers, and byte layout. Kovo and Next may serialize different HTML while proving the same
 * shell, controls, catalog rows, links, images, prices, and detail quantity semantics.
 */
export function matchedServerSemanticContract(route) {
  assertRoute(route);
  return contracts[route];
}

/**
 * Validate the identity representation before any server timing window (SPEC §1.3 and §12).
 * Comments, raw script/style payloads, and inert template descendants cannot satisfy facts.
 */
export function validateMatchedServerDocument(body, { route } = {}) {
  assertRoute(route);
  const { bytes, html } = documentBytesAndText(body);
  const document = parseHtml(html);
  const observed = observedProjection(document, route);
  const expected = contracts[route];
  const difference = firstDifference(expected, observed);
  if (difference !== null) {
    throw new Error(
      `matched ${route} semantic contract mismatch at ${difference.path}: expected ${canonicalJson(
        difference.expected,
      )}, received ${canonicalJson(difference.actual)}`,
    );
  }
  const tokens = semanticTokens(observed);
  const evidence = contractEvidence[route];
  const observedSha256 = sha256(canonicalJson(observed));
  if (tokens.length !== evidence.tokenCount || observedSha256 !== evidence.sha256) {
    throw new Error(`matched ${route} semantic evidence did not reproduce its canonical digest`);
  }
  return {
    contract: evidence,
    evidence: {
      sha256: observedSha256,
      tokenCount: tokens.length,
    },
    identityBodySha256: sha256(bytes),
    route,
    schema: MATCHED_SERVER_SEMANTIC_EVIDENCE_SCHEMA,
    source: MATCHED_SERVER_SEMANTIC_SOURCE,
    validated: true,
  };
}

function expectedProjection(route) {
  const semantic = fixture.serverSemantic;
  const shell = semantic.shell;
  const expectedShell = {
    brand: { href: semantic.basePath, text: fixture.brand },
    cartTrigger: {
      ariaLabel: fixture.l0.cartLabel,
      popoverTarget: shell.cartDialogId,
      text: fixture.l0.cartText,
      type: 'button',
    },
    checkout: {
      action: semantic.basePath,
      fields: [
        {
          autocomplete: shell.nameField.autocomplete,
          label: shell.nameLabel,
          name: shell.nameField.name,
          type: 'text',
        },
        {
          autocomplete: shell.emailField.autocomplete,
          label: shell.emailLabel,
          name: shell.emailField.name,
          type: shell.emailField.type,
        },
      ],
      method: shell.checkoutMethod,
      submit: { text: shell.submitLabel, type: 'submit' },
    },
    dialog: {
      ariaLabelledBy: shell.cartTitleId,
      close: {
        popoverTarget: shell.cartDialogId,
        popoverTargetAction: 'hide',
        text: shell.closeLabel,
        type: 'button',
      },
      description: fixture.l0.cartDescription,
      id: shell.cartDialogId,
      popover: true,
      role: 'dialog',
      title: { id: shell.cartTitleId, text: shell.cartTitle },
    },
    lane: semantic.lane,
  };
  const common = {
    route,
    schema: MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA,
    shell: expectedShell,
  };
  if (route === 'listing') {
    return {
      ...common,
      content: {
        destination: 'listing',
        description: fixture.listingDescription,
        heading: fixture.listingHeading,
        products: catalog.map((product) => ({
          blurb: product.blurb,
          details: {
            href: `${semantic.basePath}/product/${product.slug}`,
            text: semantic.detailsLabel,
          },
          image: {
            alt: semantic.image.alt,
            height: semantic.image.height,
            loading: semantic.image.listingLoading,
            src: product.img,
            width: semantic.image.width,
          },
          name: product.name,
          price: price(product.price),
          view: {
            ariaLabel: `${semantic.viewLabelPrefix}${product.name}`,
            href: `${semantic.basePath}/product/${product.slug}`,
          },
        })),
        productsLabel: semantic.productsLabel,
      },
    };
  }
  const product = catalog.find(({ slug }) => slug === semantic.detailProductSlug);
  return {
    ...common,
    content: {
      destination: 'detail',
      product: {
        blurb: product.blurb,
        image: {
          alt: semantic.image.alt,
          height: semantic.image.height,
          loading: semantic.image.detailLoading,
          src: product.img,
          width: semantic.image.width,
        },
        name: product.name,
        price: price(product.price),
        quantity: {
          label: semantic.quantity.label,
          minimum: semantic.quantity.minimum,
          type: 'number',
          value: semantic.quantity.value,
        },
      },
    },
  };
}

function observedProjection(document, route) {
  const semantic = fixture.serverSemantic;
  const shellNode = requireUnique(
    document,
    (node) => node.attrs['data-benchmark-lane'] !== undefined,
    'benchmark shell',
  );
  const main = requireUnique(
    shellNode,
    (node) => node.tag === 'main' && node.attrs['data-benchmark-destination'] !== undefined,
    'benchmark destination',
  );
  const nav = requireUnique(shellNode, (node) => node.tag === 'nav', 'shell navigation');
  const brand = requireUnique(
    nav,
    (node) => node.tag === 'a' && hasClass(node, 'brand'),
    'brand link',
  );
  const cartTrigger = requireUnique(nav, (node) => node.tag === 'button', 'cart trigger');
  const dialog = requireUnique(
    shellNode,
    (node) => node.attrs.id === semantic.shell.cartDialogId,
    'cart dialog',
  );
  const dialogHeader = requireUnique(dialog, (node) => node.tag === 'header', 'cart dialog header');
  const dialogTitle = requireUnique(dialogHeader, (node) => node.tag === 'h2', 'cart dialog title');
  const dialogDescription = requireUnique(
    dialogHeader,
    (node) => node.tag === 'p',
    'cart dialog description',
  );
  const close = requireUnique(dialogHeader, (node) => node.tag === 'button', 'cart close button');
  const checkout = requireUnique(dialog, (node) => node.tag === 'form', 'checkout form');
  const labels = findElements(checkout, (node) => node.tag === 'label');
  if (labels.length !== 2) {
    throw new Error(`checkout form expected 2 field labels, received ${String(labels.length)}`);
  }
  const fields = labels.map((label, index) => {
    const input = requireUnique(label, (node) => node.tag === 'input', `checkout field ${index}`);
    return {
      autocomplete: input.attrs.autocomplete ?? '',
      label: elementText(label),
      name: input.attrs.name ?? '',
      type: input.attrs.type ?? 'text',
    };
  });
  const submit = requireUnique(checkout, (node) => node.tag === 'button', 'checkout submit button');
  const common = {
    route,
    schema: MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA,
    shell: {
      brand: { href: brand.attrs.href ?? '', text: elementText(brand) },
      cartTrigger: {
        ariaLabel: cartTrigger.attrs['aria-label'] ?? '',
        popoverTarget: cartTrigger.attrs.popovertarget ?? '',
        text: elementText(cartTrigger),
        type: cartTrigger.attrs.type ?? 'submit',
      },
      checkout: {
        action: checkout.attrs.action ?? '',
        fields,
        method: (checkout.attrs.method ?? 'get').toLowerCase(),
        submit: { text: elementText(submit), type: submit.attrs.type ?? 'submit' },
      },
      dialog: {
        ariaLabelledBy: dialog.attrs['aria-labelledby'] ?? '',
        close: {
          popoverTarget: close.attrs.popovertarget ?? '',
          popoverTargetAction: close.attrs.popovertargetaction ?? '',
          text: elementText(close),
          type: close.attrs.type ?? 'submit',
        },
        description: elementText(dialogDescription),
        id: dialog.attrs.id ?? '',
        popover: hasAttribute(dialog, 'popover'),
        role: dialog.attrs.role ?? '',
        title: { id: dialogTitle.attrs.id ?? '', text: elementText(dialogTitle) },
      },
      lane: shellNode.attrs['data-benchmark-lane'] ?? '',
    },
  };
  if (route === 'listing') return observedListingProjection(common, main);
  return observedDetailProjection(common, main);
}

function observedListingProjection(common, main) {
  const hero = requireUnique(main, (node) => hasClass(node, 'hero'), 'listing hero');
  const grid = requireUnique(main, (node) => hasClass(node, 'grid'), 'product grid');
  const heading = requireUnique(hero, (node) => node.tag === 'h1', 'listing heading');
  const description = requireUnique(hero, (node) => node.tag === 'p', 'listing description');
  const cards = findElements(grid, (node) => node.tag === 'article');
  if (cards.length !== fixture.catalogItems) {
    throw new Error(
      `listing expected ${String(fixture.catalogItems)} product cards, received ${String(cards.length)}`,
    );
  }
  return {
    ...common,
    content: {
      destination: main.attrs['data-benchmark-destination'] ?? '',
      description: elementText(description),
      heading: elementText(heading),
      products: cards.map((card, index) => {
        const name = requireUnique(card, (node) => node.tag === 'h2', `product ${index} name`);
        const blurb = requireUnique(card, (node) => node.tag === 'p', `product ${index} blurb`);
        const priceNode = requireUnique(
          card,
          (node) => node.tag === 'span' && hasClass(node, 'price'),
          `product ${index} price`,
        );
        const image = requireUnique(card, (node) => node.tag === 'img', `product ${index} image`);
        const view = requireUnique(
          card,
          (node) => node.tag === 'a' && containsNode(node, image),
          `product ${index} image link`,
        );
        const details = requireUnique(
          card,
          (node) => node.tag === 'a' && hasClass(node, 'secondary-button'),
          `product ${index} details link`,
        );
        return {
          blurb: elementText(blurb),
          details: { href: details.attrs.href ?? '', text: elementText(details) },
          image: observedImage(image),
          name: elementText(name),
          price: elementText(priceNode),
          view: {
            ariaLabel: view.attrs['aria-label'] ?? '',
            href: view.attrs.href ?? '',
          },
        };
      }),
      productsLabel: grid.attrs['aria-label'] ?? '',
    },
  };
}

function observedDetailProjection(common, main) {
  const copy = requireUnique(main, (node) => hasClass(node, 'detail-copy'), 'detail copy');
  const image = requireUnique(main, (node) => node.tag === 'img', 'detail image');
  const name = requireUnique(copy, (node) => node.tag === 'h1', 'detail product name');
  const blurb = requireUnique(copy, (node) => node.tag === 'p', 'detail product blurb');
  const priceNode = requireUnique(
    copy,
    (node) => node.tag === 'span' && hasClass(node, 'price'),
    'detail product price',
  );
  const quantity = requireUnique(
    copy,
    (node) => node.tag === 'label' && hasClass(node, 'qty-row'),
    'detail quantity',
  );
  const quantityInput = requireUnique(
    quantity,
    (node) => node.tag === 'input',
    'detail quantity input',
  );
  return {
    ...common,
    content: {
      destination: main.attrs['data-benchmark-destination'] ?? '',
      product: {
        blurb: elementText(blurb),
        image: observedImage(image),
        name: elementText(name),
        price: elementText(priceNode),
        quantity: {
          label: elementText(quantity),
          minimum: quantityInput.attrs.min ?? '',
          type: quantityInput.attrs.type ?? 'text',
          value: quantityInput.attrs.value ?? '',
        },
      },
    },
  };
}

function observedImage(image) {
  return {
    alt: image.attrs.alt ?? '',
    height: image.attrs.height ?? '',
    loading: image.attrs.loading ?? '',
    src: image.attrs.src ?? '',
    width: image.attrs.width ?? '',
  };
}

function parseHtml(html) {
  const root = { attrs: Object.create(null), children: [], parent: null, tag: '#document' };
  const stack = [root];
  const lowerHtml = html.toLowerCase();
  let offset = 0;
  while (offset < html.length) {
    if (html[offset] !== '<') {
      const next = html.indexOf('<', offset);
      const end = next === -1 ? html.length : next;
      stack.at(-1).children.push(html.slice(offset, end));
      offset = end;
      continue;
    }
    if (html.startsWith('<!--', offset)) {
      const end = html.indexOf('-->', offset + 4);
      if (end === -1) throw new Error('matched document contained an unterminated HTML comment');
      offset = end + 3;
      continue;
    }
    if (html.startsWith('</', offset)) {
      const closing = parseClosingTag(html, offset);
      const current = stack.at(-1);
      if (stack.length === 1 || current.tag !== closing.tag) {
        throw new Error(
          `matched document closed ${closing.tag} while ${current.tag} was still open`,
        );
      }
      stack.pop();
      offset = closing.end;
      continue;
    }
    if (html.startsWith('<!', offset) || html.startsWith('<?', offset)) {
      const end = tagClose(html, offset + 2);
      if (end === -1) throw new Error('matched document contained an unterminated declaration');
      offset = end + 1;
      continue;
    }
    const opening = parseOpeningTag(html, offset);
    const parent = stack.at(-1);
    const node = { attrs: opening.attrs, children: [], parent, tag: opening.tag };
    parent.children.push(node);
    offset = opening.end;
    if (opening.selfClosing || isVoidElement(opening.tag)) continue;
    if (opening.tag === 'script' || opening.tag === 'style') {
      offset = rawElementEnd(html, lowerHtml, opening.tag, opening.end);
      continue;
    }
    stack.push(node);
  }
  if (stack.length !== 1) {
    throw new Error(`matched document ended with ${stack.at(-1).tag} still open`);
  }
  return root;
}

function parseOpeningTag(html, offset) {
  const head = /^<([a-z][a-z0-9:-]*)/iu.exec(html.slice(offset));
  if (!head) throw new Error(`matched document contained invalid markup at byte ${String(offset)}`);
  const close = tagClose(html, offset + head[0].length);
  if (close === -1) throw new Error(`matched document contained an unterminated ${head[1]} tag`);
  let attributeSource = html.slice(offset + head[0].length, close);
  const selfClosing = /\/\s*$/u.test(attributeSource);
  if (selfClosing) attributeSource = attributeSource.replace(/\/\s*$/u, '');
  return {
    attrs: parseAttributes(attributeSource),
    end: close + 1,
    selfClosing,
    tag: head[1].toLowerCase(),
  };
}

function parseClosingTag(html, offset) {
  const match = /^<\/([a-z][a-z0-9:-]*)\s*>/iu.exec(html.slice(offset));
  if (!match)
    throw new Error(`matched document contained an invalid closing tag at ${String(offset)}`);
  return { end: offset + match[0].length, tag: match[1].toLowerCase() };
}

function parseAttributes(source) {
  const attrs = Object.create(null);
  let offset = 0;
  while (offset < source.length) {
    while (/\s/u.test(source[offset] ?? '')) offset += 1;
    if (offset >= source.length) break;
    const nameMatch = /^[^\s"'=<>`/]+/u.exec(source.slice(offset));
    if (!nameMatch) throw new Error('matched document contained an invalid HTML attribute');
    const name = nameMatch[0].toLowerCase();
    offset += nameMatch[0].length;
    while (/\s/u.test(source[offset] ?? '')) offset += 1;
    let value = '';
    if (source[offset] === '=') {
      offset += 1;
      while (/\s/u.test(source[offset] ?? '')) offset += 1;
      const quote = source[offset];
      if (quote === '"' || quote === "'") {
        const end = source.indexOf(quote, offset + 1);
        if (end === -1) throw new Error(`matched document left ${name} unterminated`);
        value = source.slice(offset + 1, end);
        offset = end + 1;
      } else {
        const bare = /^[^\s"'=<>`]+/u.exec(source.slice(offset));
        if (!bare) throw new Error(`matched document omitted the value for ${name}`);
        value = bare[0];
        offset += bare[0].length;
      }
    }
    if (Object.hasOwn(attrs, name)) {
      throw new Error(`matched document repeated the ${name} attribute`);
    }
    attrs[name] = decodeHtmlEntities(value);
  }
  return attrs;
}

function tagClose(html, offset) {
  let quote = null;
  for (let index = offset; index < html.length; index += 1) {
    const character = html[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

function rawElementEnd(html, lowerHtml, tag, offset) {
  const start = lowerHtml.indexOf(`</${tag}`, offset);
  if (start === -1) throw new Error(`matched document left ${tag} open`);
  return parseClosingTag(html, start).end;
}

function findElements(scope, predicate) {
  const found = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (typeof child === 'string') continue;
      if (predicate(child)) found.push(child);
      if (child.tag !== 'script' && child.tag !== 'style' && child.tag !== 'template') visit(child);
    }
  };
  visit(scope);
  return found;
}

function requireUnique(scope, predicate, label) {
  const found = findElements(scope, predicate);
  if (found.length !== 1) {
    throw new Error(`${label} expected exactly once, received ${String(found.length)}`);
  }
  return found[0];
}

function containsNode(parent, sought) {
  if (parent === sought) return true;
  return findElements(parent, (node) => node === sought).length === 1;
}

function elementText(node) {
  let text = '';
  const visit = (current) => {
    for (const child of current.children) {
      if (typeof child === 'string') {
        text += decodeHtmlEntities(child);
      } else if (child.tag !== 'script' && child.tag !== 'style' && child.tag !== 'template') {
        visit(child);
      }
    }
  };
  visit(node);
  return text.replace(/\s+/gu, ' ').trim();
}

function decodeHtmlEntities(value) {
  return value.replace(
    /&(?:#(?<decimal>\d+)|#x(?<hex>[0-9a-f]+)|(?<named>amp|apos|gt|lt|nbsp|quot));/giu,
    (match, ...args) => {
      const groups = args.at(-1);
      if (groups.decimal !== undefined) return decodedCodePoint(Number(groups.decimal), match);
      if (groups.hex !== undefined) return decodedCodePoint(Number.parseInt(groups.hex, 16), match);
      return {
        amp: '&',
        apos: "'",
        gt: '>',
        lt: '<',
        nbsp: ' ',
        quot: '"',
      }[groups.named.toLowerCase()];
    },
  );
}

function decodedCodePoint(codePoint, original) {
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return original;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return original;
  return String.fromCodePoint(codePoint);
}

function hasAttribute(node, name) {
  return Object.hasOwn(node.attrs, name);
}

function hasClass(node, className) {
  return (node.attrs.class ?? '').split(/\s+/u).includes(className);
}

function isVoidElement(tag) {
  return VOID_ELEMENTS.has(tag);
}

function documentBytesAndText(body) {
  let bytes;
  if (typeof body === 'string') bytes = Buffer.from(body);
  else if (Buffer.isBuffer(body)) bytes = body;
  else if (ArrayBuffer.isView(body)) {
    bytes = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  } else {
    throw new TypeError('matched server document must be a string or byte buffer');
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `matched server document bytes must be within 1..${String(MAX_DOCUMENT_BYTES)}`,
    );
  }
  let html;
  try {
    html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('matched server document was not valid UTF-8');
  }
  if (html.includes('\0')) throw new Error('matched server document contained NUL');
  return { bytes, html };
}

function semanticTokens(value, path = '$', output = []) {
  if (Array.isArray(value)) {
    output.push(`${path}.length=${String(value.length)}`);
    for (let index = 0; index < value.length; index += 1) {
      semanticTokens(value[index], `${path}[${String(index)}]`, output);
    }
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value).sort())
      semanticTokens(value[key], `${path}.${key}`, output);
  } else {
    output.push(`${path}=${canonicalJson(value)}`);
  }
  return output;
}

function firstDifference(expected, actual, path = '$') {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return { actual, expected, path };
    if (expected.length !== actual.length) {
      return { actual: actual.length, expected: expected.length, path: `${path}.length` };
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(
        expected[index],
        actual[index],
        `${path}[${String(index)}]`,
      );
      if (difference !== null) return difference;
    }
    return null;
  }
  if (
    expected !== null &&
    actual !== null &&
    typeof expected === 'object' &&
    typeof actual === 'object'
  ) {
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (canonicalJson(expectedKeys) !== canonicalJson(actualKeys)) {
      return { actual: actualKeys, expected: expectedKeys, path: `${path}.[keys]` };
    }
    for (const key of expectedKeys) {
      const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (difference !== null) return difference;
    }
    return null;
  }
  return Object.is(expected, actual) ? null : { actual, expected, path };
}

function sourceIdentity() {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const files = Object.values(authoritativeFiles)
    .map((url) => {
      const bytes = readFileSync(url);
      return {
        bytes: bytes.byteLength,
        path: path.relative(root, fileURLToPath(url)).split(path.sep).join('/'),
        sha256: sha256(bytes),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    schema: MATCHED_SERVER_SEMANTIC_SOURCE_SCHEMA,
    sha256: sha256(canonicalJson(files)),
  };
}

function validateAuthoritativeData(matchedFixture, products) {
  if (matchedFixture?.schema !== 'kovo-benchmark-matched-fixture/v1') {
    throw new Error('matched server semantics require the v1 fixture schema');
  }
  if (!Array.isArray(products) || products.length !== matchedFixture.catalogItems) {
    throw new Error('matched server semantics require the declared catalog size');
  }
  const strings = [
    matchedFixture.brand,
    matchedFixture.listingHeading,
    matchedFixture.listingDescription,
    matchedFixture.l0?.cartDescription,
    matchedFixture.l0?.cartLabel,
    matchedFixture.l0?.cartText,
    matchedFixture.serverSemantic?.basePath,
    matchedFixture.serverSemantic?.lane,
    matchedFixture.serverSemantic?.detailProductSlug,
    matchedFixture.serverSemantic?.productsLabel,
    matchedFixture.serverSemantic?.viewLabelPrefix,
    matchedFixture.serverSemantic?.detailsLabel,
    matchedFixture.serverSemantic?.image?.width,
    matchedFixture.serverSemantic?.image?.height,
    matchedFixture.serverSemantic?.image?.listingLoading,
    matchedFixture.serverSemantic?.image?.detailLoading,
    ...Object.values(matchedFixture.serverSemantic?.quantity ?? {}),
  ];
  if (strings.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error('matched server semantic fixture contains an empty or non-string fact');
  }
  if (typeof matchedFixture.serverSemantic?.image?.alt !== 'string') {
    throw new Error('matched server semantic image alt fact must be a string');
  }
  const shell = matchedFixture.serverSemantic?.shell;
  if (
    shell === null ||
    typeof shell !== 'object' ||
    Object.values(shell).some((value) => {
      if (value !== null && typeof value === 'object') {
        return Object.values(value).some(
          (entry) => typeof entry !== 'string' || entry.length === 0,
        );
      }
      return typeof value !== 'string' || value.length === 0;
    })
  ) {
    throw new Error('matched server semantic shell facts are incomplete');
  }
  const ids = new Set();
  const slugs = new Set();
  for (const [index, product] of products.entries()) {
    if (
      product === null ||
      typeof product !== 'object' ||
      !Number.isFinite(product.price) ||
      ['id', 'slug', 'name', 'blurb', 'img'].some(
        (key) => typeof product[key] !== 'string' || product[key].length === 0,
      )
    ) {
      throw new Error(`matched catalog product ${String(index)} is malformed`);
    }
    if (ids.has(product.id) || slugs.has(product.slug)) {
      throw new Error(`matched catalog product ${String(index)} repeats identity`);
    }
    ids.add(product.id);
    slugs.add(product.slug);
  }
  if (!slugs.has(matchedFixture.serverSemantic.detailProductSlug)) {
    throw new Error('matched server detail product is absent from the catalog');
  }
}

function price(value) {
  return `$${value.toFixed(2)}`;
}

function assertRoute(route) {
  if (route !== 'listing' && route !== 'detail') {
    throw new TypeError('matched server semantic route must be listing or detail');
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

const RAW_HTML_SINKS = ['dangerouslySetInnerHTML', 'innerHTML', 'rawHtml', 'html'] as const;

describe('compiler raw HTML output-context payload matrix', () => {
  it('snapshots statically visible plain-string raw HTML rejections', () => {
    const cases = RAW_HTML_SINKS.map((sink) => {
      const result = compileComponentModule({
        fileName: `raw-html-${sink}.tsx`,
        source: `
export const RawHtml${sink.replaceAll(/[^A-Za-z0-9_$]/g, '')} = component({
  render: () => <article ${sink}={"<img src=x onerror=alert(1)>"} />,
});
`,
      });

      return {
        diagnostics: kv236Diagnostics(result),
        sink,
      };
    });

    // SPEC §1/§5.2: raw HTML output contexts require an explicit trusted escape hatch.
    expect(cases).toMatchInlineSnapshot(`
      [
        {
          "diagnostics": [
            {
              "code": "KV236",
              "message": "Unsafe output context requires an explicit trusted Kovo escape hatch. dangerouslySetInnerHTML receives a plain string; use Kovo TrustedHtml",
            },
          ],
          "sink": "dangerouslySetInnerHTML",
        },
        {
          "diagnostics": [
            {
              "code": "KV236",
              "message": "Unsafe output context requires an explicit trusted Kovo escape hatch. innerHTML receives a plain string; use Kovo TrustedHtml",
            },
          ],
          "sink": "innerHTML",
        },
        {
          "diagnostics": [
            {
              "code": "KV236",
              "message": "Unsafe output context requires an explicit trusted Kovo escape hatch. rawHtml receives a plain string; use Kovo TrustedHtml",
            },
          ],
          "sink": "rawHtml",
        },
        {
          "diagnostics": [
            {
              "code": "KV236",
              "message": "Unsafe output context requires an explicit trusted Kovo escape hatch. html receives a plain string; use Kovo TrustedHtml",
            },
          ],
          "sink": "html",
        },
      ]
    `);
  });

  it('snapshots explicit Kovo and Browser TrustedHTML-compatible acceptance', () => {
    const result = compileComponentModule({
      fileName: 'trusted-raw-html.tsx',
      source: `
import { trustedHtml } from '@kovojs/runtime';

const browserTrustedHtml = {
  [Symbol.toStringTag]: "TrustedHTML",
  toString: () => "<i>browser trusted</i>",
};

export const TrustedRawHtml = component({
  render: () => (
    <section>
      <article dangerouslySetInnerHTML={trustedHtml("<b>kovo trusted</b>")} />
      <article innerHTML={trustedHtml(browserTrustedHtml)} />
      <article rawHtml={trustedHtml("<em>raw helper</em>")} />
      <article html={trustedHtml({
        [Symbol.toStringTag]: "TrustedHTML",
        toString: () => "<strong>compatible</strong>",
      })} />
    </section>
  ),
});
`,
    });

    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    // SPEC §1/§5.2: explicit TrustedHtml values document the unsafe output-context escape hatch.
    expect({
      diagnostics: kv236Diagnostics(result),
      serverSource: normalizeArtifact(serverSource),
    }).toMatchInlineSnapshot(`
      {
        "diagnostics": [],
        "serverSource": "// @kovojs-ir
      export function renderSource() {
        return \`
      import { trustedHtml } from '@kovojs/runtime';

      const browserTrustedHtml = {
        [Symbol.toStringTag]: "TrustedHTML",
        toString: () => "<i>browser trusted</i>",
      };

      export const TrustedRawHtml = component({
        render: () => (
          <section kovo-c="trusted-raw-html">
            <article dangerouslySetInnerHTML={trustedHtml("<b>kovo trusted</b>")} />
            <article innerHTML={trustedHtml(browserTrustedHtml)} />
            <article rawHtml={trustedHtml("<em>raw helper</em>")} />
            <article html={trustedHtml({
              [Symbol.toStringTag]: "TrustedHTML",
              toString: () => "<strong>compatible</strong>",
            })} />
          </section>
        ),
      });
      TrustedRawHtml.name = "trusted-raw-html/trusted-raw-html";
      \`;
      }",
      }
    `);
    expect(() => assertFixpoint(result)).not.toThrow();
  });
});

function kv236Diagnostics(result: ReturnType<typeof compileComponentModule>) {
  return result.diagnostics
    .filter((diagnostic) => diagnostic.code === 'KV236')
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
    }));
}

function normalizeArtifact(source: string): string {
  return source.replaceAll(/\?v=[0-9a-f]{8}/g, '?v=HASH').trim();
}

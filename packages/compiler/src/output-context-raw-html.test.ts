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
import { trustedHtml } from '@kovojs/browser';

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
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    // SPEC §1/§5.2: explicit TrustedHtml values document the unsafe output-context escape hatch.
    expect({
      diagnostics: kv236Diagnostics(result),
      outputContextFacts: result.outputContextFacts.filter(
        (fact) => fact.context === 'trusted-html',
      ),
      serverSource: normalizeArtifact(serverSource),
    }).toMatchInlineSnapshot(`
      {
        "diagnostics": [],
        "outputContextFacts": [
          {
            "context": "trusted-html",
            "expression": "trustedHtml("<b>kovo trusted</b>")",
            "sink": "dangerouslySetInnerHTML",
            "source": "server-render",
            "writer": "trusted raw HTML attribute",
          },
          {
            "context": "trusted-html",
            "expression": "trustedHtml(browserTrustedHtml)",
            "sink": "innerHTML",
            "source": "server-render",
            "writer": "trusted raw HTML attribute",
          },
          {
            "context": "trusted-html",
            "expression": "trustedHtml("<em>raw helper</em>")",
            "sink": "rawHtml",
            "source": "server-render",
            "writer": "trusted raw HTML attribute",
          },
          {
            "context": "trusted-html",
            "expression": "trustedHtml({
              [Symbol.toStringTag]: "TrustedHTML",
              toString: () => "<strong>compatible</strong>",
            })",
            "sink": "html",
            "source": "server-render",
            "writer": "trusted raw HTML attribute",
          },
        ],
        "serverSource": "// @kovojs-ir
      export function renderSource() {
        return \`
      import { trustedHtml } from '@kovojs/browser';

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
    expect(clientSource).not.toContain('innerHTML');
    expect(clientSource).not.toContain('rawHtml');
    expect(clientSource).not.toContain('dangerouslySetInnerHTML');
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
  return source.replaceAll(/\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\//g, '/c/__v/HASH/').trim();
}

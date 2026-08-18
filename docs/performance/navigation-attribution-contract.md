# Matched-navigation attribution contract

## Decision

The matched L1 browser benchmark reports a directly observed combined
`responseProcessingDomApply` interval. Its start is the selected navigation response's Chrome
`ResourceReceiveResponse` response-headers timestamp. Its end is the destination marker emitted by
the harness's `MutationObserver`. Both boundaries use Chromium's monotonic trace clock.

The combined interval includes streaming delivery and consumption, response read/decode,
document construction or morphing, and main-thread queueing. It overlaps the separately reported
transfer, parser, style, and layout rows. The rows are evidence, not an additive waterfall.

Exact `responseReadDecode` and `domMorphApply` values remain `unsupported`, never zero. Chromium
does not expose stable start/end events for either operation across both entrants, and subtracting
named trace work from a larger interval would only manufacture a label for the residual.

## Why this is the common boundary

The two current matched entrants take different navigation paths:

- Kovo fetches `application/vnd.kovo.document-parts+json` and applies the structured document
  parts through its enhanced-navigation runtime.
- Next.js currently follows the fixture's plain anchor as a document request and parses
  `text/html`. Its L1 capability is real client cart state, but that does not make this navigation
  an RSC transition. The selector also recognizes a future `text/x-component` click-window
  response, but it will not call one observed until Chrome and Playwright authenticate it.

Both produce Chrome Resource trace events and both eventually mutate the same benchmark destination
marker into the DOM. Their internal decode and apply functions are not a shared API surface. Adding
framework-owned marks would time different implementation boundaries; wrapping `fetch`, stream
readers, or DOM prototype methods would be incomplete and would add framework-sensitive work to the
measured path. The harness therefore observes the narrowest complete interval that both browsers
and entrants expose without changing production runtime code.

Chrome's relevant evidence is:

| Fact                               | Trace source                                                      |
| ---------------------------------- | ----------------------------------------------------------------- |
| Request identity/window            | `Network.requestWillBeSent` + `ResourceSendRequest`               |
| Request start and response headers | `ResourceReceiveResponse.args.data.timing`                        |
| Response completion                | `ResourceFinish.args.data.finishTime`                             |
| Destination DOM ready              | harness `TimeStamp` emitted by the destination `MutationObserver` |
| Style, layout, paint               | named DevTools timeline events                                    |

The `ResourceSendRequest.ts` event is not used as the precise request-start clock. In a real Next.js
document navigation Chromium emitted it after the response timing's request start; the associated
`ResourceReceiveResponse.args.data.timing.requestTime + sendStart` is the trace-native boundary.
Likewise, `ResourceFinish.ts` is not used as the response-completion clock. Chromium can dispatch
that event after the bytes finished; `args.data.finishTime` is the actual monotonic completion
timestamp.

## Authentication and failure posture

The `kovo-navigation-attribution/v3` record selects a complete Chrome
`ResourceSendRequest`/`ResourceReceiveResponse`/`ResourceFinish` triplet inside the click-to-paint
window, bound to the clicked destination path and the CDP-authenticated top-level frame. Chrome's
timeline event does not expose `loaderId`, so the contract joins the identical request id, URL, and
method to `Network.requestWillBeSent` and retains that event's frame, loader, and initiator facts; a
missing, redirected/duplicate, or divergent join fails closed. It then
requires exactly one Playwright request record from that same top-level frame with the same URL,
method, status, media type, response class, and navigation-request posture. The two observations'
request start, response start, and response end clocks must agree within 25 ms. More than one
eligible destination triplet, a Playwright candidate with no complete trace triplet, a subframe or
service-worker candidate, a failed trace request, an invalid event order, a response whose
`ResourceFinish.finishTime` falls after destination paint, or excess clock skew aborts the sample.

The serialized evidence retains:

- the trace request id and monotonic request/response timestamps;
- the exact destination path, top-level frame id, loader id, and bounded initiator classification;
- a SHA-256 identity for the matching Playwright request facts;
- the maximum observed clock-bridge skew and its fixed tolerance;
- the exact trace category string and event census;
- every observed or unsupported phase verdict; and
- a canonical SHA-256 digest over the complete attribution record.

The digest is tamper evidence within the comparison's source and execution provenance. It is not an
independent claim that a self-hash proves the browser produced the evidence.

The publication gate therefore rechecks every raw matched-L1 navigation sample in all five
baseline reports and the independent holdout. Kovo must have an observed
`application/vnd.kovo.document-parts+json` primary response and
`navDocumentReplaced === 0`; Next must have an observed `text/html` primary response authenticated
as a document navigation and `navDocumentReplaced === 1`. “Authenticated” here means the raw sample
passes the same v3 attribution validator as the benchmark harness: the attribution digest,
top-level trace response, Playwright network-witness digest, request/timing identity, trace event
census, clock boundary, and phase contract must all agree. A self-asserted media type, resource
type, or navigation flag is insufficient. The gate also reads every raw cold sample to prove Kovo's
default/matched-L0 zero-script and zero-JavaScript-byte posture and the script-bearing posture of
the other lanes. These facts are not inferred from aggregate medians or a resealed report.

## Interpretation

Use `responseProcessingDomApply` to compare the common response-to-ready envelope. Use the named
style, layout, and paint rows to locate browser work inside and after that envelope. Do not add the
rows together, and do not describe the combined duration as decode time or morph time. The
publication renders that warning beside each of its three explicit browser-lane tables.

If Chromium later provides stable cross-framework decode or DOM-apply boundaries, the schema must
change again and the baseline must be recollected. Existing v2 reports predate the top-level-frame
and response-finish closure; they must not be published as v3 or retrofitted with derived phase
labels.

## Current v3 fixture smoke

A clean committed smoke at `03ab9174d01c3ea6b45e122822c02e32db6867f5` exercised one desktop
and one mobile matched-L1 navigation for both entrants. All four v3 records were observed and both
adapter integrity verdicts were complete. Kovo selected one top-level document-parts fetch in each
cell; Next selected one top-level document response. All four authenticated response completions
preceded destination paint, and the largest Playwright/trace clock skew was 1.192 ms.

```sh
node benchmarks/run-all.mjs --apps kovo,nextjs --lane matched-l1 --iterations 1 --warmups 0 \
  --bfcache-iterations 1 --skip-lighthouse --skip-build --port-base 23050 \
  --out-dir /tmp/kovo-nav-v3-clean.uDX16K
```

The exact `results.json` SHA-256 was
`38c148db2702c1bf6bad4f12ad277a15406444477d5138f7d6426555034d1b5f`. This is a contract smoke,
not one of the repeated publication baselines.

## Superseded v2 fixture smoke

On 2026-08-14, a production-build smoke ran one desktop and one mobile matched-L1 sample for each
entrant with Lighthouse disabled. All four v2 navigation attribution records validated, and both
app adapter integrity verdicts were complete. This is diagnostic history only: it did not retain
the v3 frame, loader, initiator, or response-finish closure and cannot ratify a v3 publication.

- Kovo selected exactly one `application/vnd.kovo.document-parts+json` fetch trace triplet. The
  Playwright/trace maximum clock skew was 0.615 ms on desktop and 2.130 ms on mobile.
- Next.js selected exactly one `text/html` document trace triplet. The maximum clock skew was
  0.868 ms on desktop and 0.297 ms on mobile.

The smoke also exposed a Chromium field-shape detail now covered by a regression test: for the
Next.js document navigation, `ResourceSendRequest.ts` was dispatched after the timing structure's
request start. The v2 contract therefore authenticates identity with `ResourceSendRequest` but
uses `ResourceReceiveResponse.args.data.timing.requestTime + sendStart` for the request-start
clock.

The proving command was:

```sh
node benchmarks/run-all.mjs --apps kovo,nextjs --lane matched-l1 --iterations 1 --warmups 0 \
  --bfcache-iterations 1 --skip-lighthouse --skip-build --port-base 53600 \
  --out-dir /tmp/kovo-nav-attribution.y1ykZz
```

The diagnostic `results.json` SHA-256 was
`eab8200041b0ad2aa6bde637f6065573e455fa512076106b5253406232ce5d3a`. The run was deliberately
dirty while validating this harness change, so it is smoke evidence, not a publishable performance
baseline.

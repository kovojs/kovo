# Live Transport Security Checklist

Use this checklist before implementing any SSE, EventSource, WebSocket, or other live channel.
Kovo does not currently ship such a channel; this rule is a pre-implementation gate for future work.

- [ ] The subscription request has the same same-origin and CSRF posture as browser mutation
      traffic unless it is a non-browser endpoint with an explicit verifier.
- [ ] Channel identifiers are server-minted and bound to the active principal or anonymous
      framework-owned credential; they are never raw user ids, session ids, or client-chosen keys.
- [ ] Subscribe-time authorization and every pushed event run guard checks for the exact domain,
      key, and principal that will receive the payload.
- [ ] Every event carries the active build token, and the browser drops events whose token is
      missing or mismatched before applying fragments, query values, or text.
- [ ] Responses and event streams use `Cache-Control: private, no-store`, `Vary: Cookie`, and a
      same-origin CORS posture unless an audited non-browser verifier owns the channel.
- [ ] Backpressure, retry, reconnect, and replay behavior have byte/rate caps and cannot replay
      one principal's event to another principal.
- [ ] `kovo explain --endpoints` or its successor reports the live surface, auth scheme, cache
      posture, channel binding, and write/read domains before release.

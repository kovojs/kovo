# S7 webhook spike decision gate

Status: proven by `conformance/webhook-spike/src/index.test.ts`.

This is a spike artifact, not the `webhook()` primitive implementation. It models the fixed lifecycle from SPEC §9.1 against a recorded Stripe-format fixture:

1. Capture the request body once as raw bytes.
2. Verify `stripe-signature` over those exact bytes with a local Stripe recipe built from `hmacSignature()`.
3. Parse the provider payload loosely only after verification.
4. Construct replay identity from the authenticated provider event id and occurrence time, then reserve it in the existing Kovo-Idem-shaped store.
5. Run the handler in a transaction-shaped context.
6. Emit the unified change record after commit.
7. Commit the authenticated provider-event response so exact redelivery replays without re-running the handler.

## Decisions

- Raw-body capture belongs at the server shell boundary that dispatches `endpoint()`/future `webhook()` requests. It should expose one byte buffer to verifier and parser instead of calling `request.json()`/`request.text()` separately. The spike asserts one `arrayBuffer()` read, verifies a prettified JSON body with the original signature is rejected, and parses from the same captured bytes.
- The provider replay scope should be machine scoped, not session scoped. The implemented primitive pairs that scope with the opaque `webhookReplayIdentity(event.id, event.created * 1000)` carrier: occurrence comes from the signed event payload, and the store receives the framework-derived 30-day expiry rather than inventing a receipt-time TTL. This historical spike predates that carrier and reuses `createMemoryMutationReplayStore()` only as a transaction-shape proof.
- Replay reservation happens after verification and loose parse because SPEC §9.1 derives `webhookReplayIdentity(...)` from authenticated `idempotency(input)`. Redelivery still verifies current request authenticity but does not re-enter the transaction/handler once a response is stored.
- The local verifier recipe owns Stripe timestamp tolerance, raw-byte HMAC payload construction, and rotated-secret `v1` parsing while `hmacSignature()` provides constant-time HMAC verification. The spike covers tamper rejection, stale timestamp rejection, and multiple `v1` signatures with rotated secrets.
- The transaction boundary is `BEGIN` before domain writes, `COMMIT` before change-record publication. The spike records the write and only appends `{ domain, keys, input }` after commit.

## Caveats

- This does not add the `webhook()` API, compiler extraction, `kovo explain endpoint <name>` detail output, or static KV330 enforcement.
- The raw-body proof is bounded to a single in-memory byte capture. It rules out accidental double consumption/re-serialization for webhook dispatch, but it is not a streaming HMAC implementation.
- The test uses an in-memory replay store. Production uses the same reserve/commit semantics with durable uniqueness on `(scope, event_id)`, exact occurrence/expiry matching for live rows, never-expiring pending truth, and committed retirement only at the authenticated 30-day horizon.

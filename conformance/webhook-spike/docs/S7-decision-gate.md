# S7 webhook spike decision gate

Status: proven by `conformance/webhook-spike/src/index.test.ts`.

This is a spike artifact, not the `webhook()` primitive implementation. It models the fixed lifecycle from SPEC §9.1 against a recorded Stripe-format fixture:

1. Capture the request body once as raw bytes.
2. Verify `stripe-signature` over those exact bytes with `stripeSignature()`.
3. Parse the provider payload loosely only after verification.
4. Look up replay by provider event id in the existing FW-Idem store.
5. Run the handler in a transaction-shaped context.
6. Emit the unified change record after commit.
7. Commit the provider event id response so redelivery replays without re-running the handler.

## Decisions

- Raw-body capture belongs at the server shell boundary that dispatches `endpoint()`/future `webhook()` requests. It should expose one byte buffer to verifier and parser instead of calling `request.json()`/`request.text()` separately. The spike asserts one `arrayBuffer()` read, verifies a prettified JSON body with the original signature is rejected, and parses from the same captured bytes.
- The provider replay scope should be machine scoped, not session scoped. For Stripe this spike uses `webhook:stripe` plus `event.id`, reusing `createMemoryMutationReplayStore()` shape without a browser session or CSRF token.
- Replay lookup happens after verification and loose parse because SPEC §9.1 defines idempotency as `idempotency(input)`. Redelivery still verifies current request authenticity but does not re-enter the transaction/handler once a response is stored.
- The verifier preset remains the source of Stripe timestamp tolerance, raw-byte HMAC payload construction, constant-time comparison, and rotated-secret handling. The spike covers tamper rejection, stale timestamp rejection, and multiple `v1` signatures with rotated secrets.
- The transaction boundary is `BEGIN` before domain writes, `COMMIT` before change-record publication. The spike records the write and only appends `{ domain, keys, input }` after commit.

## Caveats

- This does not add the `webhook()` API, compiler extraction, `fw explain endpoint <name>` detail output, or static FW330 enforcement.
- The raw-body proof is bounded to a single in-memory byte capture. It rules out accidental double consumption/re-serialization for webhook dispatch, but it is not a streaming HMAC implementation.
- The test uses an in-memory replay store. A production provider-event store should use the same reserve/commit semantics with a durable unique key on `(scope, event_id)`.

# Plan 2 Phase 0 security architecture decisions — 2026-07-19

Status: ACCEPTED for implementation sequencing at baseline `635fbea78`. This record chooses the
enforcement shape and its non-claims. It is not normative by itself: each shipping phase must land
the corresponding `SPEC.md` text, tests, gates, and public-surface review before relying on a
decision as framework behavior.

## Decisions

### Cache influence: finite static proof, runtime narrowing only

Kovo will derive one `kovo-cache-influence/v1` manifest. URL path and search are explicit cache-key
axes; named request headers may derive `Vary`; cookies, Authorization, principal/session facts,
secrets, framework state, opaque calls, and unclassified influences close shared caching. Declared
external data versions must have a manifest-visible cache-key contribution or also close shared
caching. Runtime provenance may strip or reject `public` for the current response but may never
widen a compile-time closed verdict. One observed execution is not a generality proof.

This favors false-private responses over cross-principal cache disclosure. An audited escape may
state a retained obligation, but it does not become derived evidence.

### ScopedKey: opaque witnessed frame with capability-owned sharing

The accepted representation is the shipped `kovo-scoped-key-v1` runtime-opaque value: a
module-private witness plus injective, bounded, length-framed bytes. Principal scope comes only from
the active framework request/task authority. Deliberate sharing uses the explicit
`publicScopedKey` capability; framework system sharing uses a finite internal posture registry.
There is no public structural brand, `Symbol.for()` witness, caller-supplied principal, or prose
`reason` that can mint authority. Stateful sinks validate the witness before namespace use.

This prevents accidental/cast construction; it does not isolate deliberately malicious same-process
app code from the framework process, which remains outside SPEC §6.6's app-level proof.

### Crypto authority: closed purposes, HKDF-SHA256, and opaque least-operation handles

Kovo will treat direct secret-crypto acquisition as raw authority. The module-closure vocabulary
separates `crypto-acquisition` from low-privilege, non-keyed `digest`: a namespace/default crypto
import, WebCrypto/global crypto access, entropy, keyed hashing, password hashing, signing, or
encryption is `crypto-acquisition`; only an exact named non-keyed digest import is `digest`. A
repository ratchet records every temporary direct acquisition by exact source path and operation and
may shrink without review. Adding or widening a row is an explicit security-architecture change,
not an ordinary census refresh.

The server realm will have one boot-pinned `crypto-authority.ts` primitive owner with known-answer
tests for HKDF-SHA256, HMAC-SHA256, fixed-width comparison, and AES-256-GCM. Callers receive only
framework-witnessed, purpose-minimal handles (for example CSRF sign/verify, capability sign/verify,
Better Auth bucket PRF, rendered-HTML validation, or confidential-at-rest seal/open), never a
generic signer, sealer, primitive table, or raw derived key. The environment-neutral webhook
verifier retains its WebCrypto implementation in the core realm, but routes it through the same
least-operation rule: a verify-only handle owns imported provider material and public verifier
metadata never contains the secret. This is a runtime authority boundary, not a type-brand proof.

The compatibility suite is fixed for v1: SHA-256 for unkeyed digests, RFC 5869 HKDF-SHA256 for
framework key derivation, HMAC-SHA256 for symmetric signatures/PRFs, and AES-256-GCM with a 96-bit
random IV and 128-bit tag for confidential-at-rest data. Derivation info is the SHA-256 commitment
of the injective, length-framed tuple `(registry-version, purpose, audience, algorithm)` under the
public `kovo-crypto-authority-v1` salt. The fixed-width commitment avoids provider-specific HKDF
info limits without truncating any bounded audience bytes. Purpose is selected only by a checked-in
`kovo-crypto-purpose-registry/v1` row; each row fixes its algorithm, operations, root source, and
audience grammar. There is no public string-selected derivation API or compatibility fallback.
Provider-owned webhook signatures are verified with the provider's raw protocol key and therefore
are not silently re-derived into a different wire protocol.

Signing and at-rest roots share one declarative active/previous/revoked lifecycle. Exactly one key
is active. A previous key requires a finite `acceptUntil` and verifies/opens only before that
framework-clock deadline; a revoked key carries no usable secret. New signatures and ciphertexts
always use the active key. On expiry/revocation Kovo overwrites authority-owned Buffer copies on a
best-effort basis. This is memory hygiene only: caller strings/buffers, engine/native copies,
allocator snapshots, crash dumps, and already-created crypto objects are not proven zeroized.

### Principal epoch: persistent monotone source, current-at-verify or closed

The authoritative source is a persistent per-principal epoch in the selected identity provider or
auth store, independent of any session. Password, role, tenant, administrative, provider-revocation,
and deletion events monotonically advance or tombstone it. Kovo-owned privilege changes update it
transactionally; external providers must expose an adapter freshness contract.

Credential-derived mint doors embed the epoch. A verifier must obtain a current framework-witnessed
epoch; the default is an authoritative lookup with no positive application cache. An adapter may
declare a finite maximum-age only when it also supplies monotone invalidation, and an expired,
missing, contradictory, unavailable, or tombstoned witness fails closed. The eventual SPEC must
state the resulting maximum revocation staleness and latency/availability budget; expiry remains a
second floor, not freshness proof.

### Async context: separate least-authority cells, one confinement contract

Kovo will not merge every `AsyncLocalStorage` payload into one ambient authority bag. It will retain
separate typed, least-authority cells while making them all use one framework-owned confinement
contract: exact cell identity, request/task generation witness, fail-closed missing/foreign/stale
store handling, one lifecycle close, and no ambient fallback. Cross-cell consumers must prove the
same lifecycle identity instead of assuming independently present stores belong to one request.

This reduces authority aggregation and migration blast radius while still giving the census and
non-interference oracle one mechanical contract to enforce.

### Deadlines: hard admission and discard, cooperative owned-effect cancellation

Request limits will impose finite `deadlineMs` and `maxInFlight` defaults and ceilings. Occupancy
admission, deadline expiry, post-deadline response discard, slot release, and bounded write-out are
hard framework doors. Kovo-owned egress, DB/transaction, deferred-region, and streaming effects must
consume the framework `AbortSignal` and cooperate with cancellation.

Kovo does not claim that an `AbortSignal` terminates arbitrary promises, synchronous loops, native
extensions, or an already committed transaction. A future hard execution guarantee would require a
terminable worker/process boundary. Long-lived streaming needs a named, bounded, explain-visible
posture rather than `false` or an infinite deadline.

### Cross-origin isolation: conservative default, explicit derived posture

The default remains the current conservative COOP posture and does not claim cross-origin
isolation. An explicit `crossOriginIsolation` posture is accepted only when the compiler-derived
browser manifest closes static assets, dynamic fetches, workers, frames, popups, and every required
CORP/CORS relationship. Missing, opaque, or contradictory evidence is a build error; headers are
assembled only from that manifest and must match it byte-for-byte.

OAuth, embed, popup, and third-party asset use are negative compatibility fixtures. Kovo will not
silently weaken isolation headers to preserve an incompatible flow.

### Deployed attestation: externally pinned deployment key, bounded single-instance claim

Posture attestation uses a purpose-bound key associated with the reviewed deployment identity and
an out-of-band pinned public-key fingerprint. The build contributes the deterministic artifact
subject and posture digest; the runtime signs the caller nonce, artifact subject, instance identity,
boot-witness results, posture digest, event-chain head, and bounded issuance/expiry times. The CLI
must be given the expected artifact subject and trust-anchor fingerprint. Learning the key from the
challenged endpoint is `UNBOUND`, not verification.

A valid response establishes only that one key-holding responding instance reported the reviewed
posture at that time. It does not prove executed-code identity, host integrity, complete telemetry,
or fleet-wide equality. Those require an external deployment/remote-attestation trust system and
remain retained obligations.

## Sequencing consequences

Train B may build the shared ALS contract before deadlines. Train C may implement cache influence,
epochs, deadlines, and optional isolation against the decisions above. The attestation endpoint
remains blocked on reproducible artifact subjects and the purpose-bound crypto door. Any
implementation that needs a different authority source, widening direction, or trust root must
amend this record and the active plan before production code changes.

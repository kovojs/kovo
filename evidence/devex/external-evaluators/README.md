# External evaluator release evidence

This directory is the preregistration point for the world-class DevEx capstone. It is deliberately
incomplete: `policy.json` does not exist until three real evaluators are registered. Signed
transcripts are never committed here because Kovo's packed CLI embeds the source Git commit. A
committed exact-HEAD transcript would therefore create an impossible cryptographic self-reference.
Missing policy or transcript input is a release failure, never an empty success.

The machine contract lives in `scripts/external-evaluator-evidence.mjs`. It fixes the sample at
exactly three distinct non-author humans or agents and requires all three to exercise one identical,
authenticated packed package set:

1. scaffold;
2. install;
3. dev ready;
4. first HTTP 200;
5. login;
6. create/read/update/delete;
7. edit source;
8. observe the expected failing check;
9. fix that diagnostic;
10. observe the passing check;
11. test; and
12. build.

Each transcript records bounded structured actions and observations, not raw terminal output or
credentials.

## Collection order

The roster is immutable Git policy; the exact-release transcripts are signed external input.

1. Create `policy.json` with the code-owned contract digest and exactly three concrete evaluator
   identities and Ed25519 public keys.
2. Commit that file alone as a non-root, single-parent commit `P`. The changed-path set for `P`
   must be exactly `evidence/devex/external-evaluators/policy.json`. Later edits invalidate the
   roster.
3. Build the final release candidate commit `R` with `pnpm run check:publish`. `P` must be a strict
   ancestor of `R`.
4. Give every evaluator the same `R`, packed manifest, and tarball directory. Framework authors may
   not guide or rescue the journey.
5. Each evaluator records the exact `R` source commit, packed-manifest SHA-256, sorted
   `(name, version, sha512)` package set, and package-set digest. Each signs the canonical transcript
   payload returned by `externalEvaluatorTranscriptPayload()` with the private key registered at
   `P`.
6. Triage every finding to an exact ID, owner, and state from
   `scripts/known-failure-register.json`. A major finding or reproduction of a retired failure is
   always release-blocking.
7. Assemble the three transcripts and their shared subject into one evidence JSON object. Keep it
   at or below 32 KiB, encode the exact bytes as canonical base64, and provide that string in the
   required `external_evaluator_evidence_base64` release-dispatch input. The encoded form is capped
   at 48 KiB.
8. Release within 14 days. The release job rebuilds exact `R`, authenticates every current tarball,
   materializes the input under ignored `.release/`, and requires the evidence subject to equal
   current `HEAD`, manifest bytes, and package set. A successful run archives the verified evidence
   for audit.

If the roster needs correction, add a new versioned policy/contract rather than rewriting history
and pretending the evaluator was preregistered. If code changes after evaluation, collect fresh
signatures against the new exact release candidate.

## Verification

For a local rehearsal, put the evidence JSON at
`.release/devex/external-evaluators/transcripts.json` after `pnpm run check:publish`, then run:

```sh
pnpm run check:external-evaluator-evidence
```

The release workflow instead supplies the same bytes through
`KOVO_EXTERNAL_EVALUATOR_EVIDENCE_BASE64`. The command fails for absent or placeholder records,
duplicate principals or keys, unsigned or forged changes, a non-policy-only registration commit,
post-registration policy edits, stale timestamps, mixed source/manifest/package subjects,
incomplete steps, unlinked findings, dirty release checkouts, and any release-blocking outcome.

Git proves the policy's commit ordering, path-only introduction, and byte immutability. It does not
prove wall-clock time: `registeredAt` is reviewed chronology metadata and signature timing, not a
claim that Git authenticated a timestamp. Human review establishes that the registered principals
are genuinely independent. Signatures prove only that each reviewed key holder signed the exact
transcript. Current tarball re-authentication and exact-HEAD binding keep that limited claim honest,
consistent with `SPEC.md` §1.3, §2, §5.2, and §6.6.

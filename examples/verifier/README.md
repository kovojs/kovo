# Standalone certificate verifier

This example embeds `@kovojs/verify` in a release review tool. Use the `kovo-verify`
command for ordinary checks; it adds bounded, no-follow reads and stable JSON or
human output around the same verifier.

Copy `check-release.mjs` into a project that has the packed `@kovojs/verify`
package installed, then run:

```sh
node check-release.mjs \
  ./kovo-certificate-v1.json \
  ./kovo-certificate-policy-v1.json \
  ./unpacked-packages
```

The policy must arrive through an independently authenticated channel. Copying
the policy, certificate, and artifacts from one mutable location does not prove
independent review (SPEC §6.6).

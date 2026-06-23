---
title: Integration testing
description: How Kovo's framework-owned integration harness proves app behavior without making browser tests the default app workflow.
order: 4
---

# Integration testing

The public app workflow starts with typechecking, `kovo check`, graph assertions, and HTTP-level
tests. Browser tests still matter for framework behavior that only a browser owns: morph survival,
focus, caret, scroll, view transitions, and native platform details. The source note is
[`docs/integration-testing.md`](https://github.com/kovojs/kovo/blob/main/docs/integration-testing.md).

## What the integration harness proves

The framework integration suite compiles fixture apps, starts the app shell, drives real requests, and
asserts that generated graphs, mutation responses, and browser behavior agree. It covers the
framework contract so app authors do not need to rebuild a SPA-style browser test pyramid for wiring
Kovo already proves statically.

## What app tests should usually do

Use [Testing with @kovojs/test](/guides/testing/) to:

- Execute mutations as functions and assert typed success/failure output.
- Run data-layer tests against PGlite or the supported SQLite harness.
- Verify observed database writes are covered by static or declared touch sets.
- Property-test optimistic transforms when the client predicts a query shape.

Reach for browser tests when your app adds browser-owned behavior that Kovo cannot statically prove.

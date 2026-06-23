---
title: Evidence & design notes
description: Curated design notes and verification references that sit below the guides and above the raw repo ledgers.
order: 1
---

# Evidence & design notes

The guides teach the public workflow. The specification decides normative behavior. This section
keeps the important supporting notes discoverable: design evidence, portability notes, integration
testing references, and worked examples that are too detailed for the main guide flow.

Use these pages when you need the "why this is shaped this way" layer behind a guide:

- [Data-layer dialects](/evidence/data-layer-dialects/) - supported Drizzle dialects and SQLite caveats.
- [Static export](/evidence/static-export/) - what static export can and cannot replay.
- [Integration testing](/evidence/integration-testing/) - the framework-owned browser/integration harness.
- [Worked add-to-cart](/evidence/worked-add-to-cart/) - an end-to-end mutation/invalidation example.
- [Risk register](/evidence/risk-register/) - active design risks and the mitigations attached to them.

The source notes remain in `docs/` in the repository. These pages are the public index and summary so
the site corpus, search index, and `llms-full.txt` can point developers at them.

# create-kovo

Starter generator for Kovo apps. It writes the application skeleton, package
scripts, local agent docs, and the first runnable app.

```sh
pnpm dlx create-kovo my-app
cd my-app
pnpm install
pnpm run check
```

```sh
pnpm create kovo my-app -- --disable-git
```

Clone one of the two advanced examples when you want a task-shaped starting
point instead of the default contact-book scaffold:

```sh
pnpm dlx create-kovo sales-app --example crm
pnpm dlx create-kovo shop --example commerce
```

For agents and CI, the same semantic command schema has a deterministic,
non-interactive path:

```sh
pnpm dlx create-kovo sales-app --example crm --yes --no-git --no-install
```

Only `crm` and `commerce` are accepted—there are no aliases or arbitrary source
paths. The release tarball contains an integrity-bound allowlist of their
tracked authored sources; repository-only scripts, scratch files, secrets, and
test seams are not copied.

## Reference

- API: `/api/create-kovo/`
- Guides: `/getting-started/installation/`, `/getting-started/project-structure/`

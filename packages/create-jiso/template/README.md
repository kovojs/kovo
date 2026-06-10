# Jiso Starter

This starter uses Vite+ as the single project entrypoint:

```sh
vp check
vp test
vp run build
vp run fw-check
```

Tailwind is the default app styling path. Keep class names in templates as static strings so the generated CSS contains every class that can appear in SSR pages, mutation fragments, and deferred streams. Safelist classes explicitly in `src/styles.css` when a fragment must emit a class that cannot be discovered statically.

Graph intent checks should be ordinary set assertions over stable `fw explain` output, per SPEC.md section 11.4.3. For example, assert that every component displaying cart data is a cart query consumer and that `cart/add` invalidates that query:

```sh
mkdir -p .jiso
fw explain query cart graph.json > .jiso/cart.query.txt
awk -F': ' '/^consumers: / { print $2 }' .jiso/cart.query.txt | tr ',' '\n' | grep '^component:' | sort > .jiso/cart.consumers.txt
printf '%s\n' component:CartBadge component:CartPanel | sort > .jiso/cart.expected-consumers.txt
diff -u .jiso/cart.expected-consumers.txt .jiso/cart.consumers.txt
grep '^invalidated-by: .*cart.addItem' .jiso/cart.query.txt
```

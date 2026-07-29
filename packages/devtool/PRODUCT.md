# Kovo Dataflow Devtool

## Register

product

## Users

The primary user is an AI coding agent retrieving bounded graph and runtime facts through MCP. The
secondary user is a developer tracing the same facts visually while debugging a Kovo app. Both need
to move from a symptom to the exact authored declaration or wire event without learning a separate
analysis model.

## Product Purpose

Make Kovo's compiler-owned dataflow graph and development wire activity directly navigable. The
devtool succeeds when an agent and a human can select the same component, query, mutation, route, or
diagnostic; see identical source-anchored facts; and identify the next action without reconstructing
application behavior from runtime instrumentation.

## Brand Personality

Sharp, candid, technical. Dense when the task benefits from density, calm about uncertainty, and
explicit about whether a fact is static proof or recent runtime evidence.

## Anti-references

- Runtime-spy devtools that reconstruct a second, potentially divergent application model.
- Generic node-canvas dashboards that prioritize spectacle over directional traceability.
- Opaque error consoles that expose raw internals without a safe cause or next action.
- Decorative terminal aesthetics that reduce contrast, keyboard access, or information hierarchy.

## Design Principles

1. **One fact, many renderers.** The visual UI, MCP, and CLI project the same compiler/runtime facts.
2. **Source before spectacle.** Every useful node, edge, diagnostic, and frame leads to an exact
   authored source span when one exists.
3. **Static proof and live evidence stay distinct.** Runtime frames may light the static graph but
   never rewrite or overclaim it.
4. **Bounded by default.** Searches, frame history, source slices, and traces remain finite,
   deterministic, and inspectable.
5. **Development only.** Live endpoints, runtime history, and implementation assets must be absent
   from production and static-export artifacts.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Core selection and inspection remain server-rendered, URL-addressable, and usable
with JavaScript disabled. Interactive enhancement must preserve keyboard navigation, visible focus,
contrast, semantic status text, and reduced-motion preferences; color alone never communicates node
kind, edge state, or failure severity.

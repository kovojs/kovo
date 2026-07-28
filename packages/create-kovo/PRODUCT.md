# Product

## Register

product

## Users

The primary user is a senior engineer or framework evaluator in Kovo's first ten minutes. They
have just scaffolded the app and need to verify that authentication, typed data, progressive
enhancement, styling, tests, checks, and production build form one coherent workflow. A secondary
user is a coding agent using the starter as the canonical shape for an ordinary Kovo application.

The user may inspect the app on a laptop, a narrow browser window, or a phone-sized viewport. They
are trying to complete the first authenticated CRUD action quickly, then understand where to make
their first real change.

## Product Purpose

The starter is a small authenticated contact book that proves Kovo's safe path is also a credible
product path. It should reach a useful signed-in screen without hidden setup, demonstrate public
Kovo component and style APIs, work without client JavaScript, and upgrade the same forms in place
when JavaScript is available.

Success means an evaluator can sign in, add a contact, understand success and failure states, and
recognize the files they would edit next. The interface should feel complete enough to trust and
small enough to replace.

## Brand Personality

**Sharp, calm, practical.** The starter speaks like a well-maintained internal tool: specific,
unshowy, and confident. It demonstrates framework behavior through useful UI and precise copy
rather than marketing claims.

## Anti-references

- A generic SaaS dashboard with ornamental metrics, excessive cards, gradients, glass, or
  decorative navigation.
- A marketing landing page disguised as an application.
- An unstyled tutorial toy that makes the framework's production path look hypothetical.
- A bespoke design system that distracts from the public Kovo APIs an evaluator is trying to
  learn.
- Motion, color, or clever controls that make routine authentication and data entry less familiar.

## Design Principles

1. **Start in the task.** After authentication, contacts and the add-contact action are the clear
   center of the screen.
2. **Teach through real structure.** Semantic landmarks, forms, errors, empty states, and
   responsive behavior should be patterns an app author can keep.
3. **Prove the public path.** Visible UI is built from documented Kovo component and style APIs;
   internal assembly never leaks into authored presentation code.
4. **Progressive enhancement is invisible.** The same understandable interface works before and
   after JavaScript enhancement.
5. **Small is a feature.** Every visual element earns its place in the starter and remains easy to
   delete or adapt.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Text and placeholders meet contrast requirements; every interactive control is
keyboard operable with a visible focus state; errors are associated and announced; heading and
landmark order is meaningful; the interface remains usable at 320 CSS pixels and 200% zoom.
Motion is optional, conveys state only, and respects `prefers-reduced-motion`. Status must never be
communicated by color alone.

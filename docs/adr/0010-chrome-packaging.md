# 0010 — Chrome packaging: custom elements, plain DOM, or framework adapters

**Status:** accepted · **Decided by:** engineering · **Blocks:** `UI-01` through `UI-33`, `API-16`,
`API-20`, `API-23`, and the SSR guarantee

## Context

The objects draft defines a slot/contract API for replaceable chrome and explicitly refuses to decide how the
default chrome ships — "custom elements, a plain-DOM renderer, or optional per-framework adapters ... a
packaging decision for spec 05". The API draft then specifies slots and renderers that return plain DOM
(`SlotContent = HTMLElement | DocumentFragment | string | null | void`), states that "docier does not impose
a virtual DOM on plugin authors", describes per-framework bindings as thin separate packages, and never
mentions custom elements or Web Components at all. So the two drafts answer the question by implication but
never restate it, and the API draft also requires something a custom-element strategy would make harder:
importing any entry point must have **no** side effects, `createDocier` without a container must do no DOM
work, and no code may define globals at module scope.

The choices are not equivalent in cost:

- **Custom elements** give encapsulation and a framework-independent tag surface, at the price of a registry
  that is global and shared (`customElements.define` cannot be undone, and a second instance or a second
  library version collides), plus SSR complications and a hydration story. They also cannot be scoped to a
  container, which fights the "multiple isolated instances on one page" requirement.
- **Plain DOM renderers behind the slot API** cost nothing at runtime, work in SSR and in tests, are
  copyable by a host that wants to fork them, and cannot collide with anything. The price is that
  encapsulation is by convention (a class-name prefix) rather than by the platform, and a host that wants
  real isolation must use a shadow root, which the config already anticipates as a `requiresReload` option.
- **Per-framework adapters in core** would make the core depend on React, Vue and Svelte, which contradicts
  the framework-agnostic rule the whole specification rests on.

## Options

| Option | Tradeoff |
|---|---|
| Custom elements for every chrome part | Framework-independent tag surface and real encapsulation. Cost: a global registry that cannot be un-registered, collisions between instances or versions, SSR and hydration complexity, and no per-instance scoping — directly at odds with the isolation and SSR requirements. |
| Custom elements for a few leaf parts only (the ruler, a token chip) | A middle path. Cost: two mechanisms to document, test and theme, for a benefit that the slot API already provides. |
| **Plain DOM renderers behind the typed slot/registry API**, with framework bindings as separate packages | Zero runtime cost, SSR-safe, copyable defaults, per-instance scoping, no global state. Cost: no platform-level encapsulation, so isolation depends on a naming convention and on the host opting into a shadow root. |
| Plain DOM in core plus a web-component wrapper package | Gives hosts that want tags a path. Cost: a wrapper whose maintenance outlives the demand for it; the binding packages already cover the frameworks the customers use. |

## Decision

**Plain DOM renderers behind the typed slot and registry API.** No custom elements, no framework in core, no
global registration of any kind. Framework bindings (`@docier/react`, `@docier/vue`, `@docier/svelte`) are
thin separate packages that own exactly three things: the element ref, instance creation on mount, and
disposal on unmount — they do not re-render on document change, do not pass reactive props through as config
except via an explicit `config` prop, and never re-create the instance on a prop change (that is
`updateConfig`).

The chrome contract is what makes this safe, and it is binding: a slot accepts a host renderer or `null`, and
**a slot and the library's default implementation are interchangeable** because the default uses only the
same public contract — so a host can copy the default chrome and modify it. Chrome DOM carries
`data-docier="<slot>"` and `data-docier-part="<name>"`, and state changes are mirrored as `docier:command`
and `docier:state` `CustomEvent`s, which is the whole integration surface for a non-TypeScript host. Chrome
modules **may not import the document model**, enforced by lint: chrome subscribes to state and dispatches
commands, and if a chrome feature cannot be expressed as a command plus a state subscription, it is designed
wrong.

## Consequences

- SSR is safe by construction: importing an entry point defines nothing and touches nothing, so the React
  binding can render a container on the server and mount in an effect without a hydration mismatch.
- Multiple instances are fully isolated with no possibility of a registry collision, which the "up to eight
  instances per page" limit assumes.
- A host that wants real encapsulation can enable a shadow root through config, which is a `requiresReload`
  option; the default is light DOM with a `--docier-`-namespaced class convention.
- Theming is via CSS custom properties only — class names and internal selectors are explicitly **not** part
  of the public contract, so we keep the freedom to
  change internals without a major version.
- `ui.override()` replaces a whole surface or nothing: partial replacement of built-in internals is not
  supported, because it would freeze internals into the public contract.
- A host that wants web components can wrap a slot renderer in one in a few lines; we are not shipping that
  wrapper until someone asks for it twice.

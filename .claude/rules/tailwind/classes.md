---
paths:
  - "src/**/*.{ts,tsx,js,jsx}"
---

# Tailwind CSS — Utilities and Components

This repository uses Tailwind CSS v4 with Next.js, React, shadcn/ui, Base UI, `cn`, and `class-variance-authority`.

Follow the repository's existing components, semantic tokens, theme, and nearby UI conventions before introducing new styling patterns. Do not redesign unrelated UI while completing another task.

When behavior is version-sensitive or uncertain, check the installed Tailwind version and current official Tailwind documentation rather than guessing from older Tailwind knowledge.

## Decision Order

When styling UI, prefer this order:

1. Reuse an existing shared component or component variant.
2. Reuse an existing semantic/project design token.
3. Use an existing Tailwind utility.
4. Use an arbitrary value for a genuine one-off requirement.
5. Add a theme token when a value is reused or belongs to the design system.
6. Add custom CSS when utilities are not the clearest or most maintainable representation.

Do not invent abstractions simply to avoid normal Tailwind utilities.

## Prefer Exact Built-in Utilities Over Equivalent Arbitrary Values

Before adding an arbitrary value, check whether Tailwind already expresses the exact value.

Avoid:

```tsx
className="min-w-[10rem]"
```

Prefer in this repository:

```tsx
className="min-w-40"
```

Avoid:

```tsx
className="w-[8rem]"
```

Prefer:

```tsx
className="w-32"
```

Do not replace an exact design requirement with an approximate built-in value merely to avoid brackets.

Arbitrary values are valid when they represent a real one-off requirement, for example:

```tsx
className="top-[117px]"
className="ring-[3px]"
className="grid-cols-[24rem_2.5rem_minmax(0,1fr)]"
className="max-h-[calc(100dvh-(--spacing(6)))]"
className="hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]"
```

If the same arbitrary value starts appearing repeatedly or gains semantic meaning, consider promoting it into the existing theme.

## Keep Class Names Statically Detectable

Tailwind scans source as text. Never construct utility names dynamically.

Do not write:

```tsx
className={`bg-${color}-500`}
```

Map values to complete class strings instead:

```tsx
const colorVariants = {
  blue: "bg-blue-500",
  red: "bg-red-500",
} as const;
```

For reusable component variants, use the repository's existing `cva` pattern when appropriate.

## Reuse the Existing Design System

The project already exposes semantic shadcn tokens and badminton-specific product tokens from `src/app/globals.css`.

Prefer semantic utilities when they match the intended role, including:

```text
bg-background
text-foreground
bg-primary
text-primary-foreground
border-border
text-muted-foreground
```

Prefer existing product tokens when they match the court-board visual language, including utilities derived from:

```text
chalk
ink
hall
mat
surround
line
feather
sage
cork
signal
```

Do not introduce a parallel palette or theme system for concepts that already have tokens.

A one-off arbitrary color is still valid when it truly does not belong to the shared design system.

## Shared UI and shadcn Components

Before creating a primitive, inspect `src/components/ui/`.

Keep shadcn/Base UI primitives close to the project's established structure and upstream conventions unless the task specifically requires divergence.

For reusable components with a finite visual API, prefer explicit variants such as:

- `variant`
- `size`
- `intent`
- `state`

Use `cva` where it matches existing component patterns.

Allow `className` as an escape hatch/extension mechanism when that matches the component's existing API. Do not make callers reconstruct the entire design language through arbitrary classes.

## Class Composition

Use the existing `cn` helper from `@/lib/utils`.

Prefer:

```tsx
cn(
  "rounded-md px-4 py-2",
  active && "bg-primary text-primary-foreground",
  className,
)
```

Do not add another class-merging package when the existing helper is sufficient.

## Utility Simplification

Prefer shorter equivalent utilities when they improve readability:

```text
py-4
```

instead of:

```text
pt-4 pb-4
```

and:

```text
size-6
```

instead of:

```text
h-6 w-6
```

Do not perform unrelated utility cleanup while implementing another task.

## Responsive Design

Use mobile-first responsive styles.

Prefer:

```tsx
className="flex flex-col gap-4 md:flex-row"
```

Use viewport breakpoints when behavior depends on viewport size.

Use container queries when behavior depends on the space available to a component.

Do not replace viewport breakpoints with container queries merely because container queries are newer.

The badminton court already uses container-relative sizing intentionally. Preserve that model where the component's layout depends on its own available width.

## States and Variants

Prefer Tailwind's built-in variants when CSS can express the behavior correctly:

- `hover:`
- `focus-visible:`
- `active:`
- `disabled:`
- `checked:`
- `aria-*`
- `data-*`
- `group-*`
- `peer-*`
- `has-*`
- `not-*`

Prefer `data-*` and `aria-*` variants when Base UI or another primitive already exposes those states.

## Modern Tailwind v4 Syntax

Use slash opacity:

```text
bg-black/50
text-foreground/70
border-border/50
```

Do not introduce removed v3 opacity utilities such as:

```text
bg-opacity-50
text-opacity-75
```

Use current gradient syntax such as:

```text
bg-linear-to-r
bg-radial
bg-conic
```

Use Tailwind v4 CSS-variable shorthand when it is clearer:

```text
bg-(--brand-color)
w-(--width)
```

Use the trailing important modifier form when an important utility is truly required:

```text
flex!
```

Avoid important utilities unless the specificity requirement is real.

## Accessibility and Interaction

Never remove keyboard focus indication without providing an accessible replacement.

Prefer `focus-visible:` for keyboard-specific focus treatment.

Use semantic HTML before adding ARIA.

Do not rely on color alone for important state.

Preserve the project's coarse-pointer/touch sizing patterns such as `pointer-coarse:` when modifying interactive controls.

Do not make essential functionality available only on hover.

Respect reduced-motion preferences for non-essential animation.

## Class Ordering (Prettier) and Biome

Tailwind classes are sorted by `prettier-plugin-tailwindcss` (configured in `.prettierrc.json` with `tailwindStylesheet` and `tailwindFunctions: ["cn", "cva"]`), Tailwind's official sorter. It understands v4 theme tokens, custom utilities, and screen variants.

Biome's `useSortedClasses` is intentionally disabled because it would fight the Prettier order. Biome remains the linter and formatter for everything else.

- run `pnpm lint:fix` (Prettier sorts, then Biome formats) instead of ordering classes by hand;
- `pnpm lint` runs `biome check` and `prettier --check` and must pass;
- `src/components/ui/` and generated files are listed in `.prettierignore`;
- never change behavior solely to appease class sorting.

## Completion

For meaningful Tailwind UI changes:

- run the relevant repository checks;
- preserve responsive, pointer, keyboard, and reduced-motion behavior;
- verify the changed state visually/runtime when practical;
- keep the diff scoped to the requested change.

---
paths:
  - "src/**/*.css"
---

# Tailwind CSS — Theme and Custom CSS

This repository uses Tailwind CSS v4 with its main stylesheet and theme in `src/app/globals.css`.

Preserve the existing shadcn semantic theme, badminton court-board design tokens, and complex court CSS unless the task explicitly requires an architectural change.

When Tailwind syntax or behavior may be version-sensitive, consult the installed version and current official documentation instead of relying on old v3/v4 migration memory.

## CSS-first Tailwind v4

The project uses:

```css
@import "tailwindcss";
@import "shadcn/tailwind.css";
```

Preserve this integration unless the task explicitly changes the styling stack.

Do not introduce Tailwind v3 directives:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

## Existing Theme Architecture

`src/app/globals.css` already uses:

- `@theme inline` for mappings into Tailwind utilities;
- `@theme` for static project design tokens;
- `:root` for semantic runtime CSS variables;
- `@layer base` for project-wide defaults;
- `@layer components` for the complex badminton court visualization;
- reduced-motion fallbacks.

Extend these systems rather than creating parallel configuration.

## `@theme inline`

Use the existing `@theme inline` pattern when a Tailwind theme variable should resolve directly to another CSS variable.

Preserve semantic mappings such as:

```css
--color-background: var(--background);
--color-foreground: var(--foreground);
--color-primary: var(--primary);
--color-primary-foreground: var(--primary-foreground);
--color-border: var(--border);
--color-ring: var(--ring);
```

Do not duplicate existing semantic concepts under new token names without a real need.

## `@theme`

Use `@theme` for design tokens that should create first-class Tailwind utilities.

Existing project examples include:

```css
--breakpoint-xs: 22.5rem;
--text-caption: 0.6875rem;
--text-button: 0.9375rem;
--tracking-caps: 0.14em;
--radius-card: 1.25rem;
--radius-panel: 1.75rem;
```

A value generally belongs in `@theme` when:

- it is reused;
- it has semantic meaning;
- it belongs to the product's visual language; or
- it should intentionally generate a Tailwind utility.

Do not create a theme token merely to eliminate a legitimate one-off value.

## Ordinary CSS Variables

Use ordinary CSS custom properties when the value should not itself create a Tailwind utility or when it represents runtime/semantic state.

Preserve the existing `:root` semantic variable model used by shadcn.

## Arbitrary Values

Arbitrary values are a supported Tailwind feature, not an automatic code smell.

Use them for genuine one-off requirements, exact external dimensions, complex calculations, unusual CSS values, or cases that do not belong in the shared design system.

If an arbitrary value becomes repeated or semantic, consider promoting it into the existing theme.

## Complex Badminton Court CSS

The badminton court is intentionally implemented as custom CSS under `@layer components`.

Do not mechanically rewrite this system into enormous JSX utility strings.

Custom CSS is appropriate here because the court uses:

- precise real-world geometry;
- nested selectors;
- absolute positioning;
- container query units;
- media and container queries together;
- pseudo-elements;
- repeating gradients;
- exact responsive orientation changes.

Preserve the court CSS architecture unless the requested task specifically changes it.

Do not opportunistically refactor unrelated court styles while fixing another issue.

## `@layer components`

`@layer components` remains valid for custom component classes.

Use it when complex reusable CSS is clearer than encoding the same behavior as markup utilities.

Do not assume every component-layer rule should become `@utility`.

For ordinary React UI reuse, prefer React components and variants. For selector-heavy or geometry-heavy visuals like the court, custom component CSS is appropriate.

## `@utility`

Use `@utility` when defining a true reusable Tailwind utility that should participate in Tailwind variants.

Do not create a custom utility when:

- a built-in utility already exists;
- the behavior only belongs to one complex CSS component; or
- an ordinary CSS rule communicates the intent better.

## `@custom-variant`

Use `@custom-variant` only for reusable project-wide variants not already expressible with Tailwind's built-in variant system.

## `@apply`

`@apply` is supported in Tailwind v4.

The project already uses it for global semantic defaults, for example:

```css
* {
  @apply border-border outline-ring/50;
}

body {
  @apply bg-background text-foreground;
}
```

Do not remove valid existing `@apply` use merely because component markup normally prefers utilities.

For reusable React application UI, prefer components and `cva` variants instead of creating CSS abstractions solely to hide repeated utility strings.

`@apply` is also reasonable in custom CSS/third-party styling contexts where utilities cannot live directly in markup.

## `@source`

Tailwind v4 automatically detects normal project sources.

Do not introduce a v3-style `content: []` configuration.

Use `@source` only when automatic detection genuinely misses a source containing Tailwind classes, such as an ignored external package.

Do not use safelisting to compensate for class names that should instead be written statically.

## `@reference`

Use `@reference` only when a separately processed CSS context needs access to the project's Tailwind theme/utilities/variants without duplicating generated CSS.

Do not add CSS Modules or separately processed stylesheets just to shorten Tailwind class lists.

## Motion

Preserve the project's existing `prefers-reduced-motion` behavior.

When adding animation or transitions, provide an appropriate reduced-motion path when the effect is non-essential.

## New CSS Tooling

Do not introduce Sass, Less, Stylus, CSS-in-JS, or another styling system unless the project has a concrete requirement for it.

Prefer the existing Tailwind + plain CSS architecture.

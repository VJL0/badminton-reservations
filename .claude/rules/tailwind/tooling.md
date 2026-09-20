---
paths:
  - "package.json"
  - "pnpm-lock.yaml"
  - "postcss.config.mjs"
  - "components.json"
  - "biome.json"
  - ".prettierrc.json"
  - "next.config.ts"
---

# Tailwind CSS — Tooling and Integration

This repository is a Next.js application using Tailwind CSS v4 through PostCSS, shadcn/ui, pnpm, and Biome.

Inspect the installed versions and existing configuration before changing Tailwind or styling tooling.

Do not migrate build integrations or add overlapping tooling unless the task explicitly requires it.

## Next.js + PostCSS

The repository uses the official Tailwind PostCSS integration:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

This is the correct Tailwind integration for this Next.js project.

Do not convert the project to `@tailwindcss/vite`; it is not a Vite application.

Do not configure the `tailwindcss` package itself as the PostCSS plugin.

Do not add `autoprefixer` or `postcss-import` solely for behavior already handled by Tailwind v4.

## CSS Entry Point

The project Tailwind stylesheet is:

```text
src/app/globals.css
```

It imports:

```css
@import "tailwindcss";
@import "shadcn/tailwind.css";
```

Preserve this setup unless the task intentionally changes it.

## CSS-first Configuration

Tailwind v4 configuration is CSS-first in this repository.

Do not create `tailwind.config.js` or `tailwind.config.ts` merely because older Tailwind projects used one.

If a future dependency genuinely requires legacy JavaScript configuration, verify that requirement against current Tailwind documentation before introducing it.

## shadcn/ui

`components.json` intentionally uses:

- React Server Components;
- TSX;
- CSS variables;
- `src/app/globals.css` as the Tailwind CSS file;
- an empty Tailwind `config` field;
- the repository's established path aliases.

Preserve these conventions when adding or updating shadcn components.

Use the existing semantic token system instead of hardcoding a second palette into generated components.

## Package Manager

Use pnpm for package operations.

Do not create npm or Yarn lockfiles.

Do not change unrelated Tailwind, shadcn, Next.js, Biome, or PostCSS versions as part of an unrelated styling task.

## Biome and Prettier

Biome is the linter and formatter. `prettier-plugin-tailwindcss` (via `.prettierrc.json`) is used for Tailwind class sorting; `useSortedClasses` is disabled in `biome.json` so the two do not conflict.

- keep `tailwindStylesheet` pointing at `src/app/globals.css`;
- keep `cn` and `cva` in `tailwindFunctions`;
- keep the Prettier plugin loaded last if more Prettier plugins are ever added;
- keep Prettier's `printWidth` and `trailingComma` aligned with Biome's formatter so the two tools agree.

## Dependencies and Plugins

Before adding a Tailwind-related package or plugin:

1. Check whether the installed Tailwind version already provides the feature.
2. Check whether shadcn or the current project already provides it.
3. Prefer existing project tooling over duplicate tooling.
4. Verify version-sensitive behavior using current official documentation.

## Verification

After changing Tailwind/build/tooling configuration, run the relevant repository checks:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Run narrower checks when the change does not justify all three.

Do not report a configuration change complete while a relevant production build or type check is failing.

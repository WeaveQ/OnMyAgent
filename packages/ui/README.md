# @onmyagent/ui

Shared UI primitives for OnMyAgent apps.

This package ships a React entrypoint: `@onmyagent/ui/react`.

## Paper components

The shared components live under the `paper` namespace and wrap Paper Design shaders with OnMyAgent-specific defaults and deterministic seed support.

Current components:

- `PaperGrainGradient`

`PaperGrainGradient` accepts a `seed` prop. Pass a TypeID-like string such as `om_01kmhbscaze02vp04ykqa4tcsb` and the component will deterministically derive colors and shader params from it. The same seed always produces the same result.

Explicit props still work and override the seeded values, so the merge order is:

1. OnMyAgent defaults
2. Seed-derived values from `seed`
3. Explicit props passed by the caller

## Layout convention

These components default to `fill={true}`, which means they render at `width: 100%` and `height: 100%`. Put them inside a sized container and they will fill it without needing manual width or height props.

## Agent notes

- Shared seed logic lives in `src/common/paper.ts`
- React wrappers live in `src/react/paper/*`
- Prefer extending the existing seed helpers instead of inventing per-app one-off shader configs

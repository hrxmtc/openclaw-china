# @openclaw-china/setup

Cross-platform installer for `@openclaw-china/channels`.

It downloads the plugin tarball from npm with `npm pack`, then passes the local archive to `openclaw plugins install`. This avoids the default `ClawHub first, npm fallback` resolution path used by bare package installs.

## Usage

```bash
npx @openclaw-china/setup
```

The installer finishes by launching `openclaw china setup`, so installation and the interactive configuration wizard run in one command.

Use a specific npm registry:

```bash
npx @openclaw-china/setup --registry https://registry.npmmirror.com
```

Install a specific version or dist-tag:

```bash
npx @openclaw-china/setup --version latest
npx @openclaw-china/setup --version 2026.3.9-1
```

## Local verification

When you are developing inside `packages/setup`, `npx @openclaw-china/setup` does not verify the published package. It stays in the local package context.

Use one of these instead:

```bash
pnpm build
pnpm smoke
```

```bash
pnpm exec:local -- --help
```

<p align="center">
  <a href="https://lumioui.com"><img src=".github/assets/logo.png" width="96" height="96" alt="LumioUI"></a>
</p>

<h1 align="center">LumioUI CLI</h1>

<p align="center">
  Animated React Native components and screens for Expo, copied into your project as source you own.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lumioui/cli"><img src="https://img.shields.io/npm/v/@lumioui/cli?color=BEF04C&labelColor=0B0B0F" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-BEF04C?labelColor=0B0B0F" alt="MIT license"></a>
  <a href="https://github.com/lumioui/cli/actions/workflows/ci.yml"><img src="https://github.com/lumioui/cli/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

```bash
npx @lumioui/cli init          # set up NativeWind and the theme, wire App/_layout, add AGENTS.md notes
npx @lumioui/cli add button    # install a free component into ./components/ui
```

## Commands

```bash
npx @lumioui/cli init                     # set up NativeWind + theme, wire App/_layout, add AGENTS.md notes
npx @lumioui/cli add button               # install a free component into ./components/ui
npx @lumioui/cli add pro/paywall-sheet    # Pro items need the pro/ prefix and a licence
npx @lumioui/cli list                     # browse the registry, grouped by flow and category
npx @lumioui/cli list --pro               # Pro items only; --type component|block|screen filters
npx @lumioui/cli doctor                   # check the setup, including your licence key
npx @lumioui/cli login                    # save your Pro licence key on this computer
npx @lumioui/cli whoami                   # which account and plan the key belongs to
npx @lumioui/cli skills list              # agent skills (free) and design tastes (Pro)
npx @lumioui/cli skills add lumioui lumio-taste   # install them for Claude Code, Cursor and AGENTS.md
```

### Flags for `add`

| flag | effect |
| --- | --- |
| `--all` | every free item |
| `--design <slug>` | resolve family names to a design-language variant (`add badge --design glass` → `badge-glass`) |
| `--overwrite` | replace existing files |
| `--dry-run` | print the plan, write nothing |
| `--cwd <dir>` | run against another project root |

## Pro items

Pro components and every screen template install with the `pro/` prefix and a licence key from a [Pro or Team plan](https://lumioui.com/pricing):

```bash
npx @lumioui/cli login            # once per computer: paste a key from lumioui.com/account#keys
npx @lumioui/cli add pro/auth-login
```

In CI, set `LUMIO_LICENSE_KEY` instead; a key in the environment wins over a saved login. The CLI sends your key only to the default registry (`https://api.lumioui.com`) or to the origin in your own `LUMIO_REGISTRY` variable, never to a registry named in a project's `lumioui.json`, and it refuses plain-http registries other than localhost.

Docs: [lumioui.com/docs/cli](https://lumioui.com/docs/cli) · Registry API: [lumioui.com/docs/registry-api](https://lumioui.com/docs/registry-api)

## Developing

Needs Node 18.18 or later.

```bash
npm install
npm test            # unit tests
npm run typecheck
npm run build       # writes dist/
node dist/index.js --help
```

Point it at a local or staging registry with `LUMIO_REGISTRY=<url>`.

Issues and pull requests are welcome. For a security problem, please follow [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## License

The CLI's source code is [MIT](./LICENSE). The components, screens, icons and helpers it installs into your project are covered by the [LumioUI License](https://lumioui.com/license): free items can be used in any app, personal or commercial, and Pro items need a plan.

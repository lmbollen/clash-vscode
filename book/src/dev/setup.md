# Development Setup

## Prerequisites

The project uses [Nix](https://nixos.org/) to provide a reproducible development environment. The `flake.nix` at the repository root pulls in:

- **Node.js 20** + npm + TypeScript
- **GHC** with Clash and its compiler plugins
- **Cabal** for building the test Haskell project
- **Haskell Language Server** (HLS)
- **Yosys** for logic synthesis
- **nextpnr** for place & route (ice40, ecp5, …)

Enter the shell:

```bash
nix develop
```

## Building the Extension

```bash
npm install          # once
npm run compile      # one-off build
npm run watch        # incremental recompilation (background)
```

## Running in VS Code

1. Open this repository in VS Code.
2. Press **F5** to launch the Extension Development Host.
3. In the new window, open the `test-project/` folder.
4. Open `src/Example/Project.hs` and wait for HLS to initialise.
5. Use the Command Palette (`Ctrl+Shift+P`) to invoke Clash commands.

## Project Layout

| Path | Purpose |
|------|---------|
| `src/` | Extension source (TypeScript) |
| `src/test/` | Mocha test suites |
| `test-project/` | Sample Haskell/Clash project used during development |
| `book/` | mdbook documentation (this book) |
| `flake.nix` | Nix dev-shell definition |

## NixOS Notes

On NixOS the VS Code test runner downloads an Electron binary that cannot find system libraries (`libglib-2.0.so.0`, etc.). **Run tests via F5 inside VS Code** instead of `npm test` from the terminal. See the [Testing](testing.md) chapter for details.

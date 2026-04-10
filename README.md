# Clash VS Code Yosys Extension

Synthesize Verilog from Haskell functions using [Clash](https://clash-lang.org/), explore the result with [Yosys](https://yosyshq.net/yosys/), and place-and-route for ECP5 FPGAs with [nextpnr](https://github.com/YosysHQ/nextpnr) — all from inside VS Code.

## What It Does

The extension integrates with **Haskell Language Server** (HLS) to find functions in your Clash project, determines which ones are monomorphic (and therefore synthesisable), then drives the full hardware workflow:

```
Haskell source → Clash (Verilog) → Yosys (synthesis) → nextpnr (place & route) → bitstream
```

At every stage you can inspect output, view statistics, and open an interactive circuit diagram.

## Prerequisites

The extension does **not** ship any compilers or toolchains. You must have them available in your environment (e.g. via `nix develop`, `cabal`, `stack`, or your system package manager).

| Tool | Purpose | Required |
|------|---------|----------|
| **Clash** (`cabal run clash --`) | Haskell → Verilog compilation | Yes |
| **Haskell Language Server** | Function detection & type info | Yes |
| **Yosys** | Logic synthesis & statistics | For synthesis commands |
| **nextpnr-ecp5** | Place & route | For P&R commands |
| **ecppack** | Bitstream generation (ECP5) | For bitstream output |

Run **Clash: Check Toolchain** from the command palette to verify what is available.

## Quick Start

1. Open a Clash project in VS Code (one that builds with `cabal build`).
2. Make sure HLS is running (install the [Haskell extension](https://marketplace.visualstudio.com/items?itemName=haskell.haskell)).
3. Open a `.hs` file and run **Clash: Detect Functions** from the command palette.
4. Pick a monomorphic function (marked with ✓) and follow the prompts.

## Commands

| Command | Description |
|---------|-------------|
| **Clash: Detect Functions** | Scan the current file for functions, show which are synthesisable |
| **Clash: Synthesize Function to Verilog** | Generate a wrapper module, compile to Verilog with Clash |
| **Clash: Synthesize and Place & Route** | Full pipeline: Clash → Yosys → nextpnr → bitstream |
| **Clash: Check Toolchain** | Verify all external tools are reachable |

## Configuration

All settings live under **`clash-vscode-yosys`** in VS Code settings.

| Setting | Default | Description |
|---------|---------|-------------|
| `clashCommand` | `cabal run clash --` | How to invoke Clash. Also accepts `stack exec clash --`, `nix run .#clash --`, or a bare `clash` if it is on PATH. |
| `yosysCommand` | `yosys` | How to invoke Yosys. |
| `outputFormat` | `verilog` | HDL output format (`verilog`, `vhdl`, `systemverilog`). |
| `autoCleanup` | `false` | Delete temporary wrapper modules after compilation. |
| `showYosysSchematic` | `false` | Open the DigitalJS circuit viewer automatically after Yosys synthesis. |
| `skipCommandValidation` | `false` | Skip the startup toolchain check (useful for direnv / nix-shell where the PATH isn't available until the shell hook runs). |

## How Synthesis Works

1. **Function detection** — HLS provides document symbols and hover types. The extension's type analyser checks whether a function is monomorphic (all concrete types, no type variables).

2. **Wrapper generation** — For a function like `plusSigned :: Signed 8 -> Signed 8 -> Signed 8` in module `Example.Project`, the extension generates:

   ```haskell
   module ClashSynth_PlusSigned where
   import Clash.Prelude
   import qualified Example.Project

   topEntity :: Signed 8 -> Signed 8 -> Signed 8
   topEntity = Example.Project.plusSigned
   {-# ANN topEntity (Synthesize { t_name = "plus_signed", ... }) #-}
   {-# OPAQUE topEntity #-}
   ```

3. **Synthesis cabal project** — The extension maintains a small cabal project at `.clash/synth-project/` that depends on your package. This means Clash can resolve all your project's transitive dependencies (other packages, type-lits plugins, etc.) correctly. The project contains:
   - `cabal.project` — references both the synth project and your project
   - `clash-synth.cabal` — depends on `clash-prelude`, `clash-ghc`, and your package
   - `src/` — generated wrapper modules
   - `bin/Clash.hs` — minimal entry point for `cabal run clash`

4. **Clash compilation** — The wrapper is compiled with `cabal run clash -- ClashSynth_PlusSigned --verilog` inside the synth project. Because the synth project depends on your package through cabal, all dependencies are resolved normally.

5. **Yosys synthesis** — Runs Yosys with the appropriate target family script (generic, iCE40, ECP5, Xilinx) and reports cell/wire statistics.

6. **Place & route** — Runs nextpnr for the selected device and reports timing and utilisation.

## Output Structure

All generated files live under `.clash/` in the workspace root:

```
.clash/
  synth-project/           # Cabal project that depends on your package
    cabal.project
    clash-synth.cabal
    bin/Clash.hs
    src/                   # Generated wrapper modules
  Example.Project.plusSigned/
    01-haskell/            # Copy of generated wrapper .hs
    02-verilog/            # Clash Verilog output
    03-yosys/              # Yosys synthesis results + statistics
    04-nextpnr/            # Place & route output + bitstream
```

## Development

### Nix (recommended)

```bash
nix develop          # Enter dev shell with all dependencies
npm install          # Install Node dependencies
npm run watch        # Compile in watch mode
# Press F5 in VS Code to launch the Extension Development Host
```

The Nix flake provides: Node.js 20, GHC + Clash + HLS, Yosys, nextpnr, ecppack.

### Without Nix

Install Node.js ≥ 20 and the tools listed in [Prerequisites](#prerequisites), then:

```bash
npm install
npm run compile
```

### Tests

```bash
npm test           # Run full test suite in VS Code test runner
npm run lint       # ESLint
```

The test suite covers:

- **TypeAnalyzer** — monomorphic/polymorphic classification, edge cases
- **CodeGenerator** — wrapper structure, port names, type signatures, snake_case
- **HLSClient** — type extraction from single-line and multi-line hovers
- **ClashCompiler** — diagnostic parsing from compiler output
- **ToolchainChecker** — tool availability probing and caching
- **FunctionDetector** (integration) — end-to-end detection against the test project with HLS

### Project Structure

```
src/
  extension.ts             # Activation, command registration, orchestration
  toolchain.ts             # External tool availability checking
  hls-client.ts            # HLS integration (symbols, hover types)
  function-detector.ts     # Function scanning and classification UI
  type-analyzer.ts         # Monomorphism analysis
  code-generator.ts        # Wrapper module generation
  clash-compiler.ts        # Clash invocation and output parsing
  clash-manifest-parser.ts # clash-manifest.json parsing
  yosys-runner.ts          # Yosys script generation and execution
  nextpnr-runner.ts        # nextpnr invocation, timing/utilisation parsing
  diagram-viewer.ts        # DigitalJS webview
  file-logger.ts           # Debug file logging
  types.ts                 # Shared interfaces
  test/
    suite/
      type-analyzer.test.ts
      code-generator.test.ts
      hls-client.test.ts
      clash-compiler.test.ts
      toolchain.test.ts
      function-detector.test.ts   # Integration (requires HLS)
test-project/              # Sample Clash/Cabal project for testing
```

## Known Limitations

- **Clash is not bundled** — you must provide it in your environment.
- **Cabal project required** — the workspace must contain a `.cabal` file. The extension creates a synthesis sub-project that depends on your package.
- **Polymorphic functions** — cannot be synthesised directly. Create a monomorphic wrapper in your Haskell code first.
- **Target families** — Yosys synthesis supports generic, iCE40, ECP5, and Xilinx. Place & route currently targets ECP5 via nextpnr-ecp5.

## License

[Add your license here]

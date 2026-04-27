# Getting Started

## Prerequisites

The extension does **not** ship any compilers or toolchains. You must have them available in your environment (e.g. via `nix develop`, `cabal`, or your system package manager).

| Tool | Purpose | Required |
|------|---------|----------|
| **Clash** (`cabal run clash-synth:clash --`) | Haskell → Verilog compilation | Yes |
| **Haskell Language Server** | Function detection & type info | Yes |
| **Yosys** | Logic synthesis & statistics | For synthesis commands |
| **nextpnr-ecp5** | Place & route | For P&R commands |

Run **Clash: Check Toolchain** from the command palette to verify what is available.

## Quick Start

1. Open a Clash project in VS Code (one that builds with `cabal build`).
2. Make sure HLS is running (install the [Haskell extension](https://marketplace.visualstudio.com/items?itemName=haskell.haskell)).
3. Open a `.hs` file containing monomorphic functions.
4. Either:
   - Run **Clash: Detect Functions** from the command palette and pick a function, or
   - Place your cursor on a monomorphic function and press `Ctrl+.` to use a code action.

## How Synthesis Works

1. **Function detection** — HLS provides document symbols and hover types. The type analyser checks whether a function is monomorphic (all concrete types, no type variables).

2. **Wrapper generation** — For a function like `topEntity` in module `Example.Project`, the extension generates a wrapper module under `.clash/synth-project/src/`:

   ```haskell
   {-# OPTIONS_GHC -Wno-orphans #-}
   module ClashSynth_TopEntity where

   import Clash.Prelude
   import qualified Example.Project

   topEntity = Example.Project.topEntity

   {-# ANN topEntity
     (Synthesize
       { t_name = "top_entity"
       , t_inputs = [ PortName "CLK"
                    , PortName "RST"
                    , PortName "EN"
                    , PortName "IND"
                    ]
       , t_output = PortName "OUT"
       }) #-}
   {-# OPAQUE topEntity #-}
   ```

   Compound types like `DiffClock` are handled automatically with `PortProduct` annotations.

3. **Synthesis cabal project** — The extension maintains a cabal project at `.clash/synth-project/` that depends on your package. This lets Clash resolve all transitive dependencies correctly.

4. **Clash compilation** — Runs `cabal run clash-synth:clash -- ClashSynth_TopEntity --verilog` inside the synth project.

5. **Yosys synthesis** — Runs Yosys with target-specific scripts (generic, iCE40, ECP5, Xilinx). For multi-component designs, sub-modules are synthesized in parallel waves using out-of-context synthesis.

6. **Place & route** — Runs nextpnr for the selected device and reports timing and utilisation. The target frequency is parsed from Clash-generated SDC files.

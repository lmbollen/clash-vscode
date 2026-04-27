# Synthesis Pipeline

## Wrapper Generation

The `CodeGenerator` creates a Clash wrapper module that re-exports the user's function as `topEntity` with a `Synthesize` annotation. The wrapper is written to `.clash/synth-project/src/`.

Port names are derived heuristically from the type signature:

| Type pattern | Port annotation |
|-------------|----------------|
| `Clock …` | `PortName "CLK"` |
| `DiffClock …` | `PortProduct "CLK" [PortName "p", PortName "n"]` |
| `Reset …` | `PortName "RST"` |
| `Enable …` | `PortName "EN"` |
| Anything else | `PortName "INA"`, `PortName "INB"`, … |
| Output | `PortName "OUT"` |

The synthesis cabal project (`ensureSynthProject`) maintains `cabal.project`, `clash-synth.cabal`, and `bin/Clash.hs`. It discovers the user's cabal project via `findCabalProject` and adds it as a dependency.

## Clash Compilation

`ClashCompiler.compileToVerilog()` runs:

```
cabal run clash-synth:clash -- <ModuleName> --verilog
```

with `--project-dir` and `--project-file` flags when a user cabal project is detected. The compiler parses stdout/stderr for errors and warnings, and locates the generated Verilog and `clash-manifest.json`.

## Yosys Synthesis

The runner exposes three flows, all sharing the same Yosys child-process plumbing:

### Whole-design (`synthesize`)

Default for **Synthesize** and always used for **Place & Route**. Generates a single Yosys script that reads every Verilog file, elaborates the hierarchy, runs target-specific synthesis (`synth_ecp5`, `synth_ice40`, etc.), and writes outputs (synthesized Verilog, netlist JSON, statistics, diagram).

### Per-module synthesis (`synthesizePerModule`)

Used by **Synthesize** when `outOfContext` is enabled. Each component in the dependency graph is synthesized independently with its own directory under `per-module/<name>/`:

1. Dependencies' Verilog files are read (not synthesized) so `hierarchy -check` passes
2. The component is flattened and tech-mapped standalone
3. Each module produces `.il` (RTLIL), `.json` (netlist), `.svg` (diagram), and per-module statistics

### Per-module elaboration (`elaboratePerModule`)

Always used by **Elaborate**. Same per-module loop as `synthesizePerModule`, but the script body is `proc + opt_clean` (no flatten, no tech mapping). The `show` command is invoked with the component's name as an explicit selector so the diagram renders only that component's gates — sub-component instances appear as boxes rather than being expanded.

## nextpnr Place & Route

`NextpnrRunner.placeAndRoute()` builds command-line arguments for the selected FPGA family and device, runs nextpnr, and parses timing and utilization from stdout.

SDC-derived frequency is passed via `--freq` when available.

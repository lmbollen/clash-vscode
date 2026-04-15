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

Three synthesis strategies are available:

### Standard (`synthesize`)

Generates a single Yosys TCL script that reads all Verilog files, elaborates the hierarchy, runs target-specific synthesis (`synth_ecp5`, `synth_ice40`, etc.), and writes outputs (synthesized Verilog, JSON for DigitalJS, statistics).

### Parallel OOC (`synthesizeParallel`)

For multi-component designs (detected via `ClashManifestParser.buildDependencyGraph`):

1. Components are grouped into waves of mutually-independent modules
2. Each wave is synthesized in parallel
3. Sub-modules use generic `synth -top X` (no tech mapping) and produce JSON netlists
4. The top module reads pre-synthesized dependency netlists and runs target-specific synthesis
5. This avoids cell definition conflicts from tech-mapped sub-modules

### Per-Module (`synthesizePerModule`)

Each component is synthesized independently with its dependencies' Verilog loaded for hierarchy resolution:

1. Each component gets its own directory under `per-module/`
2. Dependencies' Verilog files are read (not synthesized) so `hierarchy -check` passes
3. Each module produces `.il` (RTLIL) and `.json` (DigitalJS) outputs
4. Individual circuit diagrams can be viewed for any module

## nextpnr Place & Route

`NextpnrRunner.placeAndRoute()` builds command-line arguments for the selected FPGA family and device, runs nextpnr, parses timing and utilization from stdout, and optionally runs ecppack for ECP5 bitstream generation.

SDC-derived frequency is passed via `--freq` when available.

# Configuration

All settings live under `clash-toolkit` in VS Code settings.

| Setting | Default | Description |
|---------|---------|-------------|
| `yosysCommand` | `yosys` | Command to invoke Yosys |
| `outputFormat` | `verilog` | HDL output format (`verilog`, `vhdl`, `systemverilog`) |
| `autoCleanup` | `false` | Delete temporary wrapper modules after compilation |
| `showYosysSchematic` | `false` | Open the DigitalJS circuit viewer automatically after Yosys synthesis |
| `outOfContext` | `false` | Out-of-context synthesis: when enabled, each component in a multi-component design is synthesized standalone with its own diagram + utilization stats |

## Out-of-Context Synthesis

### Disabled (default)

The whole design is synthesized as a single netlist with target-specific commands (e.g. `synth_ecp5`). Produces one JSON netlist and one synthesized Verilog file. This matches what nextpnr consumes for place-and-route.

### Enabled

Each component in the dependency graph is synthesized independently, producing:
- An `.il` (RTLIL) file per module
- A `.json` netlist per module
- An `.svg` circuit diagram per module
- Per-module statistics (cell count, wire count, logic depth)

Useful for inspecting and comparing the synthesis result of each sub-module individually. The Place & Route command always uses the whole-design path regardless of this setting; nextpnr needs a merged netlist.

## Elaboration

The `Clash: Elaborate` command always runs per-module — its purpose is to expose what Clash produced *before* technology mapping, so each component's hierarchy is preserved and rendered with sub-component instances shown as boxes. This setting does not affect elaboration.

## Clash Invocation

The extension invokes Clash via: `cabal run clash-synth:clash --`

This runs the `clash` executable from the synthesis cabal project at `.clash/synth-project/`, which depends on your package through cabal. This ensures all transitive dependencies are resolved correctly.

The synth project is created and updated automatically — you don't need to manage it.

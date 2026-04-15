# Configuration

All settings live under `clash-vscode-yosys` in VS Code settings.

| Setting | Default | Description |
|---------|---------|-------------|
| `yosysCommand` | `yosys` | Command to invoke Yosys |
| `outputFormat` | `verilog` | HDL output format (`verilog`, `vhdl`, `systemverilog`) |
| `autoCleanup` | `false` | Delete temporary wrapper modules after compilation |
| `showYosysSchematic` | `false` | Open the DigitalJS circuit viewer automatically after Yosys synthesis |
| `synthesisMode` | `whole-design` | Synthesis mode: `whole-design` synthesizes everything at once; `per-module` synthesizes each component separately with individual diagrams |

## Synthesis Mode

### whole-design (default)

All components are synthesized together. The top module gets target-specific synthesis (e.g. `synth_ecp5`), and the result is a single JSON netlist and synthesized Verilog file. For multi-component designs, sub-modules are synthesized in parallel using out-of-context synthesis.

### per-module

Each component in the dependency graph is synthesized independently, producing:
- An `.il` (RTLIL) file per module
- A `.json` (DigitalJS) file per module for individual circuit diagrams

This mode is useful for inspecting the synthesis result of each sub-module individually. After synthesis, you can pick any module from a list to view its circuit diagram.

## Clash Invocation

The extension invokes Clash via: `cabal run clash-synth:clash --`

This runs the `clash` executable from the synthesis cabal project at `.clash/synth-project/`, which depends on your package through cabal. This ensures all transitive dependencies are resolved correctly.

The synth project is created and updated automatically — you don't need to manage it.

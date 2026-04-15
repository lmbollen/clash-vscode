# Commands

All commands are available from the VS Code command palette (`Ctrl+Shift+P`).

| Command | Description |
|---------|-------------|
| **Clash: Detect Functions** | Scan the current file for functions, show which are synthesisable |
| **Clash: Synthesize Function to Verilog** | Generate a wrapper module, compile to Verilog with Clash, optionally run Yosys |
| **Clash: Synthesize Only** | Full Clash → Yosys pipeline without place & route. Supports both whole-design and per-module modes |
| **Clash: Synthesize and Place & Route** | Full pipeline: Clash → Yosys → nextpnr → bitstream |
| **Clash: Check Toolchain** | Verify all external tools (Clash, Yosys, nextpnr, ecppack) are reachable |

## Detect Functions

Scans the current Haskell file (or all open Haskell documents) using HLS document symbols and hover types. Shows a picker listing each function with its type signature, marking monomorphic functions with ✓ and polymorphic ones with ✗.

If you select a monomorphic function, you're offered the option to synthesize it immediately.

## Synthesize Function to Verilog

An interactive command that:

1. Detects functions in the current file
2. Shows a picker with only synthesizable (monomorphic) functions
3. Generates a Clash wrapper module
4. Compiles to Verilog with Clash
5. Optionally runs Yosys synthesis

## Synthesize Only

Runs the full Clash compilation and Yosys synthesis pipeline without place & route. This is useful when you want to inspect synthesis results and circuit diagrams without targeting a specific FPGA.

Respects the `synthesisMode` setting:
- **whole-design** — synthesizes all modules together (default)
- **per-module** — synthesizes each component separately, producing individual `.il` (RTLIL) and `.json` (DigitalJS) files for each module

## Synthesize and Place & Route

The full FPGA implementation pipeline. After detecting and selecting a function:

1. Generates wrapper module
2. Compiles to Verilog with Clash
3. Synthesizes with Yosys (ECP5 target)
4. Parses SDC files for target clock frequency
5. Runs nextpnr-ecp5 with the selected device and package
6. Generates a bitstream with ecppack

You'll be prompted to choose an ECP5 device (25k/45k/85k) and package (CABGA381/554/756).

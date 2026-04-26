# Clash Toolkit

> **Community extension** — maintained by [Lucas Bollen](https://github.com/lmbollen) (QBayLogic). Not an official release of the [Clash](https://clash-lang.org/) project.

Synthesize Verilog from Haskell functions using [Clash](https://clash-lang.org/), explore the result with [Yosys](https://yosyshq.net/yosys/), and place-and-route for ECP5 FPGAs with [nextpnr](https://github.com/YosysHQ/nextpnr) — all from inside VS Code.

The extension integrates with **Haskell Language Server** (HLS) to find functions in your Clash project, determines which ones are monomorphic (and therefore synthesisable), then drives the full hardware workflow:

```
Haskell source → Clash (Verilog) → Yosys (synthesis) → nextpnr (place & route) → bitstream
```

At every stage you can inspect output, view statistics, and open an interactive circuit diagram powered by DigitalJS.

## Feature Highlights

- **Function detection** via HLS — finds monomorphic functions automatically
- **Code actions** — press `Ctrl+.` on a function to synthesize it directly
- **Two synthesis modes** — whole-design (efficient) or per-module (individual diagrams)
- **SDC frequency parsing** — reads Clash-generated `.sdc` files for target clock frequency
- **Parallel OOC synthesis** — sub-modules synthesized in parallel waves
- **Interactive circuit viewer** — DigitalJS-based pan/zoom schematic in a webview
- **Full PnR flow** — ECP5 place & route with timing analysis and utilization reports
- **Debug logging** — all tool invocations logged to `.clash/debug.log`

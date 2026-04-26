# Clash Toolkit

> **Community extension** — maintained by [Lucas Bollen](https://github.com/lmbollen) (QBayLogic). Not an official release of the [Clash](https://clash-lang.org/) project.

Synthesize Verilog from Haskell functions using [Clash](https://clash-lang.org/), explore the result with [Yosys](https://yosyshq.net/yosys/), and place-and-route for ECP5 FPGAs with [nextpnr](https://github.com/YosysHQ/nextpnr) — all from inside VS Code.

```
Haskell source → Clash (Verilog) → Yosys (synthesis) → nextpnr (place & route) → bitstream
```

## Quick Start

1. Install the extension and have Clash, HLS, Yosys, and nextpnr on your PATH (e.g. via `nix develop`).
2. Open a Clash project, make sure HLS is running.
3. Open a `.hs` file → **Ctrl+.** on a monomorphic function → **Synthesize** (or use the Command Palette).

Run **Clash: Check Toolchain** to verify tool availability.

## Documentation

Full documentation is in the **[book/](book/)** directory (built with [mdbook](https://rust-lang.github.io/mdBook/)):

```bash
cd book && mdbook serve   # http://localhost:3000
```

Highlights:

- [Getting Started](book/src/guide/getting-started.md) — prerequisites, first synthesis
- [Commands](book/src/guide/commands.md) — all five commands
- [Configuration](book/src/guide/configuration.md) — settings reference
- [Architecture Overview](book/src/architecture/overview.md) — source layout and data flow
- [Developer Setup](book/src/dev/setup.md) — building, running, Nix shell
- [Testing](book/src/dev/testing.md) — test suites and how to run them

## License

[BSD 2-Clause](LICENSE) © 2026 Lucas Bollen.

# Changelog

All notable changes to **Clash Toolkit** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

Initial public release.

### Added
- Function detection in Haskell sources via Haskell Language Server.
- Code actions and command palette entries to synthesize a selected function.
- Clash → Verilog generation through `cabal run clash-synth:clash`.
- Yosys synthesis for eight target families (generic, ice40, ecp5, xilinx, gowin, intel, quicklogic, sf2).
- Whole-design and per-module synthesis modes; parallel out-of-context (OOC) synthesis for sub-modules.
- Interactive DigitalJS-based circuit viewer.
- nextpnr place-and-route flow for ECP5 (with optional routed-layout SVG).
- Synthesis results tree view and standalone results panel.
- Configurable Yosys scripts per target with placeholder substitution.
- Toolchain check command to verify external tool availability.

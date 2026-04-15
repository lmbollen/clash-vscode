# Code Actions

The extension registers a code action provider for Haskell files. When your cursor is on a monomorphic function definition, pressing `Ctrl+.` (or clicking the lightbulb) offers:

- **Clash: Synthesize 'funcName'** — runs Clash compilation + Yosys synthesis (no PnR)
- **Clash: Synthesize + Place & Route 'funcName'** — full pipeline through to bitstream generation

Code actions skip the function detection and picker dialogs — the function under the cursor is used directly. This provides a fast workflow for synthesizing specific functions without navigating the command palette.

## How It Works

The code action provider uses `FunctionDetector` to find all functions in the document, then checks if any function's range contains the cursor line. Only monomorphic functions produce code actions — polymorphic functions are silently ignored.

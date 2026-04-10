# Design Document: Quality-of-Life Refactor

## Current State

The extension provides a pipeline: detect Haskell functions → generate Clash wrapper → compile to Verilog → Yosys synthesis → nextpnr place-and-route → DigitalJS visualization. The core flow works but has several quality-of-life issues that need addressing.

## Known Problems & Fixes

### 1. Clash Cannot Be Shipped

**Status:** Won't fix — by design. The user must have Clash available in their environment (via Nix, cabal, stack, etc.). The extension already has configuration for `clashCommand` and validates on startup. This is correct.

### 2. Calling Clash on Raw Haskell Files Ignores Cabal Modules

**Problem:** The extension calls `cabal run clash -- /path/to/WrapperModule.hs --verilog`, passing a raw `.hs` file path. This fails when the module being imported is part of a cabal project because Clash doesn't know about the cabal dependency graph.

**Fix:** Instead of passing the `.hs` file directly, we should:
1. Write the generated wrapper module into the cabal project's source tree (a `clash-synth/` directory registered in the cabal file, or a temporary file alongside the source).
2. Pass the **module name** to Clash instead of the file path: `cabal run clash -- --verilog -main-is ClashSynth_Foo` or better yet, use `cabal run clash -- ClashSynth_Foo --verilog` where Clash resolves the module through cabal's module search paths.

**Chosen approach:** Generate the wrapper `.hs` file inside the project's source tree (under `clash-synth/` in the workspace root). Register this directory in the cabal file's `hs-source-dirs` if needed, or — simpler and non-invasive — just place it adjacent to the source and pass the module name. Since `cabal run clash --` uses cabal's build system, we can pass `-i<dir>` to tell GHC where to find the module:

```
cabal run clash -- -iclash-synth ClashSynth_ModuleName --verilog -fclash-hdldir <hdlDir>
```

This way clash can find both the wrapper module and the imported project module through cabal's normal resolution.

### 3. Type Display Only Shows First Argument

**Problem:** The `extractTypeSignature` regex in `hls-client.ts` uses a pattern that may only capture text up to the first newline when HLS returns multi-line type signatures. Also, the QuickPick `description` field may truncate long types.

**Fix:** 
- Update `parseTypeFromString` to handle multi-line type signatures from HLS hover (join lines, collapse whitespace).
- Show the full type signature in the QuickPick detail line (which supports wrapping) rather than the description field.

### 4. Check Program Availability and Give Nice Errors

**Problem:** If `clash`, `yosys`, `nextpnr-*`, or `ecppack` aren't available, the user gets cryptic spawn errors.

**Fix:** Create a `ToolchainChecker` utility that:
- Checks each tool on activation (with configurable skip).
- Caches results.
- Shows a single consolidated status bar item or notification.
- Before each operation, checks the specific tool needed and shows a clear error: "yosys not found in PATH. Install it or configure clash-vscode-yosys.yosysCommand".

## Additional Quality Improvements

### 5. Generated Wrapper Should Include Type Signature

The code generator has `topEntity :: ${typeSignature}` commented out. This should be uncommented — it makes the generated code clearer and helps Clash give better error messages.

### 6. Remove Duplicate Test File

`unit-tests.test.ts` and `type-analyzer.test.ts` contain overlapping tests for `TypeAnalyzer`. The unit-tests file is a superset. Remove the duplicate and keep one canonical test file per module.

### 7. Remove Hello World Command

The `helloWorld` command and the placeholder `runYosys` command should be removed for a production extension.

### 8. Test Coverage Gaps

Missing tests for:
- `ClashCompiler`: command parsing, validation, verilog discovery
- `HLSClient`: type signature extraction, module name parsing
- `CodeGenerator`: full type signature in generated code, edge cases
- Toolchain availability checking (new feature)
- Error paths in each module

## Implementation Plan

1. **Add `ToolchainChecker`** — new module for checking tool availability
2. **Fix cabal module compilation** — use `-i` flag to add the wrapper directory to GHC's search path, pass module name instead of file path
3. **Fix type signature extraction** — handle multi-line HLS hover output
4. **Uncomment topEntity type annotation** in code generator
5. **Clean up commands** — remove helloWorld, remove runYosys placeholder
6. **Consolidate tests** — merge duplicate test files, add missing test coverage
7. **Update README** — document prerequisites, usage, configuration

## Files Changed

| File | Change |
|------|--------|
| `src/toolchain.ts` | **New** — tool availability checking |
| `src/clash-compiler.ts` | Use module name + `-i` flag instead of file path |
| `src/code-generator.ts` | Uncomment type signature, write to project-relative location |
| `src/hls-client.ts` | Fix multi-line type extraction |
| `src/extension.ts` | Add toolchain checks, remove hello world, clean up |
| `src/function-detector.ts` | Show full type in QuickPick detail |
| `package.json` | Remove unused commands |
| `src/test/suite/unit-tests.test.ts` | Remove (merged into type-analyzer.test.ts) |
| `src/test/suite/type-analyzer.test.ts` | Expanded tests |
| `src/test/suite/code-generator.test.ts` | Fix topEntity assertion, add tests |
| `src/test/suite/clash-compiler.test.ts` | **New** — tests for compiler module |
| `src/test/suite/hls-client.test.ts` | **New** — tests for type extraction |
| `src/test/suite/toolchain.test.ts` | **New** — tests for tool checking |
| `README.md` | Complete rewrite |

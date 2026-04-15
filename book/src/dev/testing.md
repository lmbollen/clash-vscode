# Testing

## Test Suites

All tests live under `src/test/suite/` and use **Mocha** in TDD mode (`suite` / `test`).

| File | Kind | What it covers |
|------|------|----------------|
| `type-analyzer.test.ts` | Unit | Monomorphic/polymorphic detection, edge cases |
| `code-generator.test.ts` | Unit | Wrapper generation, port annotations, DiffClock handling |
| `sdc-parser.test.ts` | Unit | SDC frequency parsing (period → MHz) |
| `synthesis-features.test.ts` | Unit | Commands, configuration, synthesis types |
| `code-actions.test.ts` | Unit | Code action provider for Haskell functions |
| `platform-tools.test.ts` | Unit | Yosys/nextpnr tool detection |
| `toolchain.test.ts` | Unit | Full toolchain availability |
| `clash-compiler.test.ts` | Unit | Clash compiler invocation helpers |
| `hls-client.test.ts` | Integration | HLS communication |
| `function-detector.test.ts` | Integration | Function detection from real Haskell files via HLS |
| `integration.test.ts` | Integration | Per-module synthesis, SDC parsing, end-to-end flows |
| `unit-tests.test.ts` | Unit | Legacy combined unit tests |

## Running Tests

### From VS Code (recommended on NixOS)

1. **Ctrl+Shift+D** → select **Extension Tests**
2. Press **F5**

A second VS Code window opens with the test-project workspace, runs all suites, and reports results in the Debug Console.

### From the terminal

```bash
npm run pretest   # compile
npm test          # run
```

> **NixOS caveat:** `npm test` downloads an Electron binary that lacks NixOS system libraries. Use the VS Code approach above instead.

## Writing a New Test

```typescript
import * as assert from 'assert';

suite('My Feature', () => {
    test('does the right thing', () => {
        assert.strictEqual(1 + 1, 2);
    });

    test('async operation', async function () {
        this.timeout(10_000);
        const result = await someAsyncCall();
        assert.ok(result);
    });
});
```

Place the file in `src/test/suite/` with a `.test.ts` suffix — the test runner picks it up automatically via the glob in `index.ts`.

## Debugging a Test

Set breakpoints in your `.test.ts` file, then launch **Extension Tests** with F5. Execution pauses at breakpoints; use the Debug panel to inspect state.

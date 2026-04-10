# Running Tests on NixOS

## Issue with npm test

On NixOS, running `npm test` from the command line may fail because the VS Code test runner downloads a binary that can't find system libraries:

```
error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file
```

## ✅ Recommended: Run Tests in VS Code

**This is the best approach for NixOS:**

1. Make sure you're in the Nix development shell:
   ```bash
   nix develop
   ```

2. Open VS Code in this directory

3. Press `Ctrl+Shift+D` (Run and Debug)

4. Select **"Extension Tests"** from the dropdown

5. Press **F5**

This uses the VS Code from your Nix environment, which has all necessary libraries.

## Test Types Available

### Unit Tests (`unit-tests.test.ts`)
Pure logic tests that don't require VS Code:
- Type analyzer monomorphic/polymorphic detection
- Edge cases and type parsing
- **7 tests total**

### Integration Tests (`function-detector.test.ts`)  
Tests that require HLS and the test-project:
- Function detection from real Haskell files
- Type signature extraction
- Filtering synthesizable functions
- **4 tests total**

## Viewing Test Results

When you run tests with F5:
1. A new VS Code window opens with the test-project
2. Tests run automatically
3. Results appear in the Debug Console
4. Green checkmarks = passing, red X = failing

## Expected Test Output

```
Type Analyzer Test Suite
  ✔ Should identify monomorphic signatures
  ✔ Should identify polymorphic signatures
  ✔ Should handle edge cases
  ✔ Should explain monomorphism correctly
  ✔ Should handle multiple type variables
  ✔ Should handle complex nested types
  ✔ Should distinguish between type constructors and variables

Function Detection Integration Test Suite
  ✔ Should detect functions in test project
  ✔ Should correctly identify monomorphic functions
  ✔ Should filter synthesizable functions
  ✔ Should extract type signatures from HLS

11 passing (30s)
```

## Debugging Failed Tests

1. **Set breakpoints** in test files (`.test.ts`)
2. Run **Extension Tests** (F5)
3. Execution pauses at breakpoints
4. Inspect variables in Debug panel
5. Step through code with F10/F11

## Common Issues

### "HLS returned 0 symbols"
**Solution:** Wait a few more seconds for HLS to initialize, or open and save the test file manually.

### "Cannot find module"
**Solution:** Run `npm run compile` to rebuild tests.

### Tests timeout
**Solution:** Increase timeout in test:
```typescript
test('My test', async function() {
    this.timeout(60000); // 60 seconds
    // ...
});
```

## Adding New Tests

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for comprehensive examples.

Quick template:
```typescript
test('Should do something', () => {
    const result = myFunction();
    assert.strictEqual(result, expected);
});
```

## CI/CD Alternative

For automated testing in CI environments with proper FHS compatibility, consider using Docker or a different approach. The VS Code test electron requires specific system libraries that may not be available in pure Nix environments.

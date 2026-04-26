# Extension Tests

This directory contains tests for the Clash Toolkit.

## Structure

- **runTest.ts** - Entry point for running tests. Downloads VS Code, launches it with the test-project, and runs the test suite.
- **suite/index.ts** - Mocha test suite configuration
- **suite/type-analyzer.test.ts** - Unit tests for type analysis (no HLS required)
- **suite/function-detector.test.ts** - Integration tests using HLS and the test-project

## Running Tests

### Command Line
```bash
npm test
```

### VS Code
1. Open Run and Debug (`Ctrl+Shift+D`)
2. Select "Extension Tests"
3. Press F5

## Writing Tests

See [docs/TESTING_GUIDE.md](../../docs/TESTING_GUIDE.md) for comprehensive documentation on writing and debugging tests.

### Quick Example

```typescript
import * as assert from 'assert';

suite('My Test Suite', () => {
    test('Should pass', () => {
        assert.strictEqual(1 + 1, 2);
    });
});
```

## Test Environment

Tests run in a real VS Code instance with:
- The test-project workspace opened
- Haskell extension available (for HLS)
- 60-second timeout (configurable per test)

## Debugging Tests

Set breakpoints in test files and run "Extension Tests" with the debugger attached.

## CI/CD

Tests can run headlessly in CI environments:
```bash
npm ci
npm run compile  
npm test
```

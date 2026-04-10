# Testing Guide for Developers

This document explains how to write and run tests for the Clash VS Code Yosys extension.

> **Note for NixOS Users:** See [TESTING_NIXOS.md](TESTING_NIXOS.md) for NixOS-specific instructions. TL;DR: Use F5 in VS Code instead of `npm test`.

## Test Structure

```
src/test/
├── runTest.ts              # Test runner entry point
├── suite/
│   ├── index.ts            # Test suite configuration
│   ├── type-analyzer.test.ts       # Unit tests for type analysis
│   └── function-detector.test.ts   # Integration tests with HLS
```

## Running Tests

### From Command Line

```bash
# Run all tests
npm test

# Compile and run tests
npm run pretest && npm test
```

### From VS Code

1. Open the Run and Debug panel (`Ctrl+Shift+D`)
2. Select "Extension Tests" from the dropdown
3. Press F5 or click the green play button

### Watch Mode

```bash
# Compile on changes
npm run watch

# In another terminal, run tests when ready
npm test
```

## Test Types

### Unit Tests

**File:** [type-analyzer.test.ts](src/test/suite/type-analyzer.test.ts)

Tests the type analysis logic in isolation without requiring HLS:
- Monomorphic type detection
- Polymorphic type detection
- Edge cases and error handling
- Type explanation generation

**Example:**
```typescript
test('Should identify monomorphic signatures', () => {
    assert.strictEqual(
        typeAnalyzer.isMonomorphic('Signed 8 -> Signed 8 -> Signed 8'),
        true
    );
});
```

### Integration Tests

**File:** [function-detector.test.ts](src/test/suite/function-detector.test.ts)

Tests that require actual HLS integration and the test-project:
- Function detection from real Haskell files
- Type signature extraction from HLS
- Filtering synthesizable functions
- Complete workflow testing

**Example:**
```typescript
test('Should detect functions in test project', async function() {
    this.timeout(30000);
    const document = await openTestFile('src/Example/Project.hs');
    const functions = await functionDetector.detectFunctions(document);
    assert.ok(functions.length >= 4);
});
```

## Writing New Tests

### Unit Test Template

```typescript
import * as assert from 'assert';
import { YourClass } from '../../your-module';

suite('Your Feature Test Suite', () => {
    let instance: YourClass;

    setup(() => {
        // Initialize before each test
        instance = new YourClass();
    });

    teardown(() => {
        // Cleanup after each test
    });

    test('Should do something', () => {
        const result = instance.method();
        assert.strictEqual(result, expectedValue);
    });
});
```

### Integration Test Template

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Integration Test Suite', () => {
    suiteSetup(async function() {
        this.timeout(30000); // Allow time for HLS
        // One-time setup for entire suite
    });

    test('Should test with HLS', async function() {
        this.timeout(30000); // Long timeout for HLS
        
        const document = await openTestFile('src/Example/Project.hs');
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for HLS
        
        // Your test code here
        assert.ok(someCondition);
    });
});
```

## Test Utilities

### Opening Test Files

```typescript
const document = await openTestFile('src/Example/Project.hs');
```

Opens a file from the test-project workspace.

### Waiting for Conditions

```typescript
await waitFor(() => condition === true, timeout, interval);
```

Polls a condition until it's true or times out.

### Output Logging

```typescript
outputChannel.appendLine('Debug information');
```

Logs to test output for debugging.

## Common Patterns

### Testing Async Code

```typescript
test('Async test', async function() {
    this.timeout(10000); // Increase timeout
    const result = await asyncFunction();
    assert.ok(result);
});
```

### Testing Error Cases

```typescript
test('Should throw error', async () => {
    await assert.rejects(
        async () => await functionThatShouldThrow(),
        /Expected error message/
    );
});
```

### Testing Multiple Conditions

```typescript
test('Should satisfy multiple conditions', () => {
    assert.ok(condition1, 'Condition 1 failed');
    assert.ok(condition2, 'Condition 2 failed');
    assert.strictEqual(actual, expected, 'Values should match');
});
```

## Debugging Tests

### Run with Debugger

1. Set breakpoints in your test files
2. Select "Extension Tests" from Run and Debug
3. Press F5
4. Debugger will stop at breakpoints

### View Test Output

- Check the Debug Console for test results
- Check the "Test Output" output channel for custom logging
- Use `console.log()` for quick debugging (appears in Debug Console)

### Common Issues

**Problem:** HLS not ready
```
Solution: Increase timeout and add wait time:
this.timeout(30000);
await new Promise(resolve => setTimeout(resolve, 5000));
```

**Problem:** File not found
```
Solution: Check workspace is correctly opened and path is relative to workspace root
```

**Problem:** Tests hang
```
Solution: Ensure async operations have timeouts and proper error handling
```

## Best Practices

1. **Use appropriate timeouts** - HLS operations can be slow
2. **Wait for HLS** - Add delays after opening files
3. **Isolate tests** - Each test should be independent
4. **Clean up** - Dispose of resources in teardown
5. **Descriptive assertions** - Include messages explaining what failed
6. **Test edge cases** - Empty inputs, invalid data, etc.
7. **Mock when appropriate** - Use mocks for external dependencies in unit tests

## CI/CD Integration

Tests can be run in CI pipelines:

```bash
# In CI environment
npm ci
npm run compile
npm test
```

For headless environments, VS Code test runner automatically downloads and runs a headless VS Code instance.

## Test Coverage

To add test coverage reporting (future):

```bash
npm install --save-dev nyc
```

Update package.json:
```json
"test:coverage": "nyc npm test"
```

## Next Steps

1. Run the existing tests: `npm test`
2. Read the test files to understand patterns
3. Add tests for new features as you develop them
4. Ensure tests pass before committing code

For more information, see:
- [VS Code Extension Testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Mocha Documentation](https://mochajs.org/)

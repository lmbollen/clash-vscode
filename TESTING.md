# Testing Guide

This guide explains how to test the Clash VS Code Yosys extension.

## Prerequisites

1. Enter the Nix development environment:
   ```bash
   nix develop
   ```

2. Install npm dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

## Running the Extension

1. Open this project in VS Code
2. Press `F5` to launch the Extension Development Host
3. In the new VS Code window, open the `test-project` folder

## Testing Function Detection

### Test 1: Detect Functions Command

1. Open [test-project/src/Example/Project.hs](test-project/src/Example/Project.hs)
2. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
3. Run: `Clash: Detect Functions`
4. Wait for HLS to analyze the file (may take a few seconds)

**Expected Results:**
- A QuickPick menu should appear with detected functions
- You should see:
  - ✓ `plusSigned` (monomorphic, synthesizable)
  - ✓ `multUnsigned` (monomorphic, synthesizable)
  - ✓ `topEntity` (monomorphic, synthesizable)
  - ✗ `plusPoly` (polymorphic, not synthesizable)
  - ✗ `accum` (polymorphic, not synthesizable)

### Test 2: Function Analysis

1. Run `Clash: Detect Functions`
2. Select any function from the list
3. Check the output channel (View → Output → "Clash Synthesis")

**Expected Results:**
- Detailed analysis of the function should appear
- For monomorphic functions: prompt to synthesize
- For polymorphic functions: explanation of why it can't be synthesized

### Test 3: Synthesize Function Command

1. Run: `Clash: Synthesize Function to Verilog`
2. A list of only synthesizable functions should appear
3. Select a function

**Expected Results:**
- Currently shows a placeholder message (Phase 4 not implemented yet)
- Function info logged to output channel

## Troubleshooting

### HLS Not Working

**Symptom:** No functions detected or "No type signature" in output

**Solution:**
1. Make sure Haskell extension is installed
2. Wait for HLS to fully initialize (check status bar)
3. Build the test project first:
   ```bash
   cd test-project
   cabal build
   ```
4. Reload VS Code window

### No Functions Appear

**Symptom:** "No functions detected" message

**Solution:**
1. Ensure you have a Haskell file open
2. Check that the file is in the test-project workspace
3. Verify HLS is running: look for "Haskell" in the status bar

### Type Signatures Missing

**Symptom:** Functions detected but shown as polymorphic when they're not

**Solution:**
1. Add explicit type signatures to functions in the source
2. Ensure the file compiles without errors
3. Wait for HLS to re-analyze after changes

## Development Workflow

### Watch Mode

For continuous compilation during development:

```bash
npm run watch
```

### Checking for Errors

```bash
npm run lint
npm run compile
```

### Viewing Output

- View → Output
- Select "Clash Synthesis" from the dropdown

## Next Steps

Once function detection is working:

1. **Phase 4: Code Generation** - Implement wrapper module generation
2. **Phase 5: Clash Integration** - Execute Clash compiler
3. **Phase 6: Yosys Integration** - Add Yosys synthesis

See [ROADMAP.md](ROADMAP.md) for details.

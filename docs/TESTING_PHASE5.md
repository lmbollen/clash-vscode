# Testing Phase 5: Clash Compiler Integration

## Prerequisites

- VS Code with Extension Development Host running (F5)
- `nix develop` shell active (provides Clash and Cabal)
- test-project workspace open

## Test Scenarios

### 1. Basic Compilation - Success Case

**Steps**:
1. Open test-project in Extension Development Host
2. Open `src/Example/Project.hs`
3. Run command: "Clash: Synthesize Function to Verilog" (Ctrl+Shift+P)
4. Select `plusSigned` from dropdown
5. Click "Compile with Clash"

**Expected Result**:
- Progress notification shows "Compiling ClashSynth_PlusSigned with Clash"
- Output channel shows:
  ```
  Running: cabal run clash -- ClashSynth_PlusSigned --verilog -fclash-hdldir .clash-synth/verilog
  [Cabal output...]
  ✓ Compilation successful
  ✓ Generated Verilog: .clash-synth/verilog/ClashSynth_PlusSigned/topEntity.v
  ```
- Success notification appears with options:
  - "Open Verilog" - Opens topEntity.v
  - "Synthesize with Yosys" - Shows "coming in Phase 6"
  - "Done" - Closes notification

**Verify**:
```bash
ls -la test-project/.clash-synth/verilog/ClashSynth_PlusSigned/
# Should contain topEntity.v and other Clash files
```

### 2. Multiple Functions

Test with different functions to verify module name generation:

- `plusSigned` → ClashSynth_PlusSigned
- `multUnsigned` → ClashSynth_MultUnsigned
- `topEntity` → ClashSynth_TopEntity

Each should generate in its own directory.

### 3. Error Handling - Cabal Not Found

**Steps**:
1. Exit nix develop shell
2. Close VS Code and reopen WITHOUT `nix develop`
3. Try to compile

**Expected Result**:
- Error message: "Failed to spawn cabal"
- Output channel shows the error
- User can click "Show Output" to see details

### 4. Error Handling - Compilation Failure

**Steps**:
1. Manually edit generated wrapper to introduce syntax error
2. Try to compile invalid wrapper

**Expected Result**:
- Compilation fails with exit code != 0
- Output channel shows Clash error messages
- Error notification with "Show Output" button

### 5. Output Channel Logging

Verify output channel shows:
- Command being run
- Full cabal/Clash output in real-time
- Error messages highlighted
- Success/failure summary

### 6. File Logger Integration

Check `.clash-vscode-debug.log`:
```bash
tail -f test-project/.clash-vscode-debug.log
```

Should log:
- `[OPERATION] compileWithClash - Module: ClashSynth_PlusSigned`
- `[INFO] Compilation succeeded` or `[ERROR] Compilation failed`

## Common Issues

### Issue: "cabal: command not found"

**Solution**: Make sure you're in `nix develop` shell:
```bash
cd /home/nixos/repos/clash-vscode-yosys
nix develop
code .
```

### Issue: Generated Verilog not found

**Possible Causes**:
1. Clash didn't complete successfully (check output)
2. Wrong output directory path
3. Module name mismatch

**Debug**:
```bash
find test-project/.clash-synth -name "*.v"
```

### Issue: Extension crashes during compilation

**Solution**: Check debug log:
```bash
cat test-project/.clash-vscode-debug.log
```

Look for the last operation before crash.

## Performance Testing

Test with increasingly complex functions to verify:
- Progress notification stays visible
- Output streams in real-time (not buffered)
- Large compilation output doesn't crash extension

## Integration with Previous Phases

Verify complete workflow:
1. Detect functions (Phase 2) ✓
2. Analyze types (Phase 3) ✓
3. Generate wrapper (Phase 4) ✓
4. Compile to Verilog (Phase 5) ✓
   - Opens wrapper file
   - User clicks "Compile with Clash"
   - Generates Verilog

All phases should work seamlessly together.

## Success Criteria

- ✅ Successful compilation creates `.v` file
- ✅ Progress notification shows during compilation
- ✅ Output channel streams cabal output
- ✅ Errors are caught and displayed
- ✅ Generated Verilog can be opened
- ✅ File logger captures all operations
- ✅ No crashes or hangs
- ✅ Works from both "Open File" and "Compile with Clash" buttons

## Next: Phase 6 Preparation

Once Phase 5 is working:
1. Verify generated Verilog is valid
2. Manually test with `yosys`:
   ```bash
   cd test-project/.clash-synth/verilog/ClashSynth_PlusSigned
   yosys -p "read_verilog topEntity.v; hierarchy -check -top topEntity; proc; synth; stat"
   ```
3. Use this for Phase 6 Yosys integration

## Automated Testing (Future)

Consider adding integration tests:
- Mock `cabal` command execution
- Test error parsing
- Test Verilog path detection
- Test different module naming cases

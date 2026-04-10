# Development Roadmap

This document outlines the implementation plan for the Clash VS Code Yosys extension.

## ✅ Phase 1: Project Setup (COMPLETE)

- [x] Create VS Code extension structure
- [x] Set up Nix flake with all dependencies
- [x] Create example Clash test project
- [x] Update npm dependencies
- [x] Document architecture and design
- [x] Define extension commands and configuration

## ✅ Phase 2: HLS Integration (COMPLETE)

### Goals
Establish communication with Haskell Language Server to detect and analyze functions.

### Completed Tasks
- [x] Add vscode-languageclient as dependency
- [x] Create HLS client wrapper using VS Code API
- [x] Implement document symbol extraction with recursive children
- [x] Extract type signatures from hover information
- [x] Create FunctionInfo data structure
- [x] Display detected functions in QuickPick UI with monomorphic/polymorphic indicators

### Files Created
- `src/hls-client.ts` - HLS communication wrapper
- `src/function-detector.ts` - Function detection and UI
- `src/extension.ts` - Command registration and handlers
- `src/types.ts` - Type definitions

### Testing
- ✅ Successfully detects all functions in test-project
- ✅ Extracts type signatures from HLS
- ✅ Shows functions in QuickPick with icons

## ✅ Phase 3: Type Analysis (COMPLETE)

### Goals
Implement logic to differentiate monomorphic from polymorphic functions.

### Completed Tasks
- [x] Create type signature parser with tokenization
- [x] Implement monomorphic detection algorithm
- [x] Handle type class constraints (removes before =>)
- [x] Handle concrete type applications (Dom50, etc.)
- [x] Test with various type signatures
- [x] Mark functions as synthesizable/not in UI
- [x] Create comprehensive unit tests (7 tests)

### Files Created
- `src/type-analyzer.ts` - Type signature parsing and analysis
- `src/test/suite/unit-tests.test.ts` - Unit tests for type analyzer

### Test Results
```
✓ plusSigned :: Signed 8 -> Signed 8 -> Signed 8  (monomorphic)
✓ multUnsigned :: Unsigned 16 -> Unsigned 16 -> Unsigned 32  (monomorphic)
✗ plusPoly :: (Num a) => a -> a -> a  (polymorphic)
✗ accum :: (HiddenClockResetEnable dom, KnownNat n) => Signal dom (Unsigned n) -> Signal dom (Unsigned n)  (polymorphic)
```

## ✅ Phase 4: Code Generation (COMPLETE)

### Goals
Generate wrapper modules for Clash synthesis.

### Completed Tasks
- [x] Create CodeGenerator class
- [x] Generate topEntity wrapper
- [x] Add Synthesize annotation with port names
- [x] Add NOINLINE/OPAQUE pragmas
- [x] Handle module imports correctly
- [x] Create .clash-synth directory for temp files
- [x] Generate unique module names
- [x] Smart port name generation (CLK, RST, EN for special types)
- [x] CamelCase to snake_case for Verilog-safe names
- [x] File creation and management
- [x] Unit tests for code generation (5 tests)
- [x] Fix output channel disposal crashes in tests
- [x] Fix Haskell file language recognition

### Files Created
- `src/code-generator.ts` - Wrapper module generation with templates
- `src/test/suite/code-generator.test.ts` - Unit tests

---

## ✅ Phase 5: Clash Compiler Integration (COMPLETE)

### Goals
Compile generated Clash wrapper modules to Verilog

### Completed Tasks
- [x] Create ClashCompiler class
- [x] Spawn `cabal run clash` process with child_process
- [x] Stream compilation output to output channel
- [x] Parse Clash error messages
- [x] Parse Clash warning messages
- [x] Return generated Verilog path
- [x] Find generated Verilog in HDL directory
- [x] Handle compilation failures gracefully
- [x] Show progress notification during compilation
- [x] Offer to open generated Verilog after success

### Files Created
- `src/clash-compiler.ts` - Clash compilation with child_process spawn
- `src/clash-types.ts` - TypeScript interfaces for Clash compilation
- Updated `src/extension.ts` - Integrated Clash compilation workflow

### Implementation Details

**Command executed**:
```bash
cabal run clash -- ModuleName --verilog -fclash-hdldir .clash-synth/verilog
```

**Output structure**:
```
.clash-synth/
├── ClashSynth_FunctionName.hs      # Generated wrapper
└── verilog/
    └── ClashSynth_FunctionName/
        └── topEntity.v              # Clash-generated Verilog
```

**User workflow**:
1. Select monomorphic function
2. Extension generates wrapper module
3. User clicks "Compile with Clash"
4. Progress notification shows compilation status
5. Output channel shows cabal/Clash output
6. On success, offers to open Verilog or continue to Yosys

### Testing

To test Phase 5:
1. Launch Extension Development Host (F5)
2. Open test-project workspace
3. Run command: "Clash: Synthesize Function to Verilog"
4. Select `plusSigned` or `multUnsigned`
5. Click "Compile with Clash"
6. Verify Verilog is generated in `.clash-synth/verilog/`

**Dependencies**: Phase 4 complete ✅

---

## ✅ Phase 6: Yosys Synthesis Integration (COMPLETE)

### Goals
Synthesize Verilog using Yosys for statistics and optimization

### Research Summary

Analyzed two existing VS Code extensions:
- **digitaljs_code** (yuyichao): WebAssembly + DigitalJS visualization
- **vscode-edacation** (EDAcation): Native + WASM, full FPGA toolchain

**Recommendation**: Use child process with output streaming (like vscode-edacation)
- Real-time feedback in output channel
- Parse statistics and errors incrementally
- Better integration with Nix environment
- Full control over synthesis flow

See [docs/YOSYS_INTEGRATION_RESEARCH.md](docs/YOSYS_INTEGRATION_RESEARCH.md) for detailed analysis.

### Completed Tasks
- [x] Create YosysRunner class with child process spawning
- [x] Generate Yosys synthesis scripts from templates
- [x] Stream output to output channel with progress
- [x] Parse synthesis statistics (cell count, wire count, area)
- [x] Parse warnings/errors from Yosys output
- [x] Create yosys-types.ts with interfaces
- [x] Show synthesis results with statistics
- [x] Offer quick actions (Open Synthesized Verilog, View Statistics)
- [x] Support multiple target families (generic, ice40, ecp5, xilinx)
- [x] Generate JSON output for future DigitalJS integration

### Files Created
- `src/yosys-runner.ts` - Yosys execution with child_process spawn (270 lines)
- `src/yosys-types.ts` - TypeScript interfaces for Yosys (90 lines)
- Updated `src/extension.ts` - Integrated Yosys synthesis workflow (+170 lines)

### Implementation Details

**Generated Yosys Script**:
```yosys
# Read design
read_verilog input.v

# Elaborate
hierarchy -check -top topModule

# High-level synthesis
proc; opt; fsm; opt; memory; opt

# Technology mapping
techmap; opt

# Statistics
stat -width
write_verilog -noattr output_synth.v
write_json output.json
```

**Output structure**:
```
.clash-synth/
└── verilog/
    └── ClashSynth_PlusSigned.topEntity/
        ├── plus_signed.v              # Clash-generated Verilog
        └── yosys/
            ├── synth.ys               # Yosys script
            ├── plus_signed_synth.v    # Synthesized Verilog
            ├── plus_signed.json       # JSON netlist
            └── synthesis_stats.txt    # Statistics
```

**User workflow**:
1. Generate wrapper → Compile with Clash → **Synthesize with Yosys**
2. See real-time Yosys output in output channel
3. View synthesis statistics (cells, wires, area, cell types)
4. Open synthesized Verilog or view detailed statistics

### Statistics Parsed
- **Cell Count**: Number of logic cells in design
- **Wire Count**: Number of interconnections
- **Chip Area**: Area estimate (if liberty file provided)
- **Cell Types**: Breakdown by cell type ($add, $mux, etc.)

### Testing

To test Phase 6:
1. Launch Extension Development Host (F5)
2. Open test-project workspace
3. Synthesize plusSigned or multUnsigned
4. Click "Compile with Clash"
5. Click "Synthesize with Yosys"
6. Verify statistics appear in output
7. Check `.clash-synth/verilog/*/yosys/` for output files

**Dependencies**: Phase 5 complete ✅

---

## 📋 Phase 7: Polish & UX (NEXT)
{-# NOINLINE topEntity #-}
{-# OPAQUE topEntity #-}
```

### Testing
- Generate wrapper for plusSigned
- Verify imports are correct
- Verify type signature matches
- Verify annotation is valid

## ⚙️ Phase 5: Clash Integration

### Goals
Execute Clash compiler and handle output.

### Tasks
- [ ] Create terminal/process executor
- [ ] Build Clash command with proper arguments
- [ ] Execute compilation in workspace directory
- [ ] Capture stdout/stderr
- [ ] Parse Clash error messages
- [ ] Show errors in Problems panel
- [ ] Handle successful compilation
- [ ] Open generated Verilog file

### Files to Create/Modify
- `src/clash-compiler.ts` - Clash execution and error handling
- `src/extension.ts` - Register synthesize function command

### Command
```bash
cabal run clash -- ClashSynth_plusSigned --verilog
```

### Testing
- Synthesize plusSigned
- Verify Verilog is generated in verilog/ directory
- Test error handling with invalid function
- Verify diagnostics appear for errors

## 🔧 Phase 6: Yosys Integration

### Goals
Optionally run Yosys synthesis on generated Verilog.

### Research Completed ✅

Analyzed two existing VS Code extensions integrating Yosys:
- **digitaljs_code** (yuyichao): WebAssembly + DigitalJS visualization
- **vscode-edacation** (EDAcation): Native + WASM, full FPGA toolchain

**Recommendation**: Use child process with output streaming (like vscode-edacation)
- Real-time feedback in output channel
- Parse statistics and errors incrementally
- Better integration with Nix environment
- Full control over synthesis flow

See [docs/YOSYS_INTEGRATION_RESEARCH.md](docs/YOSYS_INTEGRATION_RESEARCH.md) for detailed analysis.

### Tasks
- [ ] Create YosysRunner class with child process spawning
- [ ] Generate Yosys synthesis scripts from templates
- [ ] Stream output to output channel with progress
- [ ] Parse synthesis statistics (cell count, wire count, area)
- [ ] Parse warnings/errors and create VS Code diagnostics
- [ ] Create yosys-types.ts with interfaces
- [ ] Show synthesis results with quick actions
- [ ] Handle different target technologies

### Files to Create/Modify
- `src/yosys-runner.ts` - Yosys execution with child_process spawn
- `src/yosys-types.ts` - TypeScript interfaces (YosysOptions, YosysSynthesisResult, etc.)
- `src/yosys-diagnostics.ts` - Parse errors/warnings to VS Code diagnostics
- `src/extension.ts` - Register yosys synthesis commands

### Yosys Script Template
```yosys
# Read design
read_verilog input.v

# Elaborate
hierarchy -check -top topEntity

# High-level synthesis
proc; opt; fsm; opt; memory; opt

# Map to generic gates
techmap; opt

# Generate statistics
stat -width

# Write outputs
write_verilog -noattr output_synth.v
write_json output.json  # For future DigitalJS integration
```

### Implementation Approach
```typescript
export class YosysRunner {
  async synthesize(verilogPath: string, topModule: string): Promise<YosysSynthesisResult> {
    const scriptPath = await this.generateScript(verilogPath, topModule);
    
    const yosys = spawn('yosys', ['-s', scriptPath]);
    let output = '';
    
    yosys.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      this.outputChannel.append(text);
    });
    
    return new Promise((resolve, reject) => {
      yosys.on('close', (code) => {
        if (code === 0) {
          resolve(this.parseStatistics(output));
        } else {
          reject(new Error(`Yosys failed: ${code}`));
        }
      });
    });
  }
}
```

### Testing
- Synthesize Clash-generated Verilog
- Verify statistics parsing (cell count, wires)
- Test error handling with invalid Verilog
- Test diagnostics are created correctly
- Verify output files in yosys/ directory

## 🎨 Phase 7: Polish & UX

### Goals
Improve user experience and robustness.

### Tasks
- [ ] Add progress notifications for long operations
- [ ] Implement cancellation for synthesis
- [ ] Add cleanup command for temp files
- [ ] Create output channel for detailed logs
- [ ] Add status bar items for synthesis state
- [ ] Improve error messages
- [ ] Add keyboard shortcuts
- [ ] Create context menu items
- [ ] Add file watchers for auto-resynth
- [ ] Write user documentation
- [ ] Create demo video/GIF

### Files to Create/Modify
- `src/extension.ts` - Status bar, output channel
- `README.md` - User documentation with screenshots
- `.vscode/keybindings.json` - Suggested shortcuts

### Testing
- End-to-end user workflow
- Error recovery scenarios
- Performance with large projects

## 📝 Documentation Tasks

- [ ] API documentation (TypeDoc)
- [ ] User guide with examples
- [ ] Troubleshooting guide
- [ ] Contributing guide
- [ ] Architecture diagrams
- [ ] Demo video

## 🧪 Testing Strategy

### Unit Tests
- Type signature parsing
- Monomorphic detection
- Template generation
- Command building

### Integration Tests
- HLS communication
- File operations
- Process execution

### E2E Tests
- Full synthesis workflow
- Multiple files
- Error scenarios

## 🚀 Future Enhancements

### v0.2.0
- Interactive port naming UI
- Batch synthesis of multiple functions
- Synthesis history and caching

### v0.3.0
- Custom synthesis templates
- Integration with GTKWave for waveform viewing
- FPGA board upload support

### v0.4.0
- Performance profiling
- Resource utilization visualization
- Timing analysis integration

## Development Commands

```bash
# Enter development environment
nix develop

# Install dependencies
npm install

# Compile extension
npm run compile

# Watch mode
npm run watch

# Run extension (or press F5)
code --extensionDevelopmentPath=$PWD

# Test Clash project
cd test-project
cabal build
cabal run clash -- Example.Project --verilog
```

## Next Immediate Steps

1. **Install npm dependencies**: Run `npm install` to get vscode-languageclient
2. **Start Phase 2**: Begin HLS integration implementation
3. **Test incrementally**: Test each function as it's implemented with the test-project

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- [Clash Documentation](https://clash-lang.org/)
- [Yosys Manual](https://yosyshq.net/yosys/)
- [HLS Repository](https://github.com/haskell/haskell-language-server)

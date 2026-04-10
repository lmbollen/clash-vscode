# Architecture Documentation

## Overview

This VS Code extension enables synthesis of Verilog from monomorphic Haskell functions using Clash and Yosys. The extension automates the process of creating wrapper modules, invoking Clash, and optionally running Yosys synthesis.

## Core Components

### 1. Haskell Language Server (HLS) Integration

**Purpose**: Detect and analyze Haskell functions in the workspace.

**Implementation Approach**:
- Use the `vscode-languageclient` package to communicate with HLS
- Leverage LSP features:
  - `textDocument/documentSymbol` - Get all symbols (functions, types, etc.) in a file
  - `textDocument/hover` - Get type information for a symbol
  - `textDocument/definition` - Navigate to function definitions
  
**Key Data**:
```typescript
interface FunctionInfo {
  name: string;
  range: Range;
  typeSignature: string | null;
  isMonomorphic: boolean;
  filePath: string;
}
```

### 2. Type Analysis

**Purpose**: Differentiate between monomorphic and polymorphic functions.

**Detection Strategy**:
- Parse type signatures from HLS hover information
- A function is monomorphic if its type signature contains no type variables (e.g., `a`, `b`, `dom`)
- Exception: Type variables that are constrained to specific types via type classes may still be synthesizable

**Examples**:
```haskell
-- Monomorphic - can synthesize
plusSigned :: Signed 8 -> Signed 8 -> Signed 8

-- Polymorphic - cannot directly synthesize
plusPoly :: (Num a) => a -> a -> a

-- Monomorphic (concrete clock domain) - can synthesize
topEntity :: Clock Dom50 -> Signal Dom50 (Unsigned 8) -> Signal Dom50 (Unsigned 8)
```

**Type Signature Analysis**:
- No lowercase type variables = monomorphic
- Concrete types only (Signed, Unsigned, Clock DomXXX, etc.) = monomorphic
- Has unconstrained type variables (a, b, n) = polymorphic

### 3. Code Generation

**Purpose**: Generate a wrapper module for Clash synthesis.

**Process**:
1. Create a temporary module file (e.g., `ClashSynth_FunctionName.hs`)
2. Import the original module
3. Create a `topEntity` that wraps the target function
4. Add `Synthesize` annotation with port names
5. Add `NOINLINE` and `OPAQUE` pragmas

**Template**:
```haskell
{-# OPTIONS_GHC -Wno-orphans #-}
module ClashSynth_FunctionName where

import Clash.Prelude
import qualified OriginalModule

-- topEntity wrapper
topEntity :: <concrete types from original function>
topEntity = OriginalModule.targetFunction

-- Synthesize annotation
{-# ANN topEntity
  (Synthesize
    { t_name = "synth_functionname"
    , t_inputs = [ PortName "IN0", PortName "IN1", ... ]
    , t_output = PortName "OUT"
    }) #-}

{-# NOINLINE topEntity #-}
{-# OPAQUE topEntity #-}
```

### 4. Clash Compilation

**Purpose**: Invoke Clash to generate Verilog.

**Command**:
```bash
cabal run clash -- ClashSynth_FunctionName --verilog
```

**Output**:
- Verilog files generated in `verilog/` directory
- Can also generate VHDL (`--vhdl`) or SystemVerilog (`--systemverilog`)

**Error Handling**:
- Parse Clash error messages
- Show diagnostics in VS Code Problems panel
- Highlight issues in the source code

### 5. Yosys Integration (Optional)

**Purpose**: Further synthesis and optimization of generated Verilog.

**Command**:
```bash
yosys -p "read_verilog verilog/synth_functionname.v; show"
```

**Features**:
- Technology mapping
- Optimization
- Visualization of synthesized circuit
- Generate formats for FPGA tools (Xilinx, Intel, etc.)

## Extension Commands

### 1. Detect Functions
**Command**: `clash-vscode-yosys.detectFunctions`

**Action**:
- Scan current file or workspace for Haskell functions
- Show QuickPick list of detected functions with type signatures
- Indicate which are monomorphic (synthesizable)

### 2. Synthesize Function
**Command**: `clash-vscode-yosys.synthesizeFunction`

**Action**:
- Prompt user to select a monomorphic function
- Generate wrapper module
- Run Clash compilation
- Show output in terminal
- Open generated Verilog file

### 3. Run Yosys
**Command**: `clash-vscode-yosys.runYosys`

**Action**:
- Run Yosys on the latest generated Verilog
- Show synthesis report
- Optionally show schematic visualization

## Data Flow

```
User Code (Haskell)
       ↓
   HLS Analysis
       ↓
Function Detection & Type Analysis
       ↓
   [User Selects Function]
       ↓
Wrapper Module Generation
       ↓
    Clash Compilation
       ↓
   Verilog Output
       ↓
  (Optional) Yosys Synthesis
```

## File Organization

### Temporary Files
- Location: `.clash-synth/` directory in workspace root
- Files: `ClashSynth_<FunctionName>.hs`
- Cleanup: Option to keep or delete after synthesis

### Output Files
- Verilog: `verilog/` directory (Clash default)
- Yosys: `.clash-synth/yosys-output/`

## Configuration

### Extension Settings

```json
{
  "clash-vscode-yosys.clashCommand": "cabal run clash --",
  "clash-vscode-yosys.skipCommandValidation": false,
  "clash-vscode-yosys.yosysCommand": "yosys",
  "clash-vscode-yosys.outputFormat": "verilog",
  "clash-vscode-yosys.autoCleanup": true,
  "clash-vscode-yosys.showYosysSchematic": false
}
```

The `clashCommand` setting is validated on extension activation by running it with `--version`. Supported values include:
- `cabal run clash --` (default, for Cabal projects)
- `stack exec clash --` (for Stack projects)
- `nix run .#clash --` (for Nix flake projects)
- `clash` (if Clash is in your PATH)

If you use direnv or nix-shell and get validation errors, set `skipCommandValidation` to `true`.

## Implementation Phases

### Phase 1: HLS Integration ✓ (Current)
- Set up development environment
- Create test Clash project
- Establish basic extension structure

### Phase 2: Function Detection
- Integrate with HLS via Language Client
- Query document symbols
- Parse type signatures from hover info
- Display function list in UI

### Phase 3: Type Analysis
- Implement monomorphic detection algorithm
- Test with various type signatures
- Handle edge cases (type families, constrained types)

### Phase 4: Code Generation
- Template engine for wrapper modules
- Port name generation
- Module import resolution
- File system operations

### Phase 5: Clash Integration
- Execute Clash compilation
- Parse and display errors
- Handle compilation output
- Manage generated files

### Phase 6: Yosys Integration
- Execute Yosys commands
- Parse synthesis reports
- Optional schematic display
- Technology mapping options

### Phase 7: Polish
- Error handling and recovery
- User experience improvements
- Documentation
- Testing and validation

## Technical Challenges

### Challenge 1: Type Variable Detection
**Problem**: Distinguishing between type variables that need instantiation vs. those that are specialized.

**Solution**: Parse type signatures and check for:
- Unbound type variables (lowercase identifiers)
- Type class constraints
- Concrete type applications

### Challenge 2: Module Import Paths
**Problem**: Correctly importing the original module in wrapper.

**Solution**: 
- Use `hie.yaml` to determine source paths
- Parse module declarations
- Handle qualified imports

### Challenge 3: Port Naming
**Problem**: Generating meaningful port names for multi-argument functions.

**Solution**:
- Parse function parameters from source if available
- Fall back to `IN0`, `IN1`, etc.
- Allow user customization in settings

### Challenge 4: Clock/Reset/Enable Handling
**Problem**: Functions may use implicit or explicit clock/reset/enable signals.

**Solution**:
- Detect HiddenClockResetEnable constraint
- Auto-generate exposeClockResetEnable wrapper if needed
- Handle both explicit and implicit variants

## Testing Strategy

### Unit Tests
- Type signature parsing
- Monomorphic detection
- Template generation

### Integration Tests
- HLS communication
- Clash compilation
- File operations

### End-to-End Tests
- Full synthesis workflow
- Error recovery
- Multiple file handling

## Future Enhancements

1. **Interactive Port Configuration**: UI for customizing port names and directions
2. **Batch Synthesis**: Synthesize multiple functions at once
3. **Synthesis Presets**: Templates for common patterns (FSM, ALU, etc.)
4. **Waveform Viewer Integration**: Connect with GTKWave or similar
5. **FPGA Upload**: Direct upload to FPGA boards
6. **Performance Metrics**: Report resource utilization, timing

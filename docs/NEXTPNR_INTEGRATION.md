# Nextpnr Place-and-Route Integration

## Overview
Added full FPGA implementation support with nextpnr place-and-route for ECP5 FPGAs. The extension now provides a complete workflow from Haskell function to FPGA bitstream.

## Architecture

### Complete Flow
```
Haskell Function
    ↓ [HLS Detection]
Type Analysis
    ↓ [Monomorphic Check]
Clash Wrapper Generation
    ↓ [Code Generator]
Verilog (Clash)
    ↓ [Clash Compiler]
JSON Netlist (Yosys)
    ↓ [Yosys Synthesizer]
Placed & Routed Design (nextpnr)
    ↓ [nextpnr-ecp5]
FPGA Bitstream (ecppack)
```

### New Components

#### 1. nextpnr-types.ts
Type definitions for nextpnr integration:
- `NextpnrFamily`: Supported FPGA families (ecp5, ice40, gowin, nexus, machxo2, generic)
- `ECP5Device`: Device variants (25k, 45k, 85k LUTs with UM and UM5G variants)
- `ECP5Package`: Package types (CABGA, CSFBGA in various pin counts)
- `NextpnrOptions`: Configuration for place-and-route
- `NextpnrResult`: Results including timing, utilization, and output files
- `TimingInfo`: Timing analysis data (frequency, critical path, slack)
- `UtilizationInfo`: Resource usage (LUTs, registers, BRAM, DSP, IO)

#### 2. nextpnr-runner.ts
Executes nextpnr place-and-route:
- `placeAndRoute()`: Main entry point for PnR
- `buildNextpnrArgs()`: Constructs command-line arguments
- `runNextpnr()`: Spawns nextpnr process with real-time output
- `runEcppack()`: Generates bitstream from textual config
- `parseTiming()`: Extracts timing information from output
- `parseUtilization()`: Extracts resource utilization data

#### 3. Extension Integration
New command: `clash-vscode-yosys.synthesizeAndPnR`
- Interactive function selection
- Device/package selection for ECP5
- Full workflow orchestration
- Progress tracking with VS Code notifications
- Comprehensive results display

## ECP5 Support

### Available Devices
| Device | LUT Count | Description |
|--------|-----------|-------------|
| 25k | 24,000 | Small ECP5 (LFE5U-25F) |
| 45k | 44,000 | Medium ECP5 (LFE5U-45F) |
| 85k | 84,000 | Large ECP5 (LFE5U-85F) |

Variants:
- Standard (LFE5U-*): Base ECP5
- UM (LFE5UM-*): With SerDes
- UM5G (LFE5UM5G-*): With 5G SerDes

### Packages
- **CABGA256**: 256-ball BGA
- **CABGA381**: 381-ball BGA (common)
- **CABGA554**: 554-ball BGA
- **CABGA756**: 756-ball BGA (large)
- **CSFBGA285/381/554**: Chip-scale BGA variants

### Speed Grades
- **6**: Commercial temperature range
- **7**: Extended temperature range
- **8**: Industrial temperature range

## Usage

### Command Palette
1. Open a Haskell file with Clash functions
2. Run command: **Clash: Synthesize and Place & Route**
3. Select function to implement
4. Choose ECP5 device (25k/45k/85k)
5. Select package type
6. Wait for complete implementation

### Output Files
Generated in `.clash/` directory with organized project structure:
```
.clash/
└── {ModuleName}.{FunctionName}/        # e.g., Example.Project.plusSigned
    ├── 01-haskell/
    │   └── ClashSynth_FunctionName.hs  # Generated wrapper
    ├── 02-verilog/
    │   └── ModuleName.topEntity/
    │       ├── function_name.v          # Clash-generated Verilog
    │       └── ...                      # Helper files
    ├── 03-yosys/
    │   ├── function_name_synth.v        # Synthesized Verilog
    │   ├── function_name.json           # Yosys JSON netlist
    │   ├── synthesis_stats.txt          # Synthesis statistics
    │   ├── yosys.log                    # Complete Yosys output log
    │   └── statistics.txt               # Formatted statistics report
    └── 04-nextpnr/
        ├── function_name.config         # Textual configuration
        ├── function_name.bit             # FPGA bitstream
        ├── nextpnr.log                  # Complete nextpnr output log
        ├── ecppack.log                  # Bitstream generation log
        ├── timing.txt                   # Formatted timing analysis report
        └── utilization.txt              # Formatted resource utilization report
```

Each function synthesis creates its own isolated directory under `.clash/` with a fully qualified name (module + function). The numbered subdirectories (01-04) organize outputs by build stage:

1. **01-haskell**: Generated Clash wrapper modules
2. **02-verilog**: Clash-generated Verilog and helper files
3. **03-yosys**: Synthesis results, netlists, and statistics
4. **04-nextpnr**: Place-and-route results, bitstreams, and reports

Each tool's complete output is saved to a log file for debugging and analysis:
- **yosys.log**: Full Yosys synthesis output
- **statistics.txt**: Formatted Yosys statistics (cells, wires, area, cell types)
- **nextpnr.log**: Full nextpnr place-and-route output
- **timing.txt**: Formatted timing analysis (frequency, critical path, slack, constraints)
- **utilization.txt**: Formatted resource utilization with visual bars
- **ecppack.log**: Bitstream generation output

### Example Workflow
```haskell
-- Example.hs
import Clash.Prelude

plusSigned :: Signed 8 -> Signed 8 -> Signed 8
plusSigned a b = a + b
```

1. **Function Detection**: HLS finds `plusSigned`
2. **Type Analysis**: Validates `Signed 8 -> Signed 8 -> Signed 8` is monomorphic
3. **Wrapper Generation**: Creates `ClashSynth_PlusSigned.hs` with `Synthesize` annotation
   - Saved to: `.clash/Example.Project.plusSigned/01-haskell/`
4. **Clash Compilation**: Generates `plus_signed.v` Verilog
   - Saved to: `.clash/Example.Project.plusSigned/02-verilog/`
5. **Yosys Synthesis**: Optimizes to ECP5 primitives, outputs JSON
   - Saved to: `.clash/Example.Project.plusSigned/03-yosys/`
6. **nextpnr PnR**: Places and routes onto ECP5-25F-CABGA381
   - Saved to: `.clash/Example.Project.plusSigned/04-nextpnr/`
7. **ecppack**: Generates `plus_signed.bit` bitstream
   - Bitstream: `.clash/Example.Project.plusSigned/04-nextpnr/plus_signed.bit`

## Results Display

### Timing Report
```
Timing Analysis:
----------------------------------------
  Max Frequency: 125.30 MHz
  Critical Path: 7.98 ns
  Constraints: ✓ MET
```

### Resource Utilization
```
Resource Utilization:
----------------------------------------
  LUTs:      245/24000 (1.0%)
  Registers: 178/24000 (0.7%)
  BRAM:      0/56 (0.0%)
  IO:        18/197 (9.1%)
```

### Generated Report Files

Each synthesis run generates detailed report files in the output directory:

**statistics.txt** (Yosys):
```
Yosys Synthesis Statistics Report
============================================================
Generated: 2026-03-27T10:30:00.000Z

Number of Cells:    245
Number of Wires:    312
Chip Area:          1234.56

Cell Types:
----------------------------------------
  $lut                         125
  $dff                          78
  $add                          32
  $mux                          10

Raw Statistics:
------------------------------------------------------------
[Complete Yosys statistics output]
```

**timing.txt** (nextpnr):
```
Timing Analysis Report
============================================================
Generated: 2026-03-27T10:30:15.000Z

Maximum Frequency:     125.30 MHz
Critical Path Delay:   7.981 ns
Setup Slack:           0.234 ns [PASS]
Hold Slack:            0.145 ns [PASS]

Overall Status:        ✓ CONSTRAINTS MET
```

**utilization.txt** (nextpnr):
```
Resource Utilization Report
============================================================
Generated: 2026-03-27T10:30:15.000Z

LUTs              245 / 24000  (  1.02%)  [█░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
Registers         178 / 24000  (  0.74%)  [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
BRAM/EBR            0 / 56     (  0.00%)  [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
DSP                 0 / 28     (  0.00%)  [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
IO                 18 / 197    (  9.14%)  [███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
```

All tool outputs are also saved to log files (yosys.log, nextpnr.log, ecppack.log) for debugging and detailed analysis.

## Dependencies

### Nix Flake
Added to `flake.nix`:
```nix
buildInputs = [
  nextpnr     # Provides nextpnr-ecp5, nextpnr-ice40, etc.
  prjtrellis  # ECP5 toolchain (includes ecppack)
];
```

### Tool Versions (NixOS unstable)
- nextpnr-ecp5: Latest from nixpkgs
- prjtrellis: Latest (includes ecppack, database files)
- yosys: 0.44+ (for JSON generation)

## Configuration Options

### Frequency Constraints
```typescript
{
  frequency: 100  // Target 100 MHz
}
```

### Reproducible Builds
```typescript
{
  seed: 42  // Deterministic placement
}
```

### Constraints File
```typescript
{
  constraintsFile: 'design.lpf'  // Pin constraints
}
```

Example LPF (Lattice Preference File):
```lpf
LOCATE COMP "clk" SITE "P3";
IOBUF PORT "clk" IO_TYPE=LVCMOS33;
FREQUENCY PORT "clk" 100.0 MHZ;

LOCATE COMP "led[0]" SITE "B2";
IOBUF PORT "led[0]" IO_TYPE=LVCMOS33;
```

## Future Extensions

### Additional FPGA Families
- **iCE40**: Lattice low-power FPGAs
- **Gowin**: Chinese FPGA vendor
- **Nexus**: Lattice next-gen
- **MachXO2**: Lattice CPLDs

### Advanced Features
- Custom timing constraints per signal
- Floor planning hints
- Multi-clock domain support
- Power optimization flags
- Bitstream encryption (where supported)

### Integration Ideas
- Direct FPGA programming via openFPGALoader
- Interactive timing analysis viewer
- Resource usage visualization
- Design hierarchy browser
- Automated regression testing

## Testing

### Manual Testing
1. Open `test-project/src/Example/Project.hs`
2. Run **Synthesize and Place & Route** on `plusSigned`
3. Select ECP5-25F with CABGA381
4. Verify all files are generated
5. Check timing report shows positive slack
6. Verify bitstream file exists

### Expected Output
- No errors during any phase
- Timing constraints met
- Resource usage < 2% for simple designs
- Bitstream file is 590-620 KB (typical for ECP5-25F)

## Troubleshooting

### nextpnr not found
**Solution**: Rebuild Nix shell
```bash
nix flake update
nix develop
```

### Timing constraints not met
**Symptoms**: Negative slack reported
**Solutions**:
- Reduce target frequency
- Simplify design logic
- Add pipeline stages in Clash
- Try different placement seed

### Resource over-utilization
**Symptoms**: "No legal placement" error
**Solutions**:
- Choose larger device (45k or 85k)
- Optimize Clash code
- Reduce bit widths
- Share resources

### Bitstream generation failed
**Symptoms**: No .bit file generated
**Check**:
- ecppack is in PATH
- Textual config (.config) exists
- Device/package match specifications

## Related Documentation
- [MULTI_FILE_VERILOG.md](MULTI_FILE_VERILOG.md): Multi-file Verilog support
- [TESTING_PHASE6.md](TESTING_PHASE6.md): Yosys integration testing
- [PHASE5_COMPLETE.md](PHASE5_COMPLETE.md): Clash compiler integration

## References
- nextpnr documentation: https://github.com/YosysHQ/nextpnr
- ECP5 architecture: https://www.latticesemi.com/ecp5
- Project Trellis: https://github.com/YosysHQ/prjtrellis
- Yosys JSON format: https://yosyshq.readthedocs.io/projects/yosys/en/latest/cmd/write_json.html

# Circuit Diagram Visualization

## Overview
The extension automatically generates interactive circuit diagrams for every synthesis run, showing both the high-level RTL structure and the synthesized gate-level implementation.

## Features

### Two-View Visualization

**RTL View (Before Synthesis)**
- Shows the circuit as described in the original Verilog from Clash
- Displays high-level components: registers, multiplexers, adders, etc.
- Represents the logical structure before optimization
- Useful for understanding the design intent

**Gate-Level View (After Synthesis)**
- Shows the optimized circuit mapped to FPGA primitives
- Displays actual hardware: LUTs, flip-flops, DSP blocks, etc.
- Represents how the design will be implemented on silicon
- Useful for analyzing resource usage and optimization

### Interactive Webview

The diagram viewer provides:
- **Tabbed interface**: Switch between RTL and gate-level views
- **Zoom controls**: Zoom in/out and reset to fit
- **Scrolling**: Navigate large diagrams
- **VS Code integration**: Respects your theme colors
- **Always available**: Diagrams saved as SVG files for later viewing

## Usage

### Automatic Generation

Diagrams are automatically generated during synthesis. After Yosys completes, you'll see:

```
Output files:
  Synthesized Verilog: .clash/Module.Function/03-yosys/function_synth.v
  JSON output: .clash/Module.Function/03-yosys/function.json
  RTL diagram: .clash/Module.Function/03-yosys/function_rtl.svg
  Gate-level diagram: .clash/Module.Function/03-yosys/function_gate.svg
```

### Viewing Diagrams

<When synthesis completes, click **"View Circuit Diagrams"** in the notification popup.

Or manually open the SVG files from your workspace:
```bash
# View in default browser or SVG viewer
.clash/Module.Function/03-yosys/function_rtl.svg
.clash/Module.Function/03-yosys/function_gate.svg
```

### Diagram Controls

**Tabs**: Click "RTL View" or "Gate-Level View" to switch

**Zoom**:
- Zoom In: Enlarge the diagram
- Zoom Out: Shrink the diagram
- Reset: Return to 100% zoom

## How It Works

### Yosys Integration

The extension uses Yosys's built-in `show` command to generate diagrams:

```tcl
# Generate RTL diagram (before synthesis)
show -format svg -prefix output/module_rtl top_module

# ... synthesis happens here ...

# Generate gate-level diagram (after synthesis)
show -format svg -prefix output/module_gate
```

### SVG Format

Diagrams are generated as scalable SVG (Scalable Vector Graphics):
- ✅ Infinite zoom without quality loss
- ✅ Small file size
- ✅ Text remains selectable and searchable
- ✅ Works in any modern browser or viewer

### Graphviz Dependency

Yosys uses Graphviz internally to generate diagrams. The Nix flake includes this automatically:

```nix
buildInputs = [
  yosys
  graphviz  # Required for diagram generation
];
```

## Example Output

### Simple Adder Function

```haskell
plusSigned :: Signed 8 -> Signed 8 -> Signed 8
plusSigned a b = a + b
```

**RTL Diagram** shows:
- Input ports: `a`, `b` (8-bit signed)
- Adder component
- Output port: `result` (8-bit signed)

**Gate-Level Diagram** shows:
- LUT cells for bit-level addition
- Carry chain logic
- I/O buffers

### State Machine

```haskell
accum :: HiddenClockResetEnable dom
      => Signal dom (Signed 8)
      -> Signal dom (Signed 8)
accum = mealy accumT 0
  where
    accumT s x = (s + x, s)
```

**RTL Diagram** shows:
- Register for state
- Adder for accumulation
- Feedback loop

**Gate-Level Diagram** shows:
- DFF (flip-flop) cells
- LUT cells for addition
- Clock and reset routing

## Understanding Diagrams

### RTL View Components

| Symbol | Meaning |
|--------|---------|
| Rectangle | Register/Flip-flop |
| Diamond | Multiplexer |
| Circle with + | Adder |
| Circle with * | Multiplier |
| Trapezoid | Memory block |

### Gate-Level Components

| Symbol | Meaning (ECP5) |
|--------|----------------|
| LUT4 | 4-input lookup table |
| DFF | D-type flip-flop |
| MULT18X18 | 18x18 multiplier |
| DP16K | 16K block RAM |
| IOB | I/O buffer |

### Colors (Theme-Dependent)

VS Code theme colors are respected:
- **Foreground**: Text and labels
- **Background**: Diagram background
- **Borders**: Component outlines
- **Highlights**: Selected elements

## Diagram Files

Diagrams are saved to `.clash/{Module.Function}/03-yosys/`:

```
03-yosys/
├── function_name_rtl.svg      # RTL view diagram
├── function_name_gate.svg     # Gate-level view diagram
├── function_name_synth.v      # Synthesized Verilog
└── synth.ys                   # Yosys script used
```

These SVG files can be:
- Opened in any modern browser
- Embedded in documentation
- Shared with team members
- Archived with design files
- Converted to PDF/PNG if needed

## Configuration

### Enabling/Disabling Diagrams

By default, diagrams are generated for all synthesis runs. To disable:

1. The feature is controlled by `generateDiagrams` parameter in `YosysOptions`
2. Currently always enabled - can be made configurable via VS Code settings in future

### Customizing Diagram Appearance

Yosys diagram generation can be customized via the generated script. Future enhancements could include:

- Component colors
- Layout direction (top-down, left-right)
- Node spacing
- Font sizes
- Show/hide specific signal types

## Performance

### Generation Time

Diagram generation adds ~1-2 seconds to synthesis:
- Simple designs (< 100 cells): < 1 second
- Medium designs (100-1000 cells): 1-2 seconds
- Large designs (> 1000 cells): 2-5 seconds

### File Sizes

SVG diagrams are typically small:
- Small designs: 10-50 KB
- Medium designs: 50-200 KB
- Large designs: 200KB - 1MB

Very large diagrams may be hard to navigate interactively.

## Troubleshooting

### Diagrams Not Generated

**Symptom**: No .svg files in output directory

**Possible causes**:
1. Graphviz not installed
   - **Solution**: Nix flake should include it automatically
   - **Manual check**: `which dot` should show graphviz path

2. Yosys version too old
   - **Solution**: Update to Yosys 0.9+ (Nix provides latest)

3. Synthesis failed before diagram generation
   - **Solution**: Check Yosys log for earlier errors

### Diagram Viewer Shows Error

**Symptom**: "Diagram not found" message in webview

**Possible causes**:
1. SVG file was not generated
2. File permissions issue
3. Path resolution problem

**Solution**: Check that SVG files exist:
```bash
ls -la .clash/*/03-yosys/*.svg
```

### Diagram Too Large to View

**Symptom**: Diagram is huge and hard to navigate

**Solutions**:
1. Use zoom out to see overview
2. Open SVG directly in browser with better pan/zoom
3. Simplify design or split into modules
4. View synthesized verilog code instead

### Webview Not Opening

**Symptom**: Click "View Circuit Diagrams" but nothing happens

**Solutions**:
1. Check VS Code console for errors (Help → Toggle Developer Tools)
2. Try reloading VS Code window
3. Check SVG files manually

## Advanced Use Cases

### Comparing Before/After Optimizations

Generate diagrams for different optimization levels:

1. Synthesize with default settings → Save RTL/gate diagrams
2. Modify Clash code with optimizations
3. Synthesize again → Compare new diagrams
4. Analyze resource usage differences

### Educational Use

Diagrams are excellent for:
- Teaching hardware design concepts
- Understanding Clash compilation
- Explaining FPGA architecture
- Visualizing state machines
- Debugging logic errors

### Documentation

Include diagrams in:
- Design documentation
- Technical reports
- Research papers
- README files
- Wiki pages

Export SVG to PDF for print documents:
```bash
inkscape function_rtl.svg --export-pdf=function_rtl.pdf
```

## Comparison to Other Tools

### vs DigitalJS
- **DigitalJS**: Interactive simulation, can modify and test circuits
- **Our extension**: Static visualization, focused on synthesis flow
- **Advantage**: Integrated into Clash workflow, shows actual FPGA mapping

### vs EDACation
- **EDACation**: Full EDA suite with multiple tools
- **Our extension**: Focused on Clash → FPGA workflow
- **Advantage**: Simpler, specialized for Clash users

### vs Yosys Show Command
- **Yosys CLI**: Manual command, separate viewer needed
- **Our extension**: Automatic generation, integrated viewer
- **Advantage**: Seamless workflow, no manual steps

## Future Enhancements

Planned features:
- [ ] Interactive signal tracing
- [ ] Highlight critical path in timing view
- [ ] Annotate utilization per component
- [ ] Export to multiple formats (PNG, PDF)
- [ ] Differential view (compare two versions)
- [ ] Custom color schemes
- [ ] Component filtering/hiding
- [ ] Search functionality

## Related Documentation
- [NEXTPNR_INTEGRATION.md](NEXTPNR_INTEGRATION.md): Place-and-route integration
- [DIRECTORY_STRUCTURE.md](DIRECTORY_STRUCTURE.md): Output file organization
- [TESTING_PHASE6.md](TESTING_PHASE6.md): Yosys integration details

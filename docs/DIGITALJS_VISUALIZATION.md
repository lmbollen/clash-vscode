# Interactive Circuit Visualization with DigitalJS

This extension provides **interactive circuit visualization** using [DigitalJS](https://digitaljs.tilk.eu/) - a visual circuit simulator that allows you to see and simulate your synthesized hardware in real-time.

## Features

- **Interactive Simulation**: Click to interact with inputs, see signal propagation in real-time
- **Visual Circuit Diagrams**: Automatic generation from Yosys synthesis output
- **Built on DigitalJS**: Uses the same powerful simulator as [digitaljs.tilk.eu](https://digitaljs.tilk.eu/)
- **Integrated Workflow**: Automatically generated after every synthesis
- **Pan and Zoom**: Navigate large circuits easily with mouse controls
- **Simulation Controls**: Start, pause, reset simulation with toolbar buttons
- **Real-time Updates**: See circuit behavior as you interact with it

## Usage

### Viewing Circuit Diagrams

1. **Synthesize a Function**: Run `Clash: Synthesize Function to Verilog` or `Clash: Synthesize and Place & Route`
2. **Open the Viewer**: After synthesis completes, click **"View Interactive Circuit"** in the notification
3. **Interact with the Circuit**:
   - Click **▶ Start** to begin simulation
   - Click gates and components to inspect them
   - Drag to pan around the circuit
   - **Scroll** or use **mouse wheel** to zoom in/out
   - Click **🔍+ Zoom In** / **🔍− Zoom Out** buttons
   - Click **🔍 Fit** to auto-fit the circuit to the viewport
   - Use keyboard shortcuts: **Ctrl/Cmd +** (zoom in), **Ctrl/Cmd -** (zoom out), **Ctrl/Cmd 0** (fit)

### Simulation Controls

- **Start (▶)**: Begin real-time circuit simulation
- **Pause (⏸)**: Pause the simulation
- **Reset (⟲)**: Reset circuit to initial state
- **Zoom In (🔍+)**: Zoom in to see details
- **Zoom Out (🔍−)**: Zoom out for overview
- **Fit (🔍)**: Auto-fit circuit to viewport

## How It Works

### Behind the Scenes

The extension uses **yosys2digitaljs** which handles the entire synthesis and conversion process:

1. **Read Verilog Files**: All `.v` files from Clash output are collected
2. **Yosys Synthesis**: yosys2digitaljs runs Yosys internally to synthesize the design
3. **Automatic Cleanup**: Removes unsupported cells like `$specify2` timing specs
4. **DigitalJS Conversion**: Converts the netlist to DigitalJS format
5. **Interactive Rendering**: Circuit is rendered with JointJS/Backbone.js
6. **Real-time Simulation**: DigitalJS simulates the circuit in your browser

**Key Insight**: Unlike our initial approach, we don't run Yosys separately. Instead, `yosys2digitaljs.process_files()` handles the entire workflow automatically, ensuring compatibility with DigitalJS.

### Technology Stack

- **yosys2digitaljs**: All-in-one Verilog → DigitalJS converter (includes Yosys)
- **DigitalJS**: JavaScript circuit simulator and visualizer
- **JointJS**: Diagramming library for circuit rendering
- **VS Code Webview**: Hosts the interactive viewer

## Output Files

After synthesis, you'll find:

```
.clash/
└── Module.Function/
    ├── 03-yosys/
    │   ├── TopModule.json          # Yosys JSON netlist (for DigitalJS)
    │   ├── TopModule_synth.v       # Synthesized Verilog
    │   ├── yosys.log               # Full Yosys output
    │   └── statistics.txt          # Formatted statistics
    └── 04-nextpnr/                 # (if running full PnR flow)
```

### File Descriptions

- **TopModule.json**: Yosys JSON netlist used by DigitalJS for visualization
- **TopModule_synth.v**: Synthesized Verilog netlist
- **yosys.log**: Complete Yosys synthesis log
- **statistics.txt**: Resource usage statistics

## Dependencies

### Node.js Packages (Included)

The extension includes these npm packages:
- `digitaljs`: Circuit simulator and renderer
- `yosys2digitaljs`: Converts Yosys JSON to DigitalJS format

These are automatically installed with `npm install` when building the extension.

### No Graphviz Required

Unlike static SVG diagram generation, **DigitalJS does not require Graphviz**. It renders circuits using JointJS directly from Yosys JSON output.

## Troubleshooting

### Circuit viewer shows error

**Problem**: "Failed to load circuit" error in webview

**Solutions**:
1. Check that JSON file was generated: `.clash/Module.Function/03-yosys/TopModule.json`
2. Look for yosys2digitaljs conversion errors in Output panel
3. Verify Yosys synthesis completed successfully
4. Check for unsupported Verilog constructs

### Circuit is too large/complex

**Problem**: Viewer is slow or circuit doesn't display

**Solutions**:
1. Try with a simpler function first
2. Use the zoom controls to focus on specific areas
3. Click "Fit" to auto-adjust viewport
4. Check browser console for JavaScript errors (Help > Toggle Developer Tools)

### Simulation doesn't work

**Problem**: Circuit displays but simulation doesn't run

**Solutions**:
1. Click the "Start" button to begin simulation
2. Check that there are inputs you can interact with
3. For combinational circuits, changes should be instant
4. For sequential circuits, you may need a clock signal

**For more troubleshooting help, see [DIGITALJS_TROUBLESHOOTING.md](DIGITALJS_TROUBLESHOOTING.md)**

## Comparison with Other Tools

### vs. Static SVG Diagrams

**Previous approach** (Yosys `show` command):
- Static SVG images
- No interactivity
- Two separate views (RTL and gate-level)
- Requires Graphviz

**DigitalJS approach** (current):
- Interactive simulation
- Click to interact with inputs
- Real-time signal propagation
- Pan, zoom, and inspect components
- No Graphviz required

### vs. digitaljs_code Extension

The [digitaljs_code](https://marketplace.visualstudio.com/items?itemName=yuyichao.digitaljs) extension by yuyichao is a standalone tool for Verilog visualization. Our integration:
- **Integrates with Clash workflow**: Automatic synthesis from Haskell
- **FPGA-focused**: Tied to ECP5 place-and-route flow
- **Simplified**: One-click from Haskell to interactive circuit
- **Educational**: Shows Clash → Verilog → Circuit transformation

### vs. EDACation Extension

The [EDACation](https://marketplace.visualstudio.com/items?itemName=edacation.edacation) extension provides a full EDA suite. Key differences:
- **EDACation**: Comprehensive FPGA development environment
- **This extension**: Focused on Clash HDL workflow
- **EDACation**: Native tool support + WebAssembly
- **This extension**: Uses local Nix environment
- **Both**: Use nextpnr for place-and-route, DigitalJS for visualization

## Example: plusSigned Function

After synthesizing the `plusSigned` function:

```haskell
plusSigned :: Signed 8 -> Signed 8 -> Signed 8
plusSigned a b = a + b
```

The DigitalJS viewer will show:
- Input ports for `a` and `b` (8 bits each)
- Adder logic gates
- Output port for the result
- Interactive simulation showing addition in action

Click **Start** and interact with the inputs to see the adder working in real-time!

## Further Reading

- [DigitalJS Online Demo](https://digitaljs.tilk.eu/)
- [DigitalJS GitHub](https://github.com/tilk/digitaljs)
- [yosys2digitaljs GitHub](https://github.com/tilk/yosys2digitaljs)
- [Yosys Documentation](https://yosyshq.readthedocs.io/)
- [Clash Documentation](https://clash-lang.org/)

## Technical Details

### Zoom Implementation

The zoom functionality uses DigitalJS's native approach via `paper.scale()` rather than JointJS PaperScroller:

```javascript
// Zoom level tracking
let zoomLevel = 0;

// Apply zoom function (mirrors DigitalJS scaleAndRefreshPaper)
function applyZoom(scale) {
    paper.scale(Math.pow(1.1, scale));
    const graph = paper.model;
    paper.freeze();
    graph.resetCells(graph.getCells());
    paper.unfreeze();
}

// Mouse wheel zoom
$(paper.el).on('mousewheel DOMMouseScroll', function(evt) {
    const delta = evt.wheelDelta ? evt.wheelDelta : -evt.detail;
    if (delta > 0) zoomLevel++;
    else zoomLevel--;
    applyZoom(zoomLevel);
});
```

**Key insights:**
- DigitalJS's `circuit.displayOn()` returns a `joint.dia.Paper` object, not a `joint.ui.PaperScroller`
- Zoom is applied via `paper.scale(Math.pow(1.1, zoomLevel))`
- After scaling, the graph must be frozen, cells reset, and then unfrozen for proper rendering
- Zoom level increments/decrements by 1 for each mouse wheel step
- A zoom level of 0 represents 100% (1.1^0 = 1.0)
- Zoom level of 10 = 259% (1.1^10 ≈ 2.59), zoom level of -10 = 39% (1.1^-10 ≈ 0.39)
- This matches the approach used in the official DigitalJS web interface

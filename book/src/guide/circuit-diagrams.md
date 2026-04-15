# Circuit Diagrams

The extension provides interactive circuit visualization using [DigitalJS](https://github.com/tilk/digitaljs) in a VS Code webview panel.

## Viewing Diagrams

After Yosys synthesis, select **View Interactive Circuit** to open the diagram viewer. The viewer shows:

- Logic gates, flip-flops, multiplexers, and other standard cells
- Named wires and buses with bit widths
- Hierarchical module boundaries

## Controls

| Action | Input |
|--------|-------|
| Zoom in/out | Scroll wheel (cursor-centered) |
| Pan | Ctrl+drag or middle-mouse drag |
| Zoom to fit | **Fit** button in toolbar |

## Per-Module Diagrams

When using **per-module** synthesis mode, each component gets its own DigitalJS JSON file. After synthesis, select **View Module Diagrams** and pick a specific module from the list to view its individual circuit.

## How It Works

For the standard viewer, the extension uses [yosys2digitaljs](https://github.com/nickg/yosys2digitaljs) to convert Verilog directly into the DigitalJS circuit format in-process.

For per-module mode, Yosys writes JSON files directly via `write_json`, and the viewer loads these pre-generated files using `DiagramViewer.showDiagramFromJson()`.

## Troubleshooting

### Empty circuit / no devices shown

The design may have been optimized away by Yosys (e.g. constant outputs). Check the Yosys log in `.clash/…/03-yosys/yosys.log`.

### `$specify2` / `$specify3` errors

These timing specification cells are automatically removed before JSON export (`delete */t:$specify2 */t:$specify3`).

### Performance issues with large designs

Large designs with thousands of cells may be slow to render. Use per-module mode to view individual sub-modules instead.

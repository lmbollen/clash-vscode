# Clash Manifest Integration

The extension automatically reads and analyzes Clash manifest files (`clash-manifest.json`) to extract useful metadata about your design.

## What is the Clash Manifest?

When Clash compiles your Haskell HDL to Verilog, it generates a `clash-manifest.json` file in each output directory. This manifest contains:

- **Generated files**: List of all `.v`, `.sdc`, and `.cpp` files with SHA256 hashes
- **Dependencies**: Transitive dependencies on other top entities
- **Clock domains**: Timing information for each clock domain
- **Port information**: Detailed port metadata (direction, width, clock assignment)
- **Components**: List of sub-components in the design

## Benefits of Manifest Integration

### 1. Automatic Dependency Resolution

The extension recursively collects **all Verilog files** needed for synthesis:

```
✓ Collected 3 Verilog file(s):
  - top_entity.v
  - submodule_a.v
  - submodule_b.v
```

This ensures that designs with dependencies on other Clash-generated modules work correctly without manual file management.

**How it works:**
1. Clash compilation generates `clash-manifest.json` with `dependencies.transitive` array
2. Extension recursively finds and parses manifests for each dependency
3. All Verilog files are collected into a flat list
4. **This complete list is passed to Yosys**, ensuring all modules are available during hierarchy elaboration

Without this, you would see errors like:
```
ERROR: Module `\accum' referenced in module `\top_entity' in cell `\accum_OUT' is not part of the design.
```

### 2. Clock Domain Information

The manifest provides accurate clock frequency targets:

```json
"domains": {
  "System": {
    "active_edge": "Rising",
    "period": 10000,  // picoseconds
    "reset_kind": "Asynchronous",
    "reset_polarity": "ActiveHigh"
  }
}
```

The extension automatically:
- Calculates target frequency: `1_000_000 / period_ps = MHz`
- Identifies primary clock domain (uses "System" if available)
- Displays this in the output:

```
✓ Target frequency: 100.00 MHz (from System domain)
```

### 3. Clock and Reset Signal Detection

The manifest identifies which ports are clocks and resets:

```
✓ Clock signals: CLK, CLK50
✓ Reset signals: RST, ARST
```

This information can be used for:
- Timing constraint generation
- Automated pin assignment
- FPGA synthesis configuration

### 4. Port Metadata

Full port information is available programmatically:

```typescript
interface ClashPort {
  direction: 'in' | 'out';
  domain?: string;        // Which clock domain
  is_clock: boolean;
  name: string;
  type_name: string;      // e.g., "[7:0]" for buses
  width: number;
}
```

## How It Works

### 1. Clash Compilation

When you synthesize a function, Clash generates:
```
.clash/Module.Function/02-verilog/Module.Function/
├── clash-manifest.json    ← Metadata about the design
├── top_entity.v           ← Main Verilog file
├── component_a.v          ← Sub-component (if any)
└── top_entity.sdc         ← Timing constraints
```

### 2. Manifest Parsing

The extension automatically:
1. Locates `clash-manifest.json` in the Verilog output directory
2. Parses the JSON structure
3. Extracts useful metadata
4. Recursively resolves dependencies (if any)

### 3. File Collection

For designs with dependencies:

```
MyDesign depends on CoreModule
  ├── MyDesign/clash-manifest.json
  │   └── dependencies.transitive: ["CoreModule"]
  └── CoreModule/clash-manifest.json
      └── files: ["core.v", "utils.v"]
```

The extension traverses this dependency graph and collects **all** required Verilog files.

## Manifest Structure

### Complete Example

```json
{
  "components": ["my_component"],
  "dependencies": {
    "transitive": ["Other.Module.topEntity"]
  },
  "domains": {
    "System": {
      "active_edge": "Rising",
      "init_behavior": "Defined",
      "period": 10000,
      "reset_kind": "Asynchronous",
      "reset_polarity": "ActiveHigh"
    }
  },
  "files": [
    {
      "name": "my_component.v",
      "sha256": "abc123..."
    },
    {
      "name": "my_component.sdc",
      "sha256": "def456..."
    }
  ],
  "top_component": {
    "name": "my_component",
    "ports_flat": [
      {
        "direction": "in",
        "domain": "System",
        "is_clock": true,
        "name": "CLK",
        "type_name": "",
        "width": 1
      },
      {
        "direction": "in",
        "name": "DATA_IN",
        "type_name": "[7:0]",
        "width": 8
      },
      {
        "direction": "out",
        "name": "DATA_OUT",
        "type_name": "[7:0]",
        "width": 8
      }
    ]
  },
  "version": "1.8.1"
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `components` | List of component names in this design |
| `dependencies.transitive` | Other top entities this design depends on |
| `domains` | Clock domain configurations (period in picoseconds) |
| `files` | Generated files with SHA256 checksums |
| `top_component.ports_flat` | Complete port list with metadata |
| `version` | Clash version used for compilation |

## Future Enhancements

The manifest data can enable additional features:

### 1. Timing Constraint Generation

```sdc
# Auto-generated from clash-manifest.json
create_clock -period 10.000 [get_ports CLK]
create_clock -period 20.000 [get_ports CLK50]
```

### 2. Pin Constraint Templates

```lpf
# Generated from port metadata
LOCATE COMP "CLK" SITE "P3";
LOCATE COMP "DATA_IN[0]" SITE "P4";
...
```

### 3. Design Validation

- Verify all files are present
- Check SHA256 hashes for modifications
- Validate clock domain consistency
- Detect port mismatches with constraints

### 4. Dependency Visualization

Show the dependency graph of top entities:
```
MyTop
├── CoreModule
│   └── UtilPackage
└── IOInterface
```

## Implementation Details

### Type Definitions

See [`src/clash-manifest-types.ts`](../src/clash-manifest-types.ts) for complete TypeScript interfaces.

### Parser

See [`src/clash-manifest-parser.ts`](../src/clash-manifest-parser.ts) for:
- `parseManifest()`: Read and parse manifest file
- `collectAllVerilogFiles()`: Recursive dependency resolution with automatic deduplication
- `getClockResetPorts()`: Extract clock/reset information
- `generateTimingConstraints()`: Create SDC constraints

**Note on Deduplication**: When collecting Verilog files from dependencies, the same file may appear in multiple manifests (e.g., common utility modules). The `collectAllVerilogFiles()` function automatically deduplicates files by resolving them to absolute paths and keeping only unique entries. This prevents duplicate `read_verilog` commands in the generated Yosys synthesis script.

### Integration

The manifest is integrated into [`ClashCompiler`](../src/clash-compiler.ts):
- Automatically found after compilation
- Parsed and analyzed
- Results included in `ClashCompilationResult`
- Used by downstream tools (Yosys, DigitalJS)

**Top Module Detection**: The extension uses `manifest.top_component.name` to determine the correct top-level module for Yosys synthesis, instead of deriving it from the filename. This ensures accuracy even when the Verilog filename doesn't match the module name.

## Troubleshooting

### Manifest Not Found

If you see:
```
⚠ No manifest found, will use basic file discovery
```

**Causes:**
- Using an old Clash version (< 1.6)
- Manifest generation disabled
- Compilation failed before manifest creation

**Solution:** The extension falls back to directory scanning.

### Missing Dependencies

If Verilog files are missing despite having dependencies in the manifest:

**Check:**
1. Dependency top entities are compiled to the same HDL directory structure
2. Manifest paths are correct relative to the base directory
3. All dependencies are actually synthesized (not just imported)

### Clock Domain Issues

If target frequency is not detected:

**Verify:**
- At least one clock domain is defined in the manifest
- Domains have valid `period` values (in picoseconds)
- Port metadata includes `is_clock: true` for clock signals

## Related Documentation

- [Clash Documentation](https://clash-lang.org/documentation/)
- [Clash Manifest Specification](https://github.com/clash-lang/clash-compiler/blob/master/docs/manifest.md) (if available)

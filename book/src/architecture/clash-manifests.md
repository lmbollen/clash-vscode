# Clash Manifests

Clash generates a `clash-manifest.json` in each HDL output directory. The extension parses this to:

- Determine the top component name and ports
- Discover dependencies between components
- Extract clock domain information
- Collect all Verilog files (including sub-modules)

## Manifest Structure

```json
{
  "components": ["top_entity"],
  "dependencies": { "transitive": ["Example.Project.accum"] },
  "domains": {
    "Dom50": {
      "active_edge": "Rising",
      "init_behavior": "Defined",
      "period": 20000,
      "reset_kind": "Asynchronous",
      "reset_polarity": "ActiveHigh"
    }
  },
  "files": [
    { "name": "top_entity.v", "sha256": "..." },
    { "name": "top_entity.sdc", "sha256": "..." }
  ],
  "top_component": {
    "name": "top_entity",
    "ports_flat": [
      { "direction": "in", "is_clock": true, "name": "CLK", "width": 1 },
      ...
    ]
  }
}
```

## Dependency Graph

`ClashManifestParser.buildDependencyGraph()` recursively follows dependency manifests and returns components in post-order (leaves first, top last). Each component's `dependencies` list is reduced to **direct only** — transitive deps are removed via `removeTransitiveDeps` to prevent Yosys "Re-definition of module" errors during OOC synthesis.

## SDC Frequency Parsing

`parseSdcFrequency(manifestDir)` scans `.sdc` files in the manifest directory for `create_clock` constraints:

```
create_clock -name {CLK} -period 20.000 -waveform {0.000 10.000} [get_ports {CLK}]
```

The period in nanoseconds is converted to MHz: `frequency = 1000 / period`. This value is passed to nextpnr's `--freq` flag.

## Domain Analysis

Clock domain periods in the manifest are in **picoseconds**. The parser converts to MHz:
`frequencyMHz = 1_000_000 / periodPs`

For example, `Dom50` with `period: 20000` (20 ns) → 50 MHz.

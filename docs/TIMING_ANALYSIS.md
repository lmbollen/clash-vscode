# Timing Analysis and FMax Extraction

## Understanding the Two Frequencies in nextpnr

When nextpnr performs place-and-route, it reports **two different maximum frequencies**:

### 1. Pre-Routing Frequency (After Placement)

```
Info: Max frequency for clock '$glbnet$c$arg': 629.72 MHz (PASS at 12.00 MHz)
```

**When reported**: After simulated annealing (SA) placement completes
**What it means**: Estimated maximum frequency based on **placement only**
**Includes**: Logic delays and estimated routing delays
**Accuracy**: Optimistic - actual achievable frequency will be lower

This frequency assumes idealized routing between placed components. It's useful for:
- Quick placement quality assessment
- Early design feasibility checks
- Understanding placement impact on timing

### 2. Post-Routing Frequency (After Routing)

```
Info: Max frequency for clock '$glbnet$c$arg': 391.85 MHz (PASS at 12.00 MHz)
```

**When reported**: After detailed routing completes
**What it means**: **Actual achievable maximum frequency**
**Includes**: Logic delays + real routing delays
**Accuracy**: Accurate - this is what your hardware can achieve

This is the **real FMax** your design can run at. It's lower than the pre-routing estimate because:
- Actual routing paths add delay
- Congestion can force longer routes
- Real wire resistance and capacitance affect timing

## Why the Difference?

The difference between these two frequencies shows the **routing delay overhead**:

```
Routing overhead = Pre-Routing Freq - Post-Routing Freq
                 = 629.72 MHz - 391.85 MHz
                 = 237.87 MHz (38% degradation)
```

### Typical Causes of Large Routing Overhead:

1. **Congested designs**: Many signals competing for routing resources
2. **Poor floorplanning**: Related logic placed far apart
3. **High-fanout nets**: Signals driving many destinations
4. **Long critical paths**: Paths crossing large chip areas

### Reducing Routing Overhead:

- Use hierarchical design to keep related logic together
- Add timing constraints to guide placement
- Pipeline long paths to reduce combinational depth
- Use register replication for high-fanout signals
- Reduce logic depth with better algorithms

## FMax Display in Extension

The extension now shows both frequencies with clear labels:

```
Timing Analysis:
----------------------------------------
  Pre-Routing:   629.72 MHz (estimate)
  Max Frequency: 391.85 MHz (actual)
  Critical Path: 2.55 ns
  Constraints: ✓ MET
```

### Which Frequency Should You Use?

**Always use the "Max Frequency (actual)" value** - this is the real achievable frequency after routing.

The pre-routing estimate is shown for informational purposes to help you understand:
- How much routing is affecting your timing
- Whether placement quality is good
- If you have headroom for optimization

## Timing Reports

Detailed timing information is saved to the nextpnr output directory:

### Summary Report (`summary.txt`)

Combined overview with both timing and utilization:

```
nextpnr Place & Route Summary
======================================================================
Module:    topEntity
Generated: 2026-04-01T12:34:56.789Z
======================================================================

TIMING ANALYSIS
----------------------------------------------------------------------
  Pre-Routing Estimate:  629.72 MHz (after placement)
  Maximum Frequency:     391.85 MHz (after routing)
  Routing Overhead:      237.87 MHz (37.8%)
  Critical Path Delay:   2.552 ns
  Timing Constraints:    ✓ MET

RESOURCE UTILIZATION
----------------------------------------------------------------------
  LUTs:              250 / 12000    ( 2.1%)
  Registers:         128 / 12000    ( 1.1%)
  BRAM/EBR:            0 / 56       ( 0.0%)
  DSP Blocks:          0 / 28       ( 0.0%)
  IO Pins:             8 / 256      ( 3.1%)

======================================================================
For detailed analysis, see timing.txt and utilization.txt
======================================================================
```

### Individual Reports

- `.clash/{Module.Function}/04-nextpnr/timing.txt` - Detailed timing analysis
- `.clash/{Module.Function}/04-nextpnr/utilization.txt` - Resource usage with bar charts
- `.clash/{Module.Function}/04-nextpnr/nextpnr.log` - Full nextpnr output with detailed paths

## Example Interpretation

```
Design A:
  Pre-Routing:   800.00 MHz
  Max Frequency: 750.00 MHz  
  → 6% routing overhead - excellent!

Design B:
  Pre-Routing:   500.00 MHz
  Max Frequency: 250.00 MHz
  → 50% routing overhead - needs optimization!
```

**Good routing overhead**: < 20%
**Acceptable routing overhead**: 20-30%
**Poor routing overhead**: > 30% (consider design improvements)

## Critical Path Analysis

The critical path delay is the inverse of max frequency:

```
Critical Path (ns) = 1000 / Max Frequency (MHz)

Example:
391.85 MHz → 1000 / 391.85 = 2.55 ns
```

nextpnr provides detailed critical path information showing:
- Which nets are on the critical path
- Logic vs routing delay breakdown
- Source and destination registers

Look for messages like:
```
Info: 1.59 ns logic, 0.96 ns routing
```

This shows 62% of delay is in logic, 38% is routing.

## Timing Constraints

You can specify target frequency with the `--freq` flag:

```typescript
frequency: 100  // Target 100 MHz
```

nextpnr will then report:
- `PASS` if the design meets the constraint (FMax ≥ target)
- `FAIL` if the design violates the constraint (FMax < target)

## Further Reading

- [nextpnr Timing Analysis](https://github.com/YosysHQ/nextpnr#timing-analysis)
- [FPGA Timing Closure Techniques](https://www.intel.com/content/www/us/en/docs/programmable/683082/current/timing-closure.html)
- [Understanding Slack in FPGA Timing](https://docs.amd.com/r/en-US/ug949-vivado-design-methodology/Understanding-Timing)

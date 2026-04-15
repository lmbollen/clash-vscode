# Timing Analysis

After place & route with nextpnr, the extension reports timing information.

## Metrics

| Metric | Meaning |
|--------|---------|
| **Pre-Routing Frequency** | Estimated FMax before routing — optimistic upper bound |
| **Max Frequency** | Actual FMax after routing — the real achievable clock speed |
| **Critical Path Delay** | The longest combinational path in nanoseconds |
| **Constraints Met** | Whether the design meets the target frequency |

The **routing overhead** (difference between pre-routing and post-routing frequency) is typically 15–30% and is normal.

## SDC Frequency

The extension automatically reads Clash-generated `.sdc` files from the manifest directory. These files contain clock constraints like:

```
create_clock -name {CLK} -period 20.000 -waveform {0.000 10.000} [get_ports {CLK}]
```

The period (in nanoseconds) is converted to a frequency in MHz and passed to nextpnr via the `--freq` flag. For example, a period of 20ns yields a 50 MHz target.

If no SDC file is found, no frequency constraint is applied.

## Resource Utilization

The extension also reports resource utilization after place & route:

- **LUTs** — Look-up tables used vs. total available
- **Registers** — Flip-flops used vs. total
- **BRAM** — Block RAM tiles used vs. total
- **IO** — IO pins used vs. total

All values include usage percentages.

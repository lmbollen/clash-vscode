# Nextpnr Integration

## Supported Families

| Family | Executable | Constraints format |
|--------|-----------|-------------------|
| ECP5 | `nextpnr-ecp5` | `.lpf` |
| iCE40 | `nextpnr-ice40` | `.pcf` |
| Gowin | `nextpnr-gowin` | — |
| Nexus | `nextpnr-nexus` | — |
| MachXO2 | `nextpnr-machxo2` | — |
| Generic | `nextpnr-generic` | — |

Currently, the extension's interactive commands target **ECP5** specifically.

## ECP5 Devices

| Device | LUTs | Description |
|--------|------|-------------|
| `25k` / `um-25k` / `um5g-25k` | 24K | LFE5U-25F / LFE5UM-25F / LFE5UM5G-25F |
| `45k` / `um-45k` / `um5g-45k` | 44K | LFE5U-45F / LFE5UM-45F / LFE5UM5G-45F |
| `85k` / `um-85k` / `um5g-85k` | 84K | LFE5U-85F / LFE5UM-85F / LFE5UM5G-85F |

Packages: `CABGA256`, `CABGA381`, `CABGA554`, `CABGA756`, `CSFBGA285`, `CSFBGA381`, `CSFBGA554`

Speed grades: `6`, `7`, `8` (lower is faster)

## Command-Line Arguments

`NextpnrRunner.buildNextpnrArgs()` constructs:

```
nextpnr-ecp5 \
  --json design.json \
  --textcfg output.config \
  --25k \
  --package CABGA381 \
  --speed 6 \
  --freq 50 \              # from SDC, when available
  --lpf constraints.lpf    # when provided
```

## Bitstream Generation

For ECP5, `ecppack` converts the textual configuration to a binary bitstream:

```
ecppack input.config output.bit
```

This runs automatically after successful place & route.

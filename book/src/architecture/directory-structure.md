# Output Directory Structure

All generated files live under `.clash/` in the workspace root.

```
.clash/
  debug.log                          Debug log for all tool invocations
  synth-project/                     Cabal project that depends on your package
    cabal.project
    clash-synth.cabal
    bin/Clash.hs
    src/                             Generated wrapper modules
  {Module}.{Function}/
    02-verilog/                      Clash Verilog output
      {Module}.topEntity/
        function_name.v              Main Verilog
        clash-manifest.json          Clash metadata
        *.sdc                        Timing constraints
        …
    03-yosys/                        Yosys synthesis results
      function_name_synth.v          Synthesized Verilog
      function_name.json             JSON netlist (for nextpnr / DigitalJS)
      synth.ys                       Yosys script
      yosys.log                      Complete Yosys output
      statistics.txt                 Cell/wire statistics
      ooc/                           Out-of-context sub-module netlists
        {SubModule}/
          {SubModule}.json
          synth.ys
          yosys.log
      per-module/                    Per-module synthesis outputs
        {Module}/
          {Module}.il                RTLIL
          {Module}.json              DigitalJS JSON
          synth.ys
          yosys.log
    04-nextpnr/                      Place & route output
      function_name.config           Textual FPGA configuration
      function_name.bit              Bitstream (ready to program)
      nextpnr.log
      ecppack.log
```

# Architecture Overview

## Source Layout

```
src/
  extension.ts              Activation, command registration, orchestration
  clash-code-actions.ts     Code action provider (Ctrl+. on functions)
  hls-client.ts             HLS integration (document symbols, hover types)
  function-detector.ts      Function scanning and classification UI
  type-analyzer.ts          Monomorphism analysis
  code-generator.ts         Wrapper module generation, synth project management
  clash-compiler.ts         Clash invocation and output parsing
  clash-manifest-parser.ts  clash-manifest.json parsing, SDC frequency extraction
  clash-manifest-types.ts   Types for manifest data structures
  yosys-runner.ts           Yosys script generation and execution
  yosys-types.ts            Types for Yosys synthesis results
  nextpnr-runner.ts         nextpnr invocation, timing/utilisation parsing
  nextpnr-types.ts          Types for nextpnr options and results
  diagram-viewer.ts         DigitalJS webview panel
  toolchain.ts              External tool availability checking
  file-logger.ts            Debug file logging (.clash/debug.log)
  types.ts                  Shared FunctionInfo interface
```

## Key Types

```typescript
interface FunctionInfo {
  name: string;
  range: Range;
  typeSignature: string | null;
  isMonomorphic: boolean;
  filePath: string;
  moduleName: string | null;
}

interface ComponentInfo {
  name: string;
  verilogFiles: string[];
  dependencies: string[];   // direct only, not transitive
  directory: string;
}

type PortAnnotation =
  | { kind: 'name'; name: string }
  | { kind: 'product'; name: string; subPorts: string[] };
```

## Data Flow

```
User Code (.hs)
       │
       ▼
  HLS (symbols + hover)
       │
       ▼
  FunctionDetector → TypeAnalyzer
       │
       ▼
  CodeGenerator (wrapper .hs + synth project)
       │
       ▼
  ClashCompiler (cabal run clash → Verilog)
       │
       ▼
  ClashManifestParser (manifest + SDC frequency)
       │
       ▼
  YosysRunner (synthesis script → netlist JSON)
       │
       ▼
  NextpnrRunner (PnR → timing)
       │
       ▼
  DiagramViewer (DigitalJS webview)
```

## Extension Activation

On activation (`onLanguage:haskell`):

1. Create the "Clash Synthesis" output channel
2. Initialize the file logger at `.clash/debug.log`
3. Instantiate all component classes (HLSClient, FunctionDetector, CodeGenerator, ClashCompiler, YosysRunner, NextpnrRunner, ToolchainChecker)
4. Register commands and the code action provider for Haskell files
5. Run toolchain validation after a 2-second delay (to allow direnv)

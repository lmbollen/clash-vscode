# Yosys Integration Research

## Extensions Analyzed

### 1. digitaljs_code (yuyichao)
- **Repository**: https://github.com/yuyichao/digitaljs_code
- **Marketplace**: https://marketplace.visualstudio.com/items?itemName=yuyichao.digitaljs

#### Approach
- **Primary Tool**: yosys2digitaljs (converts Yosys output to DigitalJS format)
- **Focus**: Interactive circuit simulation and visualization
- **WebAssembly**: Uses browser-based tools (can run in vscode.dev, github.dev)
- **Workflow**:
  1. User adds Verilog files (.v, .sv, .vh) to circuit
  2. Synthesis panel allows setting Yosys options
  3. Runs Yosys synthesis (likely via WebAssembly in browser)
  4. Converts output with yosys2digitaljs
  5. Displays interactive circuit in DigitalJS simulator
  6. Saves entire circuit + source refs in .digitaljs format

#### Key Features
- Real-time circuit visualization
- Interactive signal monitoring and plotting
- Undo/redo of synthesis
- Source code highlighting when hovering circuit elements
- Lua scripting for simulation control
- Works fully in web version of VS Code

#### Technical Stack
- JavaScript/ES6 modules (.mjs files)
- Browser-based (no native process spawning)
- Custom webview for circuit display

### 2. vscode-edacation (EDAcation)
- **Repository**: https://github.com/EDAcation/vscode-edacation
- **Marketplace**: https://marketplace.visualstudio.com/items?itemName=edacation.edacation

#### Approach
- **Comprehensive EDA Suite**: Not just Yosys, but full toolchain
- **Multiple Tool Support**:
  - Yosys (RTL synthesis)
  - nextpnr (FPGA place & route)
  - DigitalJS (simulation)
  - Icarus Verilog (waveform generation)
- **Dual Mode**: Native tools AND WebAssembly versions
- **Project-based workflow** with proper file management

#### Architecture
- **Core Library**: Separate `edacation` npm package (library + CLI)
- **Tool Providers**: Abstraction layer for native vs WASM tools
  - `native-fpga-tools` - bundled native binaries
  - `yosys.js` - WebAssembly version of Yosys
  - `nextpnr.js` - WebAssembly version of nextpnr
- **Views**: Multiple specialized editors (Vue.js based)
  - VCD waveform viewer
  - nextpnr FPGA viewer
  - Pin constraint editor
- **Tasks**: VS Code task integration for running tools

#### Key Features
- Full FPGA development workflow
- Project management with actions/tasks
- Multiple file type support (constraints, testbenches)
- Proper build system integration
- Educational focus with guided workflows

#### Technical Stack
- TypeScript
- Vue.js for views
- Webpack for bundling
- Both native process spawning AND WebAssembly
- VS Code task provider

---

## Comparison for Our Use Case (Clash → Yosys)

| Aspect | digitaljs_code | vscode-edacation | Our Needs |
|--------|----------------|------------------|-----------|
| **Tool Execution** | WebAssembly (browser) | Native + WASM | Native (NixOS) |
| **Workflow Complexity** | Simple: Verilog → Circuit | Complex: Full FPGA flow | Medium: HDL → Analysis |
| **Integration Type** | Embedded simulator | External tools + Tasks | External tools |
| **Output Focus** | Interactive visualization | Build artifacts | Synthesis reports + stats |
| **User Interaction** | Graphical circuit editor | File-based workflow | Command-based workflow |

---

## Recommended Approach for clash-vscode-yosys

### Phase 5: Clash Compilation (Current → Next)

**Goal**: Generate Verilog from Clash wrapper modules

**Implementation**:
```typescript
// In src/clash-compiler.ts
export class ClashCompiler {
  async compileToVerilog(
    wrapperPath: string,
    projectRoot: string,
    outputChannel: vscode.OutputChannel
  ): Promise<CompilationResult> {
    
    // 1. Run Clash via cabal
    const terminal = vscode.window.createTerminal({
      name: 'Clash Compilation',
      cwd: projectRoot
    });
    
    terminal.show();
    
    // Command: cabal run clash -- WrapperModule --verilog
    const moduleName = path.basename(wrapperPath, '.hs');
    terminal.sendText(
      `cabal run clash -- ${moduleName} --verilog -fclash-hdldir .clash-synth/verilog`
    );
    
    // 2. Monitor output for completion
    // 3. Parse Clash messages for errors
    // 4. Return generated Verilog path
  }
}
```

### Phase 6: Yosys Integration (Recommended Approach)

**Option A: Simple Terminal Execution (Like EDAcation)**
- ✅ **Pros**: Simple, uses native Yosys from Nix
- ✅ User can see full output in terminal
- ✅ Easy to debug
- ❌ **Cons**: Less control over output parsing

```typescript
// In src/yosys-runner.ts
export class YosysRunner {
  async synthesize(
    verilogPath: string,
    topModule: string,
    options: YosysOptions
  ): Promise<YosysSynthesisResult> {
    
    // Generate Yosys script
    const scriptPath = await this.generateYosysScript(
      verilogPath,
      topModule,
      options
    );
    
    // Run yosys via terminal
    const terminal = vscode.window.createTerminal({
      name: 'Yosys Synthesis',
      cwd: options.workspaceRoot
    });
    
    terminal.show();
    terminal.sendText(`yosys -s ${scriptPath}`);
    
    // Parse output when complete
    return await this.waitForSynthesis(scriptPath, options.outputDir);
  }
  
  private async generateYosysScript(
    verilogPath: string,
    topModule: string,
    options: YosysOptions
  ): Promise<string> {
    const script = `
# Read design
read_verilog ${verilogPath}

# Elaborate design
hierarchy -check -top ${topModule}

# High-level synthesis
proc; opt; fsm; opt; memory; opt

# Mapping to generic gates
techmap; opt

# Generate reports
stat -width -liberty ${options.libertyFile || ''}
tee -o ${options.outputDir}/synthesis_stats.txt stat

# Export results  
write_verilog -noattr ${options.outputDir}/${topModule}_synth.v
${options.writeJson ? `write_json ${options.outputDir}/${topModule}.json` : ''}
`;
    
    const scriptPath = path.join(options.outputDir, 'synth.ys');
    await fs.writeFile(scriptPath, script);
    return scriptPath;
  }
}
```

**Option B: Child Process with Output Streaming (Recommended)**
- ✅ **Pros**: Full control, can parse output incrementally
- ✅ Can show progress in output channel
- ✅ Can extract statistics in real-time
- ✅ Better error handling
- ❌ **Cons**: More complex implementation

```typescript
// In src/yosys-runner.ts
import { spawn } from 'child_process';

export class YosysRunner {
  async synthesize(
    verilogPath: string,
    topModule: string,
    options: YosysOptions
  ): Promise<YosysSynthesisResult> {
    
    const scriptPath = await this.generateYosysScript(
      verilogPath,
      topModule,
      options
    );
    
    return new Promise((resolve, reject) => {
      const yosys = spawn('yosys', ['-s', scriptPath], {
        cwd: options.workspaceRoot
      });
      
      let stdout = '';
      let stderr = '';
      
      yosys.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        this.outputChannel.append(text);
        
        // Parse for progress indicators
        if (text.includes('Printing statistics')) {
          this.outputChannel.appendLine('\n✓ Synthesis complete');
        }
      });
      
      yosys.stderr.on('data', (data) => {
        stderr += data.toString();
        this.outputChannel.append(data.toString());
      });
      
      yosys.on('close', (code) => {
        if (code === 0) {
          resolve(this.parseYosysOutput(stdout, options));
        } else {
          reject(new Error(`Yosys failed with code ${code}: ${stderr}`));
        }
      });
    });
  }
  
  private parseYosysOutput(
    output: string,
    options: YosysOptions
  ): YosysSynthesisResult {
    // Extract statistics from output
    const stats = this.extractStats(output);
    
    return {
      success: true,
      verilogPath: path.join(options.outputDir, `${options.topModule}_synth.v`),
      jsonPath: options.writeJson 
        ? path.join(options.outputDir, `${options.topModule}.json`)
        : undefined,
      statistics: stats
    };
  }
  
  private extractStats(output: string): SynthesisStats {
    // Parse "Number of cells:" lines
    // Parse "Chip area:" lines  
    // Parse timing information if available
    
    return {
      cellCount: this.extractNumber(output, /Number of cells:\s+(\d+)/),
      wireCount: this.extractNumber(output, /Number of wires:\s+(\d+)/),
      area: this.extractNumber(output, /Chip area.*?(\d+\.?\d*)/),
      // Add more as needed
    };
  }
}
```

### Recommended: Option B with Enhanced Features

**Why Option B:**
1. **Better UX**: Real-time feedback in output channel
2. **Error Handling**: Can detect and report Yosys errors immediately
3. **Statistics**: Can parse and display key metrics (cell count, area)
4. **Integration**: Can trigger next steps (e.g., open synthesized Verilog)
5. **Nix-friendly**: Works with `nix develop` environment

**Additional Features to Add:**

1. **Yosys Script Templates**
   - Basic synthesis
   - FPGA-specific (iCE40, ECP5, etc.)
   - ASIC-oriented with technology libraries

2. **Progress Indicators**
   ```typescript
   vscode.window.withProgress({
     location: vscode.ProgressLocation.Notification,
     title: "Synthesizing with Yosys",
     cancellable: true
   }, async (progress, token) => {
     // Run synthesis with progress updates
   });
   ```

3. **Output Parsing for Diagnostics**
   - Extract warnings and errors
   - Create VS Code diagnostics (squiggly lines)
   - Link errors back to source lines

4. **Quick Actions After Synthesis**
   - "Open Synthesized Verilog"
   - "View Statistics"
   - "Compare with Original" (diff view)

---

## Implementation Plan

### Files to Create

1. **src/yosys-runner.ts**
   - YosysRunner class
   - Script generation
   - Process spawning
   - Output parsing

2. **src/yosys-types.ts**
   - YosysOptions interface
   - YosysSynthesisResult interface
   - SynthesisStats interface

3. **src/yosys-diagnostics.ts**
   - Parse Yosys warnings/errors
   - Create VS Code diagnostic objects

4. **src/clash-compiler.ts** (if not exists)
   - ClashCompiler class
   - Verilog generation from Clash

### Integration with Existing Code

Update **src/extension.ts**:
```typescript
import { YosysRunner } from './yosys-runner';

// In synthesizeFunction():
// ... after code generation ...

// Compile with Clash
const clashCompiler = new ClashCompiler(outputChannel);
const verilogResult = await clashCompiler.compileToVerilog(
  result.filePath,
  workspaceRoot,
  outputChannel
);

// Synthesize with Yosys
const yosysRunner = new YosysRunner(outputChannel);
const synthResult = await yosysRunner.synthesize(
  verilogResult.verilogPath,
  result.moduleName,
  { workspaceRoot, outputDir: '.clash-synth/yosys' }
);

// Show results
vscode.window.showInformationMessage(
  `Synthesis complete! ${synthResult.statistics.cellCount} cells`,
  'Open Verilog',
  'View Stats'
);
```

---

## Next Steps

1. ✅ **Phase 4 Complete**: Code generation working
2. 🔄 **Phase 5**: Implement Clash compiler integration
3. 🔜 **Phase 6**: Implement Yosys runner with Option B approach
4. 🔮 **Phase 7** (Optional): DigitalJS visualization like digitaljs_code

### Priority Order

1. **Clash Compilation** - Most critical, needed before Yosys
2. **Yosys Basic Execution** - Core synthesis functionality
3. **Statistics Parsing** - User feedback on synthesis results
4. **Error Diagnostics** - Developer experience
5. **Advanced Features** - Templates, comparisons, etc.

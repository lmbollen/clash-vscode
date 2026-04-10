# Clash Executable Discovery - Recommendations

## Current State

Currently, the extension:
1. **Defines** a configuration setting `clash-vscode-yosys.clashCommand` in `package.json` (default: `"cabal run clash --"`)
2. **Does NOT use** this setting - instead hardcodes `cabal` in [clash-compiler.ts](../src/clash-compiler.ts#L76)
3. Assumes `cabal` and the Clash compiler are available in the system PATH

## Issues with Current Approach

1. **Inflexible**: Users cannot customize how Clash is invoked
2. **Not portable**: Assumes specific system setup
3. **Configuration ignored**: The defined setting is never actually used
4. **No validation**: No check if `cabal` or Clash are available before attempting to run

## How HLS Extension Handles This

Research of the [vscode-haskell extension](https://github.com/haskell/vscode-haskell) reveals several approaches:

### 1. **Executable Path Configuration**
```json
"haskell.serverExecutablePath": {
  "type": "string",
  "scope": "machine-overridable",
  "description": "Path to the HLS executable"
}
```

Supports placeholders:
- `~`, `${HOME}`, `${home}` → user's home folder
- `${workspaceFolder}`, `${workspaceRoot}` → project root

### 2. **Managed Installation via GHCup**
```json
"haskell.manageHLS": {
  "type": "string",
  "enum": ["GHCup", "PATH"],
  "default": "GHCup"
}
```

The extension can:
- Automatically manage tool installations via GHCup
- Use whatever is found in PATH
- Install specific versions per workspace

### 3. **Toolchain Specification**
```json
"haskell.toolchain": {
  "type": "object",
  "properties": {
    "ghc": "9.2.2",
    "cabal": "recommended",
    "stack": null
  }
}
```

### 4. **Environment Variables**
```json
"haskell.serverEnvironment": {
  "type": "object",
  "description": "Environment variables for the server"
}
```

## Recommended Implementation

### Option 1: Simple Path-Based Approach (Minimum)

Update the extension to actually use the existing `clashCommand` setting:

```typescript
// In clash-compiler.ts
async compileToVerilog(
  wrapperPath: string,
  options: ClashCompilationOptions
): Promise<ClashCompilationResult> {
  // Get the configured command
  const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
  const clashCommand = config.get<string>('clashCommand', 'cabal run clash --');
  
  // Parse command (split on spaces, handle quoted args properly)
  const parts = this.parseCommand(clashCommand);
  const command = parts[0];
  const baseArgs = parts.slice(1);
  
  // Add Clash-specific arguments
  const args = [
    ...baseArgs,
    wrapperPath,
    '--verilog',
    '-fclash-hdldir', hdlDir
  ];
  
  this.outputChannel.appendLine(`Running: ${command} ${args.join(' ')}`);
  
  const clash = spawn(command, args, {
    cwd: options.workspaceRoot,
    env: process.env
  });
  // ... rest of implementation
}

private parseCommand(command: string): string[] {
  // Simple implementation - could be enhanced for quoted args
  return command.split(/\s+/);
}
```

Update `package.json` to clarify:

```json
"clash-vscode-yosys.clashCommand": {
  "type": "string",
  "default": "cabal run clash --",
  "markdownDescription": "Command to run Clash compiler. Supports:\n- `cabal run clash --` (default)\n- `stack exec clash --`\n- Absolute path: `/usr/local/bin/clash`\n- Relative to workspace: `${workspaceFolder}/.local/bin/clash`",
  "scope": "machine-overridable"
}
```

### Option 2: Enhanced with Executable Path (Recommended)

Separate the executable path from arguments:

```json
{
  "clash-vscode-yosys.clashExecutable": {
    "type": "string",
    "default": "",
    "markdownDescription": "Path to Clash executable. If empty, uses `clashCommand`. Supports placeholders: `~`, `${HOME}`, `${workspaceFolder}`",
    "scope": "machine-overridable"
  },
  "clash-vscode-yosys.clashCommand": {
    "type": "string",
    "default": "cabal run clash --",
    "description": "Command to run Clash when executable path is not specified"
  },
  "clash-vscode-yosys.clashArgs": {
    "type": "array",
    "items": { "type": "string" },
    "default": [],
    "description": "Additional arguments to pass to Clash compiler"
  }
}
```

Implementation:

```typescript
private async resolveClashCommand(): Promise<{ command: string; args: string[] }> {
  const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
  
  // Check for explicit executable path first
  const executable = config.get<string>('clashExecutable', '');
  if (executable) {
    const resolved = this.resolvePath(executable);
    return {
      command: resolved,
      args: config.get<string[]>('clashArgs', [])
    };
  }
  
  // Fall back to clashCommand
  const clashCommand = config.get<string>('clashCommand', 'cabal run clash --');
  const parts = this.parseCommand(clashCommand);
  return {
    command: parts[0],
    args: [...parts.slice(1), ...config.get<string[]>('clashArgs', [])]
  };
}

private resolvePath(path: string): string {
  // Handle placeholders
  let resolved = path
    .replace(/^~/, process.env.HOME || '')
    .replace(/\$\{HOME\}/g, process.env.HOME || '')
    .replace(/\$\{home\}/g, process.env.HOME || '')
    .replace(/\$\{workspaceFolder\}/g, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '')
    .replace(/\$\{workspaceRoot\}/g, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
  
  return resolved;
}
```

### Option 3: Full Integration with Build Tools (Advanced)

Add detection and integration with Cabal/Stack project files:

```json
{
  "clash-vscode-yosys.buildTool": {
    "type": "string",
    "enum": ["auto", "cabal", "stack", "nix", "direct"],
    "default": "auto",
    "description": "Build tool to use for running Clash"
  }
}
```

```typescript
private async detectBuildTool(workspaceRoot: string): Promise<string> {
  const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
  const buildTool = config.get<string>('buildTool', 'auto');
  
  if (buildTool !== 'auto') {
    return buildTool;
  }
  
  // Auto-detect based on project files
  try {
    if (await this.fileExists(path.join(workspaceRoot, 'cabal.project'))) {
      return 'cabal';
    }
    if (await this.fileExists(path.join(workspaceRoot, 'stack.yaml'))) {
      return 'stack';
    }
    if (await this.fileExists(path.join(workspaceRoot, 'flake.nix'))) {
      return 'nix';
    }
  } catch (e) {
    // Ignore errors, fall back to default
  }
  
  return 'cabal'; // default
}

private getCommandForBuildTool(buildTool: string): string[] {
  switch (buildTool) {
    case 'cabal':
      return ['cabal', 'run', 'clash', '--'];
    case 'stack':
      return ['stack', 'exec', 'clash', '--'];
    case 'nix':
      return ['nix', 'run', '.#clash', '--'];
    case 'direct':
      return ['clash'];
    default:
      return ['cabal', 'run', 'clash', '--'];
  }
}
```

## Validation & Error Handling

Add validation before attempting to run:

```typescript
private async validateClashAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const process = spawn(command, ['--version'], {
      timeout: 5000
    });
    
    let hasOutput = false;
    process.stdout.on('data', () => { hasOutput = true; });
    process.stderr.on('data', () => { hasOutput = true; });
    
    process.on('close', (code) => {
      resolve(code === 0 || hasOutput);
    });
    
    process.on('error', () => {
      resolve(false);
    });
  });
}
```

## Security Considerations

Use `machine-overridable` scope for executable paths (as HLS does):

> **Security Warning**: The `machine-overridable` scope allows workspace settings to override the executable path, which could potentially execute arbitrary programs if a malicious `.vscode/settings.json` is added to a workspace.

Consider:
1. Showing a warning when using workspace-level executable paths
2. Adding a trusted workspaces feature
3. Validating that the executable is in expected locations

## Migration Path

1. **Phase 1**: Make the existing `clashCommand` setting actually work (Option 1)
2. **Phase 2**: Add `clashExecutable` and improve path resolution (Option 2)
3. **Phase 3**: Add build tool auto-detection (Option 3)
4. **Phase 4**: Add validation and better error messages

## References

- [HLS Extension](https://github.com/haskell/vscode-haskell)
- [VS Code Configuration API](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)
- [When Clause Contexts](https://code.visualstudio.com/api/references/when-clause-contexts)

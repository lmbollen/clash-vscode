# Clash Command Configuration

## Overview

As of the latest version, the Clash compiler invocation is now fully configurable through the `clash-vscode-yosys.clashCommand` extension setting.

## Configuration

### Setting Location

Open VS Code settings and search for `clash-vscode-yosys.clashCommand`, or add to your `settings.json`:

```json
{
  "clash-vscode-yosys.clashCommand": "cabal run clash --"
}
```

### Supported Values

The command string will be parsed and split on spaces to extract the executable and arguments. Examples:

#### Cabal (Default)
```json
"clash-vscode-yosys.clashCommand": "cabal run clash --"
```

#### Stack
```json
"clash-vscode-yosys.clashCommand": "stack exec clash --"
```

#### Nix Flake
```json
"clash-vscode-yosys.clashCommand": "nix run .#clash --"
```

#### Direct Executable
If Clash is in your PATH:
```json
"clash-vscode-yosys.clashCommand": "clash"
```

#### Custom Path
```json
"clash-vscode-yosys.clashCommand": "/usr/local/bin/clash"
```

## Validation

### Startup Check

When the extension activates, it automatically validates the configured command by running:

```bash
{configured-command} --version
```

The validation runs in your workspace directory (important for direnv and nix-shell environments), with a 2-second delay to allow environment activation.

For example, with the default setting:
```bash
cd /your/workspace
cabal run clash -- --version
```

### Working with direnv/nix-shell

**If you use direnv or nix-shell**, the validation might fail at startup because the environment isn't fully loaded yet. This is expected and won't prevent the extension from working during actual compilation.

**Option 1: Skip validation** (recommended for direnv users)

Add to your settings:
```json
{
  "clash-vscode-yosys.skipCommandValidation": true
}
```

**Option 2: Ignore the warning**

The validation failure is just a soft warning. The command will be tried again during actual compilation when your environment is properly loaded.

### Validation Results

**Success**: If the command works, you'll see in the Output panel:
```
✓ Clash command validated: cabal run clash --
  Version info: Clash 1.8.1
```

**Failure (soft warning)**: If validation fails, you'll see:
```
⚠ Clash command validation failed (exit code 1)
  Output: [error details]

Note: The command will be tried again during actual compilation.
This validation might fail if you use direnv/nix-shell.
To skip validation, set: clash-vscode-yosys.skipCommandValidation = true

Command: cabal run clash --
Working directory: /your/workspace
```

**Important**: Validation failure is NOT blocking. The extension will still try to use the command when you actually run a compilation. This is intentional to support direnv/nix-shell workflows where the environment is set up just-in-time.

## Implementation Details

### Command Parsing

The extension includes a simple command parser that:
- Splits the command string on spaces
- Handles basic quoted strings (both single and double quotes)
- Extracts the executable as the first part
- Treats remaining parts as base arguments

### Runtime Usage

When compiling Haskell to Verilog, the extension:
1. Gets the configured command via `getClashCommand()`
2. Parses it into `{ command: string, args: string[] }`
3. Appends Clash-specific arguments (file path, `--verilog`, `-fclash-hdldir`, etc.)
4. Spawns the process with the full command

Example execution:
```typescript
// Configuration: "cabal run clash --"
// Parsed: { command: "cabal", args: ["run", "clash", "--"] }
// Final command: cabal run clash -- /path/to/file.hs --verilog -fclash-hdldir /output
```

## Code Changes

### Files Modified

1. **src/clash-compiler.ts**
   - Added `parseCommand()` method to parse command strings
   - Added `getClashCommand()` method to read configuration
   - Added `validateCommand()` method to check command with `--version`
   - Updated `compileToVerilog()` to use configured command
   - Updated `checkAvailability()` to use configured command

2. **src/extension.ts**
   - Added `validateClashCommand()` function called on activation
   - Shows warning notification and helpful message if validation fails
   - Offers to open settings if command is misconfigured

3. **package.json**
   - Enhanced `clashCommand` setting description with examples
   - Added `scope: "machine-overridable"` to allow workspace-level overrides
   - Used `markdownDescription` for better formatting in settings UI

4. **ARCHITECTURE.md**
   - Updated configuration section to document supported command formats

## Troubleshooting

### Command Not Found

**Error**: `Failed to execute Clash command: spawn ENOENT`

**Solutions**:
- Check that the executable is in your PATH
- Use an absolute path to the executable
- Ensure you're running VS Code from the correct environment (e.g., within `nix develop`)

### Wrong Working Directory

If using a build tool like Cabal or Stack, make sure your workspace is opened at the project root (where `cabal.project` or `stack.yaml` exists).

### Nix Flake Issues

For Nix flake projects, ensure you're running VS Code from within the development shell:

```bash
nix develop
code .
```

Or configure the command to use the flake directly:
```json
"clash-vscode-yosys.clashCommand": "nix run .#clash --"
```

## Future Enhancements

Potential improvements for command configuration (see [CLASH_EXECUTABLE_DISCOVERY.md](CLASH_EXECUTABLE_DISCOVERY.md)):

1. **Separate executable path setting** - Like HLS's `serverExecutablePath`
2. **Path placeholders** - Support `~`, `${HOME}`, `${workspaceFolder}`
3. **Build tool auto-detection** - Detect cabal.project vs stack.yaml
4. **Additional arguments setting** - Separate array for extra flags
5. **Managed installation** - Optionally install/manage Clash via GHCup

## Related Documentation

- [CLASH_EXECUTABLE_DISCOVERY.md](CLASH_EXECUTABLE_DISCOVERY.md) - Research and recommendations for future improvements
- [ARCHITECTURE.md](../ARCHITECTURE.md) - Overall extension architecture
- [PHASE5_COMPLETE.md](PHASE5_COMPLETE.md) - Clash compiler integration details

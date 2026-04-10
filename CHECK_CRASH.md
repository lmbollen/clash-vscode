# Debugging Time-Based Crashes

## What We Know
- Extension activates successfully
- VS Code crashes after ~18 seconds
- No commands are executed
- Extension's deactivate() runs before crash (clean shutdown attempt)

## This Indicates
The crash is **NOT** caused by our extension's code, but by:

1. **Haskell Language Server (HLS)** - Most likely culprit
   - HLS may be crashing while indexing the Clash project
   - When HLS crashes, it can take down the VS Code Extension Host

2. **VS Code Extension Host** instability
   - The debugger's Extension Development Host may be unstable on NixOS
   - Known issue with VS Code + Nix + dynamic libraries

3. **Memory/Resource Issues**
   - HLS uses significant memory for large Haskell projects
   - Clash imports can cause HLS to consume excessive resources

## How to Diagnose

### Check VS Code's Own Logs
```bash
# VS Code extension host log (most important)
ls -la ~/.config/Code/logs/*/exthost*

# View the latest extension host log
code $(ls -t ~/.config/Code/logs/*/exthost*.log | head -1)
```

### Check HLS Logs
```bash
# HLS typically logs to
ls -la ~/.cache/hie-bidi/
# or
ls -la .hie/

# Check if HLS is crashing
journalctl --user | grep -i haskell
```

### Monitor System Resources
```bash
# In one terminal, monitor memory while VS Code runs
watch -n 1 'ps aux | grep -E "(Code|hls|haskell)" | grep -v grep'
```

## Solutions to Try

### 1. Disable HLS Temporarily
In VS Code settings (Extension Development Host):
```json
{
  "haskell.manageHLS": "PATH",
  "haskell.serverExecutablePath": "/bin/false"
}
```

If this stops the crashes, HLS is the culprit.

### 2. Limit HLS Memory
Create `.hie-bidi.conf` in your home directory:
```
+RTS -M2G -RTS
```

### 3. Use VS Code Release Build
Instead of the debugger, package and install the extension:
```bash
cd /home/nixos/repos/clash-vscode-yosys
npm install -g @vscode/vsce
vsce package
code --install-extension clash-vscode-yosys-0.0.1.vsix
```

Then test in a regular VS Code window (not Extension Development Host).

### 4. Check Nix Environment
The issue might be library paths:
```bash
# Run VS Code from nix-shell with all dependencies
cd /home/nixos/repos/clash-vscode-yosys
nix develop
code test-project/
```

### 5. Simplify Test Project
Temporarily remove Clash imports to see if HLS is struggling with Clash.Prelude:

```haskell
-- In test-project/src/Example/Project.hs
-- Comment out: import Clash.Prelude
-- Add simple types instead
```

## Next Steps

1. **Check extension host logs** - This will show the actual crash reason
2. **Disable HLS** - Test if HLS is the cause
3. **Package extension** - Test outside debugger environment
4. **Simplify imports** - Reduce HLS load

The debug log file helps us track our extension's behavior, but won't capture HLS or Extension Host crashes.

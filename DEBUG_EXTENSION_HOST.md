# Extension Development Host Crashing - Debug Guide

## What You Reported
- Extension Development Host (debug window) crashes even with NO extensions enabled
- Need to check the debug console for relevant output

## Where to Check Debug Console

### In Your Local VS Code Client:
1. **Debug Console Tab** - Bottom panel, next to Terminal/Problems/Output
   - Shows stdout/stderr from the Extension Development Host
   - Should show any Node.js errors or crashes
   
2. **Output Panel** → Select "Log (Extension Host)"
   - Shows extension host initialization and errors
   
3. **Output Panel** → Select "Log (Remote Extension Host)"  
   - For VS Code Server, this is most relevant

## What to Look For

### In Debug Console:
```
✓ Normal startup:
  [Extension Host] Starting extension host...
  [Extension Host] Extension host started

✗ Crash indicators:
  Error: Cannot find module...
  SIGSEGV / SIGABRT
  Segmentation fault
  Error: spawn ENOMEM
  FATAL ERROR: ... Process out of memory
```

### Common VS Code Remote + NixOS Issues

#### 1. Node.js Version Mismatch
VS Code Server bundles its own Node.js, but NixOS might have library incompatibilities.

**Test:** Check Node.js version used by VS Code Server
```bash
~/.vscode-server/bin/*/node --version
ldd ~/.vscode-server/bin/*/node
```

#### 2. Missing or Incompatible System Libraries
**Test:** Check for missing libraries
```bash
LD_DEBUG=libs ~/.vscode-server/bin/*/node -e "console.log('ok')" 2>&1 | grep -i error
```

#### 3. Extension Host Memory Limit
The Extension Host might be hitting memory limits.

**Test:** Monitor memory during startup
```bash
watch -n 0.5 'ps aux | grep extensionHost | head -5'
```

## Immediate Action: Get Debug Output

### Option 1: Run with Verbose Logging
In your **local VS Code** (client), add to settings:
```json
{
  "remote.extensionHostDebugPort": 9339,
  "remote.extensionHostDebugAllow": true
}
```

### Option 2: Check Server-Side Console
```bash
# Watch extension host in real-time
tail -f ~/.vscode-server/data/logs/$(ls -1t ~/.vscode-server/data/logs/ | head -1)/remoteagent.log
```

### Option 3: Simplified Launch Config
Try launching with minimal options:

\`\`\`json
{
  "name": "Extension (Minimal)",
  "type": "extensionHost",
  "request": "launch",
  "args": [
    "--extensionDevelopmentPath=${workspaceFolder}",
    "--disable-extensions"  // This disables ALL other extensions
  ]
}
\`\`\`

## Known NixOS + VS Code Issues

### Issue: Extension Host Crashes on NixOS
**Cause:** NixOS's unique library paths
**Solution:** Use nix-ld or set LD_LIBRARY_PATH

Create `~/.config/nixpkgs/config.nix`:
```nix
{
  allowUnfree = true;
  
  packageOverrides = pkgs: {
    vscode-server-ld = pkgs.buildFHSUserEnv {
      name = "vscode-server-ld";
      targetPkgs = pkgs: with pkgs; [
        stdenv.cc.cc.lib
        zlib
        openssl
      ];
    };
  };
}
```

### Issue: Automatic Extension Host Restarts
If the Extension Development Host is restarting automatically on a timer, this is likely:
- HLS (Haskell Language Server) - See [test-project/.vscode/settings.json](test-project/.vscode/settings.json) fix
- Copilot or other extensions polling
- VS Code Remote trying to reconnect

## Next Steps

1. **Capture the actual error** - Look in Debug Console when crash happens
2. **Paste the error here** - I need the actual error message to diagnose
3. **Try disabling ALL extensions** - Use `--disable-extensions` flag
4. **Check if it's HLS** - The settings.json I created should help, but may need to fully disable HLS

## Quick Test: Is it Our Extension?

```bash
# Rename extension temporarily
cd /home/nixos/repos/clash-vscode-yosys
mv out out.disabled

# Press F5 again - if it still crashes, it's NOT our extension
```

## What I Found So Far

From the logs:
- Extension hosts are exiting with code 0 (clean shutdown)
- No segfaults or crashes in dmesg
- HLS was spamming errors (we disabled those features)
- Test failures in the logs (unrelated to crash)

This suggests it's either:
1. **HLS crashing** and taking down the Extension Host (most likely)
2. **VS Code Remote** timing out or restarting the Extension Host
3. **Memory/resource limit** being hit

**Please check the Debug Console** in your local VS Code and share what error appears when the crash happens.

# Debugging VS Code Extension Crashes

## Quick Diagnostic Steps

If the extension crashes VS Code:

### 1. Check Developer Tools
- **Help → Toggle Developer Tools**
- Go to **Console** tab
- Look for red error messages
- Copy the stack trace

### 2. Check Extension Host Log
In VS Code:
- **View → Output**
- Select **"Extension Host"** from dropdown
- Look for errors before crash

### 3. Check Our Extension Log
- **View → Output**
- Select **"Clash Synthesis"** from dropdown  
- Look for the last operation before crash

### 4. Enable Verbose Logging
Add to your settings.json:
```json
{
  "extensions.logging": "verbose"
}
```

### 5. Run with Debugger
1. Open the extension project
2. Press F5 to launch Extension Development Host
3. When it crashes, the debugger may catch the exception
4. Check Debug Console for stack trace

## Common Crash Causes & Solutions

### File System Errors
**Symptoms:** Crashes when generating or opening files

**Check:**
- Do you have write permissions in the workspace?
- Is the disk full?
- Is the path valid?

**Solution:** Check error messages in "Clash Synthesis" output

### Memory Issues
**Symptoms:** Slow performance then crash

**Check:**
- Developer Tools → Performance tab
- Look for memory growth

**Solution:** Restart VS Code, close other heavy extensions

### Infinite Loops
**Symptoms:** CPU spikes to 100%, then crash

**Check:**
- Task Manager/htop for high CPU usage

**Solution:** This should not happen with current code (no loops without termination)

### HLS Communication Errors
**Symptoms:** Crashes when detecting functions

**Check:**
- Is Haskell Language Server running?
- Status bar should show "Haskell" indicator
- Check HLS output channel

**Solution:** 
```bash
# In workspace
cabal build  # Ensure project builds
# Then reload VS Code window
```

### Async Operation Failures
**Symptoms:** Crashes during async operations (file I/O, HLS calls)

**Solution:** All fixed in latest code with proper try-catch blocks

## Reporting Issues

If crashes persist, collect:

1. **Stack trace** from Developer Tools Console
2. **Extension Host log** from Output panel
3. **Clash Synthesis log** from Output panel
4. **Steps to reproduce**
5. **VS Code version**: Help → About
6. **Extension version**: Check package.json

## Emergency Recovery

If extension prevents VS Code from starting:

1. **Disable the extension:**
   ```bash
   code --disable-extension clash-lang.clash-vscode-yosys
   ```

2. **Uninstall if needed:**
   - code → Extensions → Clash Verilog Yosys → Uninstall

3. **Clear extension cache:**
   ```bash
   rm -rf ~/.vscode/extensions/clash-lang.clash-vscode-yosys-*
   ```

## Prevention Checklist

Before running the extension:
- ✅ Workspace is open (not just files)
- ✅ HLS is initialized (wait ~5 seconds after opening)
- ✅ Test project builds: `cd test-project && cabal build`
- ✅ No other heavy operations running
- ✅ Extension is up to date: `npm run compile`

## Known Fixed Issues

These were causing crashes but are now fixed:

1. ✅ File opening without URI (fixed: now uses vscode.Uri.file)
2. ✅ Unhandled file operation errors (fixed: added try-catch)
3. ✅ Output channel overflow (fixed: truncate large content)
4. ✅ Directory creation failures (fixed: proper error handling)

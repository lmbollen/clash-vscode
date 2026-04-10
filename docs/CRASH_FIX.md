# Crash Investigation & Fixes

## Issues Found and Fixed

### 1. **File Opening Without URI** (CRITICAL)
**Problem:** Opening files with string paths instead of URIs can cause VS Code extension host crashes.

**Location:** `src/extension.ts` line 225

**Fix:** Use `vscode.Uri.file()` and add try-catch:
```typescript
// Before (crash-prone):
const document = await vscode.workspace.openTextDocument(result.filePath);

// After (safe):
const uri = vscode.Uri.file(result.filePath);
const document = await vscode.workspace.openTextDocument(uri);
```

### 2. **No Error Handling for Document Operations** (HIGH)
**Problem:** If `openTextDocument` or `showTextDocument` fails, the entire extension host could crash.

**Fix:** Added try-catch block around file opening operations with user-friendly error messages.

### 3. **Output Channel Overflow** (MEDIUM)
**Problem:** Logging entire generated file content (potentially unlimited size) to output channel could cause memory issues.

**Location:** `src/code-generator.ts` line 76-81

**Fix:** Limit logged content to 1000 characters with truncation indicator:
```typescript
const preview = content.length > 1000 
    ? content.substring(0, 1000) + '\n... (truncated)' 
    : content;
```

### 4. **Directory Creation Failures Unhandled** (MEDIUM)
**Problem:** If directory creation fails, the error is silently swallowed.

**Fix:** Added nested try-catch with descriptive error message:
```typescript
try {
    await fs.mkdir(dirPath, { recursive: true });
} catch (mkdirError) {
    throw new Error(`Failed to create directory ${dirPath}: ${msg}`);
}
```

### 5. **Missing Document Options** (LOW)
**Problem:** Not specifying document options could cause issues in some VS Code configurations.

**Fix:** Added explicit options to `showTextDocument`:
```typescript
await vscode.window.showTextDocument(document, {
    preview: false,      // Open in permanent editor
    preserveFocus: false // Focus the new editor
});
```

## Testing Recommendations

After these fixes, test the following scenarios:

1. **Normal Operation:**
   - Detect functions
   - Synthesize `plusSigned`
   - Click "Open File"
   - Verify file opens without crash

2. **Error Scenarios:**
   - Try synthesizing with no workspace open
   - Try synthesizing when disk is full (if possible)
   - Try with read-only workspace

3. **Edge Cases:**
   - Very long function names
   - Complex type signatures
   - Multiple rapid synthesize operations

## Root Cause Analysis

The most likely cause of the crash was **Issue #1**: opening files without proper URI handling. VS Code's extension API requires URIs for cross-platform compatibility and proper resource resolution.

When `openTextDocument` receives a raw file path string (especially on Linux/Unix where paths differ from Windows), it can fail in unexpected ways that crash the extension host rather than throwing a catchable error.

## Prevention

All file operations should:
1. Use `vscode.Uri.file()` for paths
2. Be wrapped in try-catch blocks
3. Provide user-friendly error messages
4. Log errors to output channel

## Verification

To verify the crash is fixed:

```bash
# Compile the updated code
npm run compile

# Run the extension with debugger (F5)
# Try the workflow that previously crashed
# Check Debug Console for any errors
```

If crashes persist, check:
- Debug Console for stack traces
- Output > Clash Synthesis for error logs
- Extension Host log: Help > Toggle Developer Tools > Console

## Additional Safeguards Added

- Content truncation in output logging
- Explicit error messages for file system operations
- Graceful degradation on failures
- Safe disposal of resources in deactivate()

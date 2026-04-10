# Known Warnings

When running the extension in development mode, you may see the following warnings in the debug console. **These are expected and harmless:**

## 1. Punycode Deprecation Warning

```
(node:xxxxx) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. 
Please use a userland alternative instead.
```

**Source:** This comes from the `vscode-languageclient` dependency (or its transitive dependencies).

**Impact:** None. This is a Node.js built-in module deprecation that will be addressed when all packages in the ecosystem migrate to alternatives.

**Action:** No action needed. This will be resolved when upstream dependencies update.

## 2. SQLite Experimental Warning

```
(node:xxxxx) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

**Source:** VS Code core using Node.js's experimental SQLite module.

**Impact:** None. This is from VS Code itself, not our extension.

**Action:** No action needed. This is a VS Code internal feature.

## 3. ApplicationInsights Telemetry Error

```
ApplicationInsights:Sender (2) ['Ingestion endpoint could not be reached...
```

**Source:** VS Code's telemetry system.

**Impact:** None. This appears when telemetry cannot reach Microsoft's servers (common in development or offline scenarios).

**Action:** No action needed. This is informational only.

## Suppressing Warnings (Optional)

If these warnings bother you during development, you can suppress them:

### Option 1: Node.js Flags

Add to your launch configuration in `.vscode/launch.json`:

```json
{
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/out/**/*.js"
      ],
      "preLaunchTask": "${defaultBuildTask}",
      "env": {
        "NODE_OPTIONS": "--no-deprecation --no-warnings"
      }
    }
  ]
}
```

### Option 2: Filter Console

In the Debug Console, use the filter button to hide warnings and only show errors.

## Real Errors to Watch For

**Actual problems** will show as:
- Compilation errors in the TypeScript output
- Runtime exceptions in the Debug Console
- Error messages in the "Clash Synthesis" Output panel

If you see those, they need attention! The warnings listed above do not.

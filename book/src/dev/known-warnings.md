# Known Warnings

When running the extension in development mode the Debug Console may show the following messages. **All are harmless.**

## Punycode deprecation

```
(node:xxxxx) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.
```

Comes from `vscode-languageclient` transitive dependencies. Will disappear when upstream packages migrate.

## SQLite experimental warning

```
(node:xxxxx) ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

Emitted by VS Code's own internals — not related to this extension.

## ApplicationInsights telemetry error

```
ApplicationInsights:Sender (2) ['Ingestion endpoint could not be reached...
```

VS Code telemetry failing to reach Microsoft servers. Common in offline or firewalled environments.

## Suppressing Warnings

Add to your launch configuration's `env` block:

```jsonc
"env": {
  "NODE_OPTIONS": "--no-deprecation --no-warnings"
}
```

Or use the **filter** button in the Debug Console to hide warnings and show only errors.

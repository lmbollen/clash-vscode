#!/usr/bin/env bash
# Test runner wrapper for NixOS environments
# This ensures VS Code can find necessary libraries

# Use system VS Code if available in the Nix environment
if command -v code &> /dev/null; then
    export VSCODE_CLI_USE_FILE_KEYTAR=1
    npm run compile && npm run lint && node ./out/test/runTest.js "$@"
else
    echo "Warning: Running tests requires VS Code to be available"
    echo "Please run 'nix develop' first, or run unit tests only"
    exit 1
fi

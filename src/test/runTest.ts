import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');
		const extensionTestsPath = path.resolve(__dirname, './suite/index');
		const testWorkspace = path.resolve(extensionDevelopmentPath, 'test-project');

		// In NixOS / headless environments the downloaded VS Code binary lacks the
		// required system library wrappers.  Set VSCODE_EXECUTABLE_PATH to point at
		// the nix-wrapped binary (e.g. the one from `vscode-fhs` in the devShell).
		// Must be a real Electron binary, NOT the `code` CLI wrapper — the wrapper
		// backgrounds the app (or hands off to a running instance) and exits 0, so
		// the test host never runs. Leave unset to let @vscode/test-electron
		// download a matching build.
		const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;

		// When invoked from VS Code's integrated terminal, the parent editor leaks
		// ELECTRON_RUN_AS_NODE=1 and a set of VSCODE_* vars into the environment.
		// ELECTRON_RUN_AS_NODE makes the test host's Electron binary run as plain
		// Node (it then treats the workspace path as a script → "Cannot find
		// module"), and the VSCODE_* vars tie it to the running instance. Strip
		// them so the child launches as a clean, standalone VS Code.
		delete process.env.ELECTRON_RUN_AS_NODE;
		for (const key of Object.keys(process.env)) {
			if (key.startsWith('VSCODE_')) {
				delete process.env[key];
			}
		}

		await runTests({
			...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [
				testWorkspace,
				'--disable-workspace-trust',
				'--no-sandbox',         // required when running as root or in containers
			],
		});
	} catch (err) {
		console.error('Failed to run tests:', err);
		process.exit(1);
	}
}

main();

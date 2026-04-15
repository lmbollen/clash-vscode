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
		const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;

		await runTests({
			...(vscodeExecutablePath ? { vscodeExecutablePath } : {}),
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [
				testWorkspace,
				'--disable-workspace-trust',
				'--no-sandbox',         // required when running as root or in containers
				'--disable-gpu',        // no GPU in CI / headless environments
				'--headless',           // run without opening a window (VS Code 1.85+)
			],
		});
	} catch (err) {
		console.error('Failed to run tests:', err);
		process.exit(1);
	}
}

main();

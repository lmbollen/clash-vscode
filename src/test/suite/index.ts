import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';
import * as vscode from 'vscode';

const EXTENSION_ID = 'LucasBollen.clash-toolkit';

export async function run(): Promise<void> {
	// The extension's only activation event is `onLanguage:haskell`, which the
	// test host never triggers (it opens the workspace folder but no .hs
	// document).  Activate it explicitly so commands are registered before any
	// suite runs — otherwise the command-registration tests fail.
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	if (!extension) {
		throw new Error(`Extension ${EXTENSION_ID} not found in the test host`);
	}
	await extension.activate();

	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 60000 // Increase timeout for HLS initialization
	});

	const testsRoot = path.resolve(__dirname, '.');
	const files = await glob('**/**.test.js', { cwd: testsRoot });

	// Add files to the test suite
	files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

	return new Promise((resolve, reject) => {
		try {
			// Run the mocha test
			mocha.run(failures => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			console.error(err);
			reject(err);
		}
	});
}

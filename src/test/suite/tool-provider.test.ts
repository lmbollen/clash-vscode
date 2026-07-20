import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ManagedToolchain } from '../../tool-provider';

/**
 * Unit tests for the managed-toolchain resolver. These cover the pure,
 * offline behaviour (which commands it can supply, and how it resolves names
 * when nothing is installed) — the actual download is not exercised here.
 */
suite('ManagedToolchain Test Suite', () => {
	let outputChannel: vscode.OutputChannel;
	let toolchain: ManagedToolchain;

	suiteSetup(() => {
		outputChannel = vscode.window.createOutputChannel('Test Managed Toolchain');
		// A throwaway global-storage dir guarantees "not installed" state.
		const fakeStorage = path.join(os.tmpdir(), `clash-tp-test-${process.pid}`);
		const fakeContext = {
			globalStorageUri: vscode.Uri.file(fakeStorage),
		} as unknown as vscode.ExtensionContext;
		toolchain = new ManagedToolchain(fakeContext, outputChannel);
	});

	suiteTeardown(() => {
		outputChannel?.dispose();
	});

	test('canProvide recognises the bundled tools', () => {
		assert.strictEqual(toolchain.canProvide('yosys'), true);
		assert.strictEqual(toolchain.canProvide('dot'), true);
		assert.strictEqual(toolchain.canProvide('nextpnr-ecp5'), true);
		assert.strictEqual(toolchain.canProvide('nextpnr-ice40'), true);
		assert.strictEqual(toolchain.canProvide('nextpnr-himbaechel'), true);
	});

	test('canProvide rejects tools outside the suite', () => {
		// cabal/ghc are Haskell tooling, not part of the OSS CAD Suite.
		assert.strictEqual(toolchain.canProvide('cabal'), false);
		assert.strictEqual(toolchain.canProvide('ghc'), false);
	});

	test('is not installed against a throwaway storage dir', () => {
		assert.strictEqual(toolchain.isInstalled(), false);
	});

	test('resolve returns the name unchanged when nothing is installed', () => {
		// A providable tool that is (almost certainly) not on the test PATH and
		// has no managed copy resolves back to its bare name.
		assert.strictEqual(
			toolchain.resolve('nextpnr-himbaechel'),
			'nextpnr-himbaechel'
		);
		// A command this provider can't supply is always passed through.
		assert.strictEqual(
			toolchain.resolve('some-unknown-command-xyz'),
			'some-unknown-command-xyz'
		);
	});

	test('describeStatus reports the not-installed state', () => {
		const status = toolchain.describeStatus();
		assert.ok(
			status.includes('not installed') || status.includes('unavailable'),
			`unexpected status line: ${status}`
		);
	});
});

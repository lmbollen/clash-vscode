import * as assert from 'assert';
import * as vscode from 'vscode';
import { ToolchainChecker } from '../../toolchain';

suite('Toolchain Checker Test Suite', () => {
	let outputChannel: vscode.OutputChannel;
	let checker: ToolchainChecker;

	suiteSetup(() => {
		outputChannel = vscode.window.createOutputChannel('Test Toolchain');
		checker = new ToolchainChecker(outputChannel);
	});

	suiteTeardown(() => {
		if (outputChannel) {
			outputChannel.dispose();
		}
	});

	setup(() => {
		checker.clearCache();
	});

	test('Should detect available system tools', async function () {
		this.timeout(15000);

		// 'echo' should always be available
		const status = await checker.check('echo', 'echo', 'hello');
		assert.strictEqual(status.available, true, 'echo should be available');
		assert.strictEqual(status.name, 'echo');
	});

	test('Should detect missing tools', async function () {
		this.timeout(15000);

		const status = await checker.check(
			'nonexistent',
			'this-tool-does-not-exist-12345',
			'--version'
		);
		assert.strictEqual(status.available, false, 'nonexistent tool should not be available');
		assert.ok(status.error, 'Should have an error message');
	});

	test('Should cache results', async function () {
		this.timeout(15000);

		const first = await checker.check('test-cache', 'echo', 'v1');
		const second = await checker.check('test-cache', 'echo', 'v1');
		// Same object reference means it was cached
		assert.strictEqual(first, second, 'Second call should return cached result');
	});

	test('Should clear cache', async function () {
		this.timeout(15000);

		await checker.check('test-clear', 'echo', 'v1');
		checker.clearCache();
		const after = await checker.check('test-clear', 'echo', 'v1');
		// After clearing, it should have re-probed (new object)
		assert.ok(after.available);
	});

	test('Should format summary', async function () {
		this.timeout(15000);

		await checker.check('echo', 'echo', 'hello');
		await checker.check('missing', 'nonexistent-tool-xyz', '--version');

		const summary = checker.formatSummary();
		assert.ok(summary.includes('echo'), 'Summary should mention echo');
		assert.ok(summary.includes('missing'), 'Summary should mention missing');
		assert.ok(summary.includes('✓'), 'Summary should have a check mark');
		assert.ok(summary.includes('✗'), 'Summary should have an X mark');
	});
});

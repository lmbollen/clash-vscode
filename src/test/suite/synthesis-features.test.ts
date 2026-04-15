import * as assert from 'assert';
import * as vscode from 'vscode';
import { ModuleSynthesisResult } from '../../yosys-types';

/**
 * Tests for new synthesis features:
 * - synthesizeOnly command registration
 * - synthesisMode configuration setting
 * - ModuleSynthesisResult per-module fields
 */
suite('Synthesis Features', () => {

	// ---------------------------------------------------------------
	// Command registration
	// ---------------------------------------------------------------

	test('synthesizeOnly command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.synthesizeOnly'),
			'synthesizeOnly command should be registered'
		);
	});

	test('synthesizeFunction command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.synthesizeFunction'),
			'synthesizeFunction command should be registered'
		);
	});

	test('synthesizeAndPnR command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.synthesizeAndPnR'),
			'synthesizeAndPnR command should be registered'
		);
	});

	test('detectFunctions command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.detectFunctions'),
			'detectFunctions command should be registered'
		);
	});

	test('checkToolchain command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.checkToolchain'),
			'checkToolchain command should be registered'
		);
	});

	// ---------------------------------------------------------------
	// Configuration: synthesisMode
	// ---------------------------------------------------------------

	test('synthesisMode config defaults to per-module', () => {
		const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
		const mode = config.get<string>('synthesisMode');
		assert.strictEqual(mode, 'per-module');
	});

	test('synthesisMode config schema default is per-module', async () => {
		const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
		// Inspect the config — in extension host tests the schema is loaded
		// from package.json so we just verify the setting is readable
		const mode = config.inspect<string>('synthesisMode');
		assert.ok(mode, 'synthesisMode should be inspectable');
		assert.strictEqual(mode!.defaultValue, 'per-module');
	});

	// ---------------------------------------------------------------
	// ModuleSynthesisResult: per-module fields
	// ---------------------------------------------------------------

	test('ModuleSynthesisResult supports rtlilPath field', () => {
		const result: ModuleSynthesisResult = {
			name: 'testModule',
			success: true,
			netlistPath: '/tmp/test.json',
			rtlilPath: '/tmp/test.il',
			diagramJsonPath: '/tmp/test_diagram.json',
			elapsedMs: 100,
			errors: []
		};

		assert.strictEqual(result.rtlilPath, '/tmp/test.il');
		assert.strictEqual(result.diagramJsonPath, '/tmp/test_diagram.json');
	});

	test('ModuleSynthesisResult per-module fields are optional', () => {
		const result: ModuleSynthesisResult = {
			name: 'testModule',
			success: true,
			elapsedMs: 50,
			errors: []
		};

		assert.strictEqual(result.rtlilPath, undefined);
		assert.strictEqual(result.diagramJsonPath, undefined);
		assert.strictEqual(result.netlistPath, undefined);
	});
});

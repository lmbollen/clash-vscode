import * as assert from 'assert';
import * as vscode from 'vscode';
import { ModuleSynthesisResult, YosysOptions } from '../../yosys-types';

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

	test('openSettings command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.openSettings'),
			'openSettings command should be registered'
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

	// ---------------------------------------------------------------
	// Configuration: synthesisTarget
	// ---------------------------------------------------------------

	test('synthesisTarget config defaults to generic', () => {
		const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
		const target = config.get<string>('synthesisTarget');
		assert.strictEqual(target, 'generic');
	});

	test('synthesisTarget config schema default is generic', () => {
		const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
		const info = config.inspect<string>('synthesisTarget');
		assert.ok(info, 'synthesisTarget should be inspectable');
		assert.strictEqual(info!.defaultValue, 'generic');
	});

	test('synthesisScript per-target settings default to empty string', () => {
		const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
		const targets = ['generic', 'ice40', 'ecp5', 'xilinx', 'gowin', 'intel', 'quicklogic', 'sf2'];
		for (const id of targets) {
			const script = config.get<string>(`synthesisScript.${id}`);
			assert.strictEqual(script, '', `synthesisScript.${id} should default to empty string`);
		}
	});

	// ---------------------------------------------------------------
	// YosysOptions: customScript field
	// ---------------------------------------------------------------

	test('YosysOptions supports customScript field', () => {
		const opts: YosysOptions = {
			workspaceRoot: '/ws',
			outputDir: '/out',
			topModule: 'top',
			verilogPath: '/a.v',
			targetFamily: 'ecp5',
			customScript: 'read_verilog {files}\nsynth_ecp5 -top {topModule}',
		};
		assert.strictEqual(opts.customScript, 'read_verilog {files}\nsynth_ecp5 -top {topModule}');
	});

	test('YosysOptions customScript is optional', () => {
		const opts: YosysOptions = {
			workspaceRoot: '/ws',
			outputDir: '/out',
			topModule: 'top',
			verilogPath: '/a.v',
		};
		assert.strictEqual(opts.customScript, undefined);
	});

	test('YosysOptions supports all new targetFamily values', () => {
		const families: Array<YosysOptions['targetFamily']> = [
			'ice40', 'ecp5', 'xilinx', 'gowin', 'intel', 'quicklogic', 'sf2', 'generic'
		];
		for (const family of families) {
			const opts: YosysOptions = {
				workspaceRoot: '/ws',
				outputDir: '/out',
				topModule: 'top',
				verilogPath: '/a.v',
				targetFamily: family,
			};
			assert.strictEqual(opts.targetFamily, family);
		}
	});
});

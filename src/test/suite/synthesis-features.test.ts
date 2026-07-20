import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { ModuleSynthesisResult, YosysOptions } from '../../yosys-types';
import {
	getDefaultElaborationScript,
	getDefaultScript,
	TARGET_IDS,
} from '../../synthesis-targets';
import { YosysRunner } from '../../yosys-runner';

/**
 * Tests for the three-stage pipeline:
 * - elaborate / synthesize / placeAndRoute command registration
 * - outOfContext + elaborationScript configuration settings
 * - ModuleSynthesisResult per-module fields (incl. logic depth)
 */
suite('Synthesis Features', () => {

	suiteSetup(async () => {
		// The config tests below assert *effective* values equal the schema
		// defaults, so clear any workspace overrides first — e.g. values the
		// settings panel persisted into test-project/.vscode/settings.json
		// when someone used the extension on the test project itself.
		const config = vscode.workspace.getConfiguration('clash-toolkit');
		const keys = [
			'outOfContext',
			'synthesisTarget',
			'elaborationScript',
			...TARGET_IDS.map(id => `synthesisScript.${id}`),
		];
		for (const key of keys) {
			await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
		}
	});

	// ---------------------------------------------------------------
	// Command registration
	// ---------------------------------------------------------------

	test('elaborate command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-toolkit.elaborate'),
			'elaborate command should be registered'
		);
	});

	test('synthesize command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-toolkit.synthesize'),
			'synthesize command should be registered'
		);
	});

	test('synthesizeFunction command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-toolkit.synthesizeFunction'),
			'synthesizeFunction command should be registered'
		);
	});

	test('placeAndRoute command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-toolkit.placeAndRoute'),
			'placeAndRoute command should be registered'
		);
	});

	test('detectFunctions command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-toolkit.detectFunctions'),
			'detectFunctions command should be registered'
		);
	});

	test('checkToolchain command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-toolkit.checkToolchain'),
			'checkToolchain command should be registered'
		);
	});

	test('openSettings command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-toolkit.openSettings'),
			'openSettings command should be registered'
		);
	});

	// ---------------------------------------------------------------
	// Configuration: outOfContext
	// ---------------------------------------------------------------

	test('outOfContext config defaults to false', () => {
		const config = vscode.workspace.getConfiguration('clash-toolkit');
		const ooc = config.get<boolean>('outOfContext');
		assert.strictEqual(ooc, false);
	});

	test('outOfContext config schema default is false', async () => {
		const config = vscode.workspace.getConfiguration('clash-toolkit');
		const ooc = config.inspect<boolean>('outOfContext');
		assert.ok(ooc, 'outOfContext should be inspectable');
		assert.strictEqual(ooc!.defaultValue, false);
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
		const config = vscode.workspace.getConfiguration('clash-toolkit');
		const target = config.get<string>('synthesisTarget');
		assert.strictEqual(target, 'generic');
	});

	test('synthesisTarget config schema default is generic', () => {
		const config = vscode.workspace.getConfiguration('clash-toolkit');
		const info = config.inspect<string>('synthesisTarget');
		assert.ok(info, 'synthesisTarget should be inspectable');
		assert.strictEqual(info!.defaultValue, 'generic');
	});

	test('synthesisScript per-target settings default to empty string', () => {
		const config = vscode.workspace.getConfiguration('clash-toolkit');
		const targets = ['generic', 'ice40', 'ecp5', 'xilinx', 'gowin', 'quicklogic', 'sf2'];
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
			'ice40', 'ecp5', 'xilinx', 'gowin', 'quicklogic', 'sf2', 'generic', 'elaborate'
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

	// ---------------------------------------------------------------
	// Elaboration stage
	// ---------------------------------------------------------------

	test('elaborationScript setting defaults to empty string', () => {
		const config = vscode.workspace.getConfiguration('clash-toolkit');
		assert.strictEqual(config.get<string>('elaborationScript'), '');
	});

	test('default elaboration script is non-empty and contains hierarchy/proc', () => {
		const script = getDefaultElaborationScript();
		assert.ok(script.length > 0, 'default elaboration script must be non-empty');
		assert.ok(/hierarchy\s+-check/.test(script), 'should run hierarchy -check');
		assert.ok(/\bproc\b/.test(script), 'should run proc pass');
		assert.ok(!/techmap/.test(script), 'should NOT run techmap in elaboration');
		assert.ok(!/synth_/.test(script), 'should NOT run a synth_* pass in elaboration');
		assert.ok(/ltp\s+-noff/.test(script), 'should report logic depth');
	});

	// ---------------------------------------------------------------
	// Logic depth reporting
	// ---------------------------------------------------------------

	test('default synthesis scripts include ltp -noff', () => {
		for (const id of TARGET_IDS) {
			const script = getDefaultScript(id);
			assert.ok(
				/ltp\s+-noff/.test(script),
				`default script for target "${id}" should include ltp -noff`
			);
		}
	});

	test('loadStatistics throws loudly when stats.json is missing', async () => {
		// No text-parse fallback: a script that dropped `stat -json` must fail
		// visibly, not silently degrade to guessed statistics.
		const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-stats-'));
		try {
			await assert.rejects(
				() => YosysRunner.loadStatistics(emptyDir, 'irrelevant text output'),
				/stats\.json not found/
			);
		} finally {
			await fs.rm(emptyDir, { recursive: true, force: true });
		}
	});

	test('loadStatistics augments stats.json with ltp logic depth from the log', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-stats-'));
		try {
			await fs.writeFile(
				path.join(dir, 'stats.json'),
				JSON.stringify({ design: { num_cells: 16, num_wires: 42 } })
			);
			const log = [
				'-- Running command `ltp -noff` --',
				'',
				'Longest topological path in deepChain (length=16):',
				'    $add',
			].join('\n');
			const stats = await YosysRunner.loadStatistics(dir, log);
			assert.strictEqual(stats.logicDepth, 16);
			assert.strictEqual(stats.cellCount, 16);
			assert.strictEqual(stats.wireCount, 42);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	test('parseStatsJson extracts counts and cell types from stat -json output', () => {
		const statsJson = JSON.stringify({
			creator: 'Yosys 0.62',
			modules: {
				'\\top': {
					num_cells: 44,
					num_wires: 57,
					num_cells_by_type: {
						'$_AND_': 14,
						'$_OR_': 9,
						'$_XOR_': 13,
						'$_MUX_': 4,
						'$_NOT_': 4,
					},
					estimated_num_transistors: '350',
				},
			},
			design: {
				num_cells: 44,
				num_wires: 57,
				num_cells_by_type: {
					'$_AND_': 14,
					'$_OR_': 9,
					'$_XOR_': 13,
					'$_MUX_': 4,
					'$_NOT_': 4,
				},
				estimated_num_transistors: '350',
			},
		});
		const stats = YosysRunner.parseStatsJson(statsJson);
		assert.strictEqual(stats.cellCount, 44);
		assert.strictEqual(stats.wireCount, 57);
		assert.strictEqual(stats.chipArea, 350);
		assert.ok(stats.cellTypes, 'should extract cell types');
		assert.strictEqual(stats.cellTypes!.get('$_AND_'), 14);
		assert.strictEqual(stats.cellTypes!.get('$_XOR_'), 13);
	});

	test('parseStatsJson falls back to module aggregate when design block is missing', () => {
		const statsJson = JSON.stringify({
			modules: {
				'\\a': { num_cells: 3, num_wires: 5, num_cells_by_type: { '$and': 3 } },
				'\\b': { num_cells: 7, num_wires: 2, num_cells_by_type: { '$and': 1, '$or': 6 } },
			},
		});
		const stats = YosysRunner.parseStatsJson(statsJson);
		assert.strictEqual(stats.cellCount, 10);
		assert.strictEqual(stats.wireCount, 7);
		assert.strictEqual(stats.cellTypes!.get('$and'), 4);
		assert.strictEqual(stats.cellTypes!.get('$or'), 6);
	});

	test('parseStatsJson throws loudly on malformed JSON', () => {
		assert.throws(
			() => YosysRunner.parseStatsJson('{not valid json'),
			/stats\.json is unparseable/
		);
	});

	test('parseStatsJson throws loudly on valid JSON with no stats blocks', () => {
		assert.throws(
			() => YosysRunner.parseStatsJson('{"creator": "Yosys 0.62"}'),
			/neither a "design" nor a "modules" block/
		);
	});

	test('synthesize honours abortSignal: kills yosys and reports cancellation', async function () {
		this.timeout(20_000);

		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-cancel-'));
		const cfg = vscode.workspace.getConfiguration('clash-toolkit');
		const channel = vscode.window.createOutputChannel('Test Yosys Cancel');
		try {
			// A fake "yosys" that never exits on its own — the runner must
			// SIGTERM it via the abort signal. Pointing yosysCommand at it
			// also exercises the setting-resolution path.
			const fakeJs = path.join(tmp, 'fake-yosys.js');
			await fs.writeFile(fakeJs, 'setInterval(() => process.stdout.write("Info: alive\\n"), 100);\n');
			await cfg.update('yosysCommand', `node ${fakeJs}`, vscode.ConfigurationTarget.Workspace);

			const verilog = path.join(tmp, 'top.v');
			await fs.writeFile(verilog, 'module top; endmodule\n');

			const controller = new AbortController();
			setTimeout(() => controller.abort(), 400);

			const runner = new YosysRunner(channel);
			const result = await runner.synthesize({
				workspaceRoot: tmp,
				outputDir: path.join(tmp, 'out'),
				topModule: 'top',
				verilogPath: [verilog],
				targetFamily: 'generic',
				abortSignal: controller.signal,
			});

			assert.strictEqual(result.success, false, 'Cancelled run is not a success');
			assert.ok(
				result.errors.some(e => /cancel/i.test(e.message)),
				`Cancellation should be surfaced. Got: ${JSON.stringify(result.errors)}`
			);
		} finally {
			await cfg.update('yosysCommand', undefined, vscode.ConfigurationTarget.Workspace);
			channel.dispose();
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});

	test('synthesize with an already-aborted signal fails as cancelled', async function () {
		this.timeout(20_000);

		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-cancel-'));
		const channel = vscode.window.createOutputChannel('Test Yosys Pre-Cancel');
		try {
			const verilog = path.join(tmp, 'top.v');
			await fs.writeFile(verilog, 'module top; endmodule\n');

			const controller = new AbortController();
			controller.abort();

			const runner = new YosysRunner(channel);
			const result = await runner.synthesize({
				workspaceRoot: tmp,
				outputDir: path.join(tmp, 'out'),
				topModule: 'top',
				verilogPath: [verilog],
				targetFamily: 'generic',
				abortSignal: controller.signal,
			});

			assert.strictEqual(result.success, false);
			assert.ok(result.errors.some(e => /cancel/i.test(e.message)));
		} finally {
			channel.dispose();
			await fs.rm(tmp, { recursive: true, force: true });
		}
	});

	test('parseLogicDepth extracts length from ltp text', () => {
		const text = 'Longest topological path in deepChain (length=16):\n    stuff';
		assert.strictEqual(YosysRunner.parseLogicDepth(text), 16);
	});

	test('SynthesisStatistics.logicDepth is optional', () => {
		const stats: import('../../yosys-types').SynthesisStatistics = {
			rawStats: '',
		};
		assert.strictEqual(stats.logicDepth, undefined);
		stats.logicDepth = 7;
		assert.strictEqual(stats.logicDepth, 7);
	});
});

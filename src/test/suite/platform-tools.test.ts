import * as assert from 'assert';
import * as vscode from 'vscode';
import { ToolchainChecker } from '../../toolchain';
import { NextpnrRunner } from '../../nextpnr-runner';
import { YosysRunner } from '../../yosys-runner';
import { NextpnrFamily } from '../../nextpnr-types';

/**
 * Tests for platform tool support.
 *
 * Covers Yosys synthesis targets, nextpnr FPGA families, and ecppack.
 */
suite('Platform Tools Test Suite', () => {
	let outputChannel: vscode.OutputChannel;
	let checker: ToolchainChecker;

	suiteSetup(() => {
		outputChannel = vscode.window.createOutputChannel('Test Platform Tools');
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

	// ---------------------------------------------------------------
	// Yosys: tool availability
	// ---------------------------------------------------------------

	test('Yosys: should probe with -V flag', async function () {
		this.timeout(15000);
		const status = await checker.check('yosys', 'yosys', '-V');
		// We don't assert available (may not be installed in CI) — just that
		// the check completes without throwing and returns a valid ToolStatus.
		assert.strictEqual(status.name, 'yosys');
		assert.strictEqual(typeof status.available, 'boolean');
	});

	// ---------------------------------------------------------------
	// Yosys: synthesis command per target family
	// ---------------------------------------------------------------

	test('Yosys: getSynthCommand returns synth_ice40 for ice40', () => {
		const cmd = YosysRunner.getSynthCommand('ice40', 'top');
		assert.strictEqual(cmd, 'synth_ice40 -top top');
	});

	test('Yosys: getSynthCommand returns synth_ecp5 for ecp5', () => {
		const cmd = YosysRunner.getSynthCommand('ecp5', 'myDesign');
		assert.strictEqual(cmd, 'synth_ecp5 -top myDesign');
	});

	test('Yosys: getSynthCommand returns synth_xilinx for xilinx', () => {
		const cmd = YosysRunner.getSynthCommand('xilinx', 'top');
		assert.strictEqual(cmd, 'synth_xilinx -top top');
	});

	test('Yosys: getSynthCommand returns null for generic', () => {
		const cmd = YosysRunner.getSynthCommand('generic', 'top');
		assert.strictEqual(cmd, null);
	});

	test('Yosys: getSynthCommand returns null for unknown family', () => {
		const cmd = YosysRunner.getSynthCommand('unknown_family', 'top');
		assert.strictEqual(cmd, null);
	});

	// ---------------------------------------------------------------
	// Nextpnr: tool availability per family
	// ---------------------------------------------------------------

	const nextpnrFamilies: { family: NextpnrFamily; binary: string }[] = [
		{ family: 'ecp5', binary: 'nextpnr-ecp5' },
		{ family: 'ice40', binary: 'nextpnr-ice40' },
		{ family: 'gowin', binary: 'nextpnr-gowin' },
		{ family: 'nexus', binary: 'nextpnr-nexus' },
		{ family: 'machxo2', binary: 'nextpnr-machxo2' },
		{ family: 'generic', binary: 'nextpnr-generic' },
	];

	for (const { family, binary } of nextpnrFamilies) {
		test(`Nextpnr: getExecutable returns ${binary} for ${family}`, () => {
			assert.strictEqual(NextpnrRunner.getExecutable(family), binary);
		});
	}

	test('Nextpnr: getExecutable falls back to nextpnr-generic for unknown', () => {
		assert.strictEqual(NextpnrRunner.getExecutable('some_future_family'), 'nextpnr-generic');
	});

	test('Nextpnr (ecp5): should probe with --version flag', async function () {
		this.timeout(15000);
		const status = await checker.check('nextpnr-ecp5', 'nextpnr-ecp5', '--version');
		assert.strictEqual(status.name, 'nextpnr-ecp5');
		assert.strictEqual(typeof status.available, 'boolean');
	});

	test('Nextpnr (ice40): should probe with --version flag', async function () {
		this.timeout(15000);
		const status = await checker.check('nextpnr-ice40', 'nextpnr-ice40', '--version');
		assert.strictEqual(status.name, 'nextpnr-ice40');
		assert.strictEqual(typeof status.available, 'boolean');
	});

	// ---------------------------------------------------------------
	// Nextpnr: argument building per platform
	// ---------------------------------------------------------------

	test('Nextpnr: buildArgs for ECP5 25k CABGA381', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'ecp5',
				jsonPath: '/tmp/design.json',
				outputDir: '/tmp/out',
				topModule: 'top',
				ecp5: { device: '25k', package: 'CABGA381', speedGrade: '6' },
			},
			'/tmp/out/top.config'
		);
		assert.ok(args.includes('--json'), 'Should have --json');
		assert.ok(args.includes('/tmp/design.json'), 'Should have json path');
		assert.ok(args.includes('--textcfg'), 'Should have --textcfg');
		assert.ok(args.includes('--25k'), 'Should have device flag');
		assert.ok(args.includes('--package'), 'Should have --package');
		assert.ok(args.includes('CABGA381'), 'Should have package name');
		assert.ok(args.includes('--speed'), 'Should have --speed');
		assert.ok(args.includes('6'), 'Should have speed grade');
	});

	test('Nextpnr: buildArgs for ECP5 85k CABGA756', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'ecp5',
				jsonPath: '/tmp/design.json',
				outputDir: '/tmp/out',
				topModule: 'top',
				ecp5: { device: '85k', package: 'CABGA756' },
			},
			'/tmp/out/top.config'
		);
		assert.ok(args.includes('--85k'), 'Should have --85k device');
		assert.ok(args.includes('CABGA756'), 'Should have CABGA756 package');
		// No speed grade specified — should not have --speed
		assert.ok(!args.includes('--speed'), 'Should NOT have --speed when omitted');
	});

	test('Nextpnr: buildArgs for ECP5 um5g-45k', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'ecp5',
				jsonPath: '/tmp/design.json',
				outputDir: '/tmp/out',
				topModule: 'top',
				ecp5: { device: 'um5g-45k', package: 'CABGA554', speedGrade: '8' },
			},
			'/tmp/out/top.config'
		);
		assert.ok(args.includes('--um5g-45k'), 'Should have --um5g-45k');
		assert.ok(args.includes('CABGA554'));
		assert.ok(args.includes('8'), 'Speed grade 8');
	});

	test('Nextpnr: buildArgs includes --lpf for ECP5 constraints', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'ecp5',
				jsonPath: '/tmp/d.json',
				outputDir: '/tmp/out',
				topModule: 'top',
				ecp5: { device: '25k', package: 'CABGA381' },
				constraintsFile: '/tmp/pins.lpf',
			},
			'/tmp/out/top.config'
		);
		assert.ok(args.includes('--lpf'), 'ECP5 should use --lpf for constraints');
		assert.ok(args.includes('/tmp/pins.lpf'));
	});

	test('Nextpnr: buildArgs includes --pcf for iCE40 constraints', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'ice40',
				jsonPath: '/tmp/d.json',
				outputDir: '/tmp/out',
				topModule: 'top',
				constraintsFile: '/tmp/pins.pcf',
			},
			'/tmp/out/top.config'
		);
		assert.ok(args.includes('--pcf'), 'iCE40 should use --pcf for constraints');
		assert.ok(args.includes('/tmp/pins.pcf'));
	});

	test('Nextpnr: buildArgs includes --freq', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'ecp5',
				jsonPath: '/tmp/d.json',
				outputDir: '/tmp/out',
				topModule: 'top',
				ecp5: { device: '25k', package: 'CABGA381' },
				frequency: 50,
			},
			'/tmp/out/top.config'
		);
		assert.ok(args.includes('--freq'), 'Should have --freq');
		assert.ok(args.includes('50'), 'Should have frequency value');
	});

	test('Nextpnr: buildArgs includes --seed', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'ecp5',
				jsonPath: '/tmp/d.json',
				outputDir: '/tmp/out',
				topModule: 'top',
				ecp5: { device: '25k', package: 'CABGA381' },
				seed: 42,
			},
			'/tmp/out/top.config'
		);
		assert.ok(args.includes('--seed'), 'Should have --seed');
		assert.ok(args.includes('42'), 'Should have seed value');
	});

	test('Nextpnr: buildArgs includes timing-allow-fail', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'ecp5',
				jsonPath: '/tmp/d.json',
				outputDir: '/tmp/out',
				topModule: 'top',
				ecp5: { device: '25k', package: 'CABGA381' },
				timing: true,
			},
			'/tmp/out/top.config'
		);
		assert.ok(args.includes('--timing-allow-fail'), 'Should have --timing-allow-fail');
	});

	test('Nextpnr: buildArgs includes extra args', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'ecp5',
				jsonPath: '/tmp/d.json',
				outputDir: '/tmp/out',
				topModule: 'top',
				ecp5: { device: '25k', package: 'CABGA381' },
				extraArgs: ['--placer', 'heap', '--router', 'router2'],
			},
			'/tmp/out/top.config'
		);
		assert.ok(args.includes('--placer'), 'Should have extra --placer');
		assert.ok(args.includes('heap'));
		assert.ok(args.includes('--router'));
		assert.ok(args.includes('router2'));
	});

	test('Nextpnr: buildArgs minimal (no ECP5 options for generic)', () => {
		const args = NextpnrRunner.buildNextpnrArgs(
			{
				family: 'generic',
				jsonPath: '/tmp/d.json',
				outputDir: '/tmp/out',
				topModule: 'top',
			},
			'/tmp/out/top.config'
		);
		// Should only have --json and --textcfg
		assert.deepStrictEqual(args, [
			'--json', '/tmp/d.json',
			'--textcfg', '/tmp/out/top.config',
		]);
	});

	// ---------------------------------------------------------------
	// Ecppack: tool availability
	// ---------------------------------------------------------------

	test('Ecppack: should probe with --help flag', async function () {
		this.timeout(15000);
		const status = await checker.check('ecppack', 'ecppack', '--help');
		assert.strictEqual(status.name, 'ecppack');
		assert.strictEqual(typeof status.available, 'boolean');
	});

	// ---------------------------------------------------------------
	// Cabal: tool availability (needed by synth project)
	// ---------------------------------------------------------------

	test('Cabal: should probe with --version flag', async function () {
		this.timeout(15000);
		const status = await checker.check('cabal', 'cabal', '--version');
		assert.strictEqual(status.name, 'cabal');
		assert.strictEqual(typeof status.available, 'boolean');
	});

	// ---------------------------------------------------------------
	// checkAll: all tools in a single call
	// ---------------------------------------------------------------

	test('checkAll should check cabal, yosys, nextpnr-ecp5, ecppack', async function () {
		this.timeout(30000);
		const results = await checker.checkAll();
		assert.ok(results.has('cabal'), 'Should check cabal');
		assert.ok(results.has('yosys'), 'Should check yosys');
		assert.ok(results.has('nextpnr-ecp5'), 'Should check nextpnr-ecp5');
		assert.ok(results.has('ecppack'), 'Should check ecppack');
		assert.strictEqual(results.size, 4, 'Should check exactly 4 tools');
	});

	// ---------------------------------------------------------------
	// formatSummary with all tools
	// ---------------------------------------------------------------

	test('formatSummary should include all checked tools', async function () {
		this.timeout(30000);
		await checker.checkAll();
		const summary = checker.formatSummary();
		assert.ok(summary.includes('cabal'), 'Summary should mention cabal');
		assert.ok(summary.includes('yosys'), 'Summary should mention yosys');
		assert.ok(summary.includes('nextpnr-ecp5'), 'Summary should mention nextpnr-ecp5');
		assert.ok(summary.includes('ecppack'), 'Summary should mention ecppack');
	});
});

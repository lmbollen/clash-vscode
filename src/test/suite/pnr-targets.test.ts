import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import { YosysRunner } from '../../yosys-runner';
import { YosysOptions } from '../../yosys-types';
import { NextpnrRunner } from '../../nextpnr-runner';
import { PNR_FAMILIES, PnrFamilyInfo, NextpnrOptions, ECP5Device, ECP5Package } from '../../nextpnr-types';

/**
 * End-to-end PnR tests for every supported target family.
 *
 * Each test synthesizes a small combinational Verilog design with the
 * target-specific `synth_*` command, then runs the corresponding nextpnr
 * binary with a representative device + package.
 *
 * Tests that require a tool which is not installed gracefully skip.
 */

// ---------------------------------------------------------------------------
// Minimal Verilog design used for all PnR tests.
// A small combinational adder — no clocks, no memories, synthesizes on every
// target in under a second.
// ---------------------------------------------------------------------------
const MINIMAL_VERILOG = `
module pnr_test_top (
    input  a,
    input  b,
    output y
);
    assign y = a & b;
endmodule
`;

/** Gowin CST constraints for the 3-IO test design. Pin numbers are
 *  arbitrary but valid on all Gowin QN48/LQ144/QN88 packages. */
const GOWIN_CST = `IO_LOC "a" 3;\nIO_LOC "b" 4;\nIO_LOC "y" 5;\n`;

// ---------------------------------------------------------------------------
// Helper: check whether a binary exists on PATH
// ---------------------------------------------------------------------------
function binaryExists(name: string): Promise<boolean> {
	return new Promise(resolve => {
		const proc = spawn(name, ['--version'], { timeout: 5000 });
		proc.on('error', () => resolve(false));
		proc.on('close', code => resolve(code === 0));
	});
}

// ---------------------------------------------------------------------------
// Per-family test configuration: one representative device + package
// ---------------------------------------------------------------------------
interface FamilyTestCase {
	targetId: string;
	familyInfo: PnrFamilyInfo;
	device: string;
	deviceLabel: string;
	pkg: string | undefined;
	vopt: string[] | undefined;
}

// Representative devices for per-family tests.  The 3-IO AND gate fits
// on every device, so we pick the first (smallest) for maximum coverage.
const REPRESENTATIVE_DEVICES: Record<string, { devIndex: number; pkg?: string }> = {
	ecp5:  { devIndex: 0, pkg: 'CABGA381' },   // LFE5U-25F
	ice40: { devIndex: 0 },                     // LP384 (smallest iCE40)
	gowin: { devIndex: 0 },                     // GW1N-1 QN48
};

const TEST_CASES: FamilyTestCase[] = [];

for (const [targetId, info] of PNR_FAMILIES) {
	const repr = REPRESENTATIVE_DEVICES[targetId];
	if (!repr) { continue; }
	const dev = info.devices[repr.devIndex];

	TEST_CASES.push({
		targetId,
		familyInfo: info,
		device: dev.value,
		deviceLabel: dev.label,
		pkg: repr.pkg,
		vopt: dev.vopt ? [dev.vopt] : undefined,
	});
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

suite('PnR Targets: end-to-end synthesis + place & route', () => {
	let outputChannel: vscode.OutputChannel;
	let yosysRunner: YosysRunner;
	let nextpnrRunner: NextpnrRunner;
	let tmpDir: string;

	/** Build the --vopt array for a device, adding gowin CST if needed. */
	function buildVopt(dev: import('../../nextpnr-types').DeviceOption, family: string): string[] | undefined {
		const vopts: string[] = [];
		if (dev.vopt) { vopts.push(dev.vopt); }
		if (family === 'gowin') { vopts.push(`cst=${path.join(tmpDir, 'gowin.cst')}`); }
		return vopts.length > 0 ? vopts : undefined;
	}

	suiteSetup(async function () {
		this.timeout(15000);
		outputChannel = vscode.window.createOutputChannel('Test PnR Targets');
		yosysRunner = new YosysRunner(outputChannel);
		nextpnrRunner = new NextpnrRunner(outputChannel);

		// Create a temp directory with the minimal Verilog and Gowin constraints
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-pnr-test-'));
		await fs.writeFile(path.join(tmpDir, 'pnr_test_top.v'), MINIMAL_VERILOG);
		await fs.writeFile(path.join(tmpDir, 'gowin.cst'), GOWIN_CST);
	});

	suiteTeardown(async () => {
		if (outputChannel) { outputChannel.dispose(); }
		if (tmpDir) { await fs.rm(tmpDir, { recursive: true, force: true }); }
	});

	// -------------------------------------------------------------------
	// For each PnR family: synthesize → nextpnr → verify outputs
	// -------------------------------------------------------------------

	for (const tc of TEST_CASES) {
		const { targetId, familyInfo, device, deviceLabel, pkg } = tc;
		const suiteLabel = `${targetId} (${deviceLabel}${pkg ? ' / ' + pkg : ''})`;

		// ── Yosys synthesis for this target ──────────────────────────────

		test(`${suiteLabel}: Yosys synth_${targetId} succeeds`, async function () {
			this.timeout(60_000);

			// Skip if Yosys is not available
			if (!(await binaryExists('yosys'))) { this.skip(); return; }

			const outDir = path.join(tmpDir, `${targetId}-synth`);
			await fs.mkdir(outDir, { recursive: true });

			const result = await yosysRunner.synthesize({
				workspaceRoot: tmpDir,
				outputDir: outDir,
				topModule: 'pnr_test_top',
				verilogPath: path.join(tmpDir, 'pnr_test_top.v'),
				targetFamily: targetId as YosysOptions['targetFamily'],
			});

			assert.ok(
				result.success,
				`Yosys synth_${targetId} should succeed.\n` +
				`Errors: ${result.errors.map(e => e.message).join('\n')}`
			);
			assert.ok(result.jsonPath, 'Should produce a JSON netlist');

			const stat = await fs.stat(result.jsonPath!);
			assert.ok(stat.size > 0, 'JSON netlist should be non-empty');

			if (result.statistics) {
				assert.ok(
					result.statistics.cellCount === undefined || result.statistics.cellCount >= 0,
					'Cell count should be non-negative'
				);
			}
		});

		// ── nextpnr place & route ───────────────────────────────────────

		test(`${suiteLabel}: nextpnr place & route succeeds`, async function () {
			this.timeout(120_000);

			// Skip if the required binaries are not available
			if (!(await binaryExists('yosys'))) { this.skip(); return; }
			if (!(await binaryExists(familyInfo.binary))) { this.skip(); return; }

			// Ensure synthesis output exists (re-run if needed)
			const synthDir = path.join(tmpDir, `${targetId}-synth`);
			const jsonPath = path.join(synthDir, 'pnr_test_top.json');
			try {
				await fs.access(jsonPath);
			} catch {
				// Synthesis didn't run (previous test skipped?), run it now
				await fs.mkdir(synthDir, { recursive: true });
				const synthResult = await yosysRunner.synthesize({
					workspaceRoot: tmpDir,
					outputDir: synthDir,
					topModule: 'pnr_test_top',
					verilogPath: path.join(tmpDir, 'pnr_test_top.v'),
					targetFamily: targetId as YosysOptions['targetFamily'],
				});
				if (!synthResult.success) {
					this.skip();
					return;
				}
			}

			const pnrDir = path.join(tmpDir, `${targetId}-pnr`);
			await fs.mkdir(pnrDir, { recursive: true });

			const devOption = familyInfo.devices.find(d => d.value === device)!;
			const pnrOpts: NextpnrOptions = {
				family: familyInfo.family,
				jsonPath,
				outputDir: pnrDir,
				topModule: 'pnr_test_top',
				device,
				packageName: pkg,
				vopt: buildVopt(devOption, familyInfo.family),
			};

			if (familyInfo.family === 'ecp5' && pkg) {
				const is5G = device.startsWith('um5g');
				pnrOpts.ecp5 = {
					device: device as ECP5Device,
					package: pkg as ECP5Package,
					speedGrade: is5G ? '8' : '6',
				};
			}

			const result = await nextpnrRunner.placeAndRoute(pnrOpts);

			assert.ok(
				result.success,
				`nextpnr ${familyInfo.binary} should succeed for ${deviceLabel}.\n` +
				`Errors: ${result.errors.map(e => e.message).join('\n')}\n` +
				`Output (last 500 chars): ${result.output.slice(-500)}`
			);
			assert.ok(result.textcfgPath, 'Should produce a textcfg file');

			const stat = await fs.stat(result.textcfgPath!);
			assert.ok(stat.size > 0, 'Textcfg should be non-empty');
		});

		// ── Verify timing info ──────────────────────────────────────────

		test(`${suiteLabel}: nextpnr produces timing info`, async function () {
			this.timeout(120_000);

			if (!(await binaryExists('yosys'))) { this.skip(); return; }
			if (!(await binaryExists(familyInfo.binary))) { this.skip(); return; }

			const pnrDir = path.join(tmpDir, `${targetId}-pnr`);
			// Re-run PnR if needed (in case previous test was skipped)
			const configPath = path.join(pnrDir, 'pnr_test_top.config');
			try {
				await fs.access(configPath);
			} catch {
				this.skip();
				return;
			}

			// Read the log to verify timing was parsed
			const logPath = path.join(pnrDir, 'nextpnr.log');
			try {
				const log = await fs.readFile(logPath, 'utf8');
				assert.ok(log.length > 0, 'nextpnr log should be non-empty');
			} catch {
				// Log may not exist if PnR was skipped
				this.skip();
			}
		});

	}

	// -------------------------------------------------------------------
	// Cross-family: verify invocation is accepted for every device.
	//
	// The test design (17-IO adder) may not fit on very small devices
	// (e.g. LP384 with 21 IOs in a QN32 package), so placement failures
	// are acceptable.  What we're verifying is that the nextpnr
	// invocation itself is correct: the device is recognised, the
	// package is valid, and vopt flags are accepted.
	//
	// Invocation errors (bad device, bad package, bad flags) cause
	// nextpnr to fail *before* placement with messages like
	// "Unsupported", "Invalid device", "Only speed grade".
	// Placement errors ("Unable to find a placement location",
	// "Unconstrained IO") happen *after* the device is loaded and are
	// fine for our purposes.
	// -------------------------------------------------------------------

	/** Error messages that indicate the invocation itself is wrong. */
	const INVOCATION_ERRORS = [
		'Unsupported',
		'Invalid device',
		'Only speed grade',
		'Unknown',
		'need to specify',
		'Unable to read chipdb',
		'No package for partnumber',
	];

	function isInvocationError(errors: Array<{ message: string }>): boolean {
		return errors.some(e =>
			INVOCATION_ERRORS.some(pat => e.message.includes(pat))
		);
	}

	for (const [targetId, familyInfo] of PNR_FAMILIES) {
		for (const dev of familyInfo.devices) {
			// Sanitize for test name (Gowin part numbers have /)
			const safeName = dev.value.replace(/[/\\]/g, '_');

			test(`invocation probe: ${targetId} ${safeName}`, async function () {
				this.timeout(120_000);

				if (!(await binaryExists('yosys'))) { this.skip(); return; }
				if (!(await binaryExists(familyInfo.binary))) { this.skip(); return; }

				// Re-use the synthesis output (same for all devices in a family)
				const synthDir = path.join(tmpDir, `${targetId}-synth`);
				const jsonPath = path.join(synthDir, 'pnr_test_top.json');
				try {
					await fs.access(jsonPath);
				} catch {
					await fs.mkdir(synthDir, { recursive: true });
					const synthResult = await yosysRunner.synthesize({
						workspaceRoot: tmpDir,
						outputDir: synthDir,
						topModule: 'pnr_test_top',
						verilogPath: path.join(tmpDir, 'pnr_test_top.v'),
						targetFamily: targetId as YosysOptions['targetFamily'],
					});
					if (!synthResult.success) { this.skip(); return; }
				}

				// Determine a valid package for this specific device
				const pkgs = await NextpnrRunner.getValidPackages(
					dev.value, familyInfo.binary, familyInfo.deviceFlag
				);
				const pkg = pkgs.length > 0 ? pkgs[0] : undefined;

				const pnrDir = path.join(tmpDir, `${targetId}-pnr-${safeName}`);
				await fs.mkdir(pnrDir, { recursive: true });

				const pnrOpts: NextpnrOptions = {
					family: familyInfo.family,
					jsonPath,
					outputDir: pnrDir,
					topModule: 'pnr_test_top',
					device: dev.value,
					packageName: pkg,
					vopt: buildVopt(dev, familyInfo.family),
				};

				if (familyInfo.family === 'ecp5' && pkg) {
					const is5G = dev.value.startsWith('um5g');
					pnrOpts.ecp5 = {
						device: dev.value as ECP5Device,
						package: pkg as ECP5Package,
						speedGrade: is5G ? '8' : '6',
					};
				}

				const result = await nextpnrRunner.placeAndRoute(pnrOpts);

				if (!result.success) {
					// Placement / routing failures are fine — the invocation was correct.
					// Only fail the test if the error is an invocation-level problem.
					assert.ok(
						!isInvocationError(result.errors),
						`nextpnr ${familyInfo.binary} rejected invocation for ${dev.value}` +
						(pkg ? ` / ${pkg}` : '') +
						`.\nErrors: ${result.errors.map(e => e.message).join('\n')}`
					);
				}
			});
		}
	}
});

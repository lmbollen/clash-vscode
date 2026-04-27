import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { NextpnrRunner } from '../../nextpnr-runner';
import { NextpnrOptions } from '../../nextpnr-types';

/**
 * Regression tests for the nextpnr child-process lifecycle handling.
 *
 * These drive `runNextpnr` directly against a fake nextpnr (a Node `-e`
 * script) so we can deterministically reproduce the conditions under which
 * an earlier bug manifested: the runner listened on the child's `'exit'`
 * event (which fires before stdio is drained) instead of `'close'` (which
 * fires after all stdout has been consumed). The bug caused PnR to finalize
 * with a truncated `result.output` and missing timing data.
 */
suite('NextpnrRunner: child-process lifecycle', () => {
	let outputChannel: vscode.OutputChannel;
	let runner: NextpnrRunner;
	let tmpDir: string;

	suiteSetup(async () => {
		outputChannel = vscode.window.createOutputChannel('Test NextpnrRunner');
		runner = new NextpnrRunner(outputChannel);
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nextpnr-runner-test-'));
	});

	suiteTeardown(async () => {
		outputChannel?.dispose();
		if (tmpDir) { await fs.rm(tmpDir, { recursive: true, force: true }); }
	});

	function makePnrOpts(outputDir: string): NextpnrOptions {
		return {
			family: 'ecp5',
			jsonPath: path.join(tmpDir, 'unused.json'),
			outputDir,
			topModule: 'fake_top',
		};
	}

	// ── Regression test ────────────────────────────────────────────────────

	test(
		'regression: result.output includes data emitted just before exit '
		+ '(must wait for `close`, not `exit`)',
		async function () {
			this.timeout(15_000);

			const outDir = await fs.mkdtemp(path.join(tmpDir, 'out-'));

			// The fake binary writes well over the typical 64 KB pipe buffer,
			// then a final marker line, then asks for a non-zero exit. The flood
			// ensures the parent's stream consumption is still in flight when
			// the child finishes — making it a reliable trigger for the bug,
			// where listening on 'exit' would resolve the Promise before the
			// marker line was observed by the parent.
			//
			// We set `process.exitCode` instead of calling `process.exit()` so
			// Node exits naturally after stdout drains — `process.exit()` aborts
			// pending pipe writes, which would lose the marker in the *child*
			// before it ever reaches us, and that loss is unrelated to whether
			// the parent listens on 'close' vs 'exit'.
			const fakeScript = [
				`const filler = 'x'.repeat(1024) + '\\n';`,
				// 200 KB of filler to exceed the pipe buffer.
				`for (let i = 0; i < 200; i++) process.stdout.write(filler);`,
				`process.stdout.write('END_OF_OUTPUT_MARKER\\n');`,
				`process.exitCode = 1;`,
			].join('\n');

			const result = await runner.runNextpnr(
				'node',
				['-e', fakeScript],
				makePnrOpts(outDir),
				{ reportJsonPath: path.join(outDir, 'report.json') }
			);

			assert.strictEqual(
				result.success, false,
				'Non-zero exit should produce success=false'
			);

			assert.ok(
				result.output.includes('END_OF_OUTPUT_MARKER'),
				'result.output should contain the final marker emitted just '
				+ 'before exit. Missing it indicates the runner finalized on '
				+ '`exit` rather than `close`, truncating stdout.\n'
				+ `Output length: ${result.output.length}\n`
				+ `Tail: ${JSON.stringify(result.output.slice(-200))}`
			);
		}
	);

	test(
		'regression: timing-style trailing lines are parseable from result.output',
		async function () {
			this.timeout(15_000);

			const outDir = await fs.mkdtemp(path.join(tmpDir, 'out-'));

			// Mirror nextpnr's own output shape: chatter, then the timing
			// summary, then a 0 exit. parseTiming's regex on result.output
			// should pick up the frequency. With the bug, the trailing lines
			// would be lost and timing would be undefined.
			// Same rationale as the previous test: avoid `process.exit()` so
			// pending pipe writes drain before Node tears down stdout. Exit
			// code 0 is the default, so we just let the event loop wind down.
			const fakeScript = [
				`const filler = 'noise '.repeat(200) + '\\n';`,
				`for (let i = 0; i < 500; i++) process.stdout.write(filler);`,
				`process.stdout.write('Info: Critical path report\\n');`,
				`process.stdout.write("Info: Max frequency for clock 'clk': 123.45 MHz\\n");`,
			].join('\n');

			const result = await runner.runNextpnr(
				'node',
				['-e', fakeScript],
				makePnrOpts(outDir),
				{ reportJsonPath: path.join(outDir, 'report.json') }
			);

			assert.ok(
				result.output.includes('123.45 MHz'),
				'Timing line emitted just before exit must survive into '
				+ 'result.output (otherwise parseTiming would silently miss it).'
			);

			// Sanity: confirm the runner actually parsed it. This is the
			// user-visible regression — without close-event handling, timing
			// would be undefined even when the design completed PnR.
			assert.ok(
				result.timing,
				'result.timing should be populated when stdout includes a '
				+ '"Max frequency" line'
			);
			assert.strictEqual(result.timing?.maxFrequency, 123.45);
		}
	);

	// ── Cancellation contract ──────────────────────────────────────────────

	test('abortSignal terminates the run and resolves with a cancellation error', async function () {
		this.timeout(15_000);

		const outDir = await fs.mkdtemp(path.join(tmpDir, 'out-'));

		// Fake binary that prints a line every 100 ms and never exits on its
		// own — the runner must SIGTERM it via the abort signal.
		const fakeScript = [
			`setInterval(() => process.stdout.write('Info: still alive\\n'), 100);`,
		].join('\n');

		const controller = new AbortController();
		const opts: NextpnrOptions = { ...makePnrOpts(outDir), abortSignal: controller.signal };

		// Trigger the abort shortly after the child starts.
		setTimeout(() => controller.abort(), 300);

		const result = await runner.runNextpnr(
			'node',
			['-e', fakeScript],
			opts,
			{ reportJsonPath: path.join(outDir, 'report.json') }
		);

		assert.strictEqual(result.success, false, 'Cancelled run is not a success');
		assert.ok(
			result.errors.some(e => /cancel/i.test(e.message)),
			`Cancellation error should be surfaced. Got: ${JSON.stringify(result.errors)}`
		);
	});

	// ── Progress streaming ─────────────────────────────────────────────────

	test('progressUpdate fires for each parsed nextpnr stage', async function () {
		this.timeout(15_000);

		const outDir = await fs.mkdtemp(path.join(tmpDir, 'out-'));

		const fakeScript = [
			`process.stdout.write('Info: Packing design\\n');`,
			`process.stdout.write('Info: Placing constraints\\n');`,
			`process.stdout.write('Info: Routing\\n');`,
			`process.stdout.write('Info: Critical path report follows\\n');`,
			`process.exit(0);`,
		].join('\n');

		const updates: string[] = [];
		const opts: NextpnrOptions = {
			...makePnrOpts(outDir),
			progressUpdate: (msg) => updates.push(msg),
		};

		await runner.runNextpnr(
			'node',
			['-e', fakeScript],
			opts,
			{ reportJsonPath: path.join(outDir, 'report.json') }
		);

		// We should have seen at least packing, placing, routing, timing.
		assert.ok(updates.includes('Packing design'), `expected Packing in ${JSON.stringify(updates)}`);
		assert.ok(updates.some(u => /placing/i.test(u)), `expected a Placing stage in ${JSON.stringify(updates)}`);
		assert.ok(updates.includes('Routing'), `expected Routing in ${JSON.stringify(updates)}`);
		assert.ok(updates.includes('Timing analysis'), `expected Timing analysis in ${JSON.stringify(updates)}`);
	});
});

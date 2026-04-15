import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { ClashManifestParser } from '../../clash-manifest-parser';

/**
 * Tests for SDC frequency parsing.
 */
suite('SDC Frequency Parser', () => {
	let parser: ClashManifestParser;
	let tmpDir: string;

	suiteSetup(async () => {
		parser = new ClashManifestParser();
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-sdc-test-'));
	});

	suiteTeardown(async () => {
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	test('parses standard Clash SDC with 20ns period (50 MHz)', async () => {
		const dir = path.join(tmpDir, 'test1');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(
			path.join(dir, 'top_entity.sdc'),
			'create_clock -name {CLK} -period 20.000 -waveform {0.000 10.000} [get_ports {CLK}]\n'
		);

		const freq = await parser.parseSdcFrequency(dir);
		assert.ok(freq !== undefined, 'Should parse a frequency');
		assert.strictEqual(freq!, 50); // 1000 / 20 = 50 MHz
	});

	test('parses SDC with 10ns period (100 MHz)', async () => {
		const dir = path.join(tmpDir, 'test2');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(
			path.join(dir, 'clk.sdc'),
			'create_clock -name {CLK} -period 10.000 -waveform {0.000 5.000} [get_ports {CLK}]\n'
		);

		const freq = await parser.parseSdcFrequency(dir);
		assert.ok(freq !== undefined);
		assert.strictEqual(freq!, 100);
	});

	test('parses SDC with integer period (no decimal)', async () => {
		const dir = path.join(tmpDir, 'test3');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(
			path.join(dir, 'clock.sdc'),
			'create_clock -name {CLK} -period 8 [get_ports {CLK}]\n'
		);

		const freq = await parser.parseSdcFrequency(dir);
		assert.ok(freq !== undefined);
		assert.strictEqual(freq!, 125); // 1000 / 8 = 125 MHz
	});

	test('returns undefined for empty SDC file', async () => {
		const dir = path.join(tmpDir, 'test4');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, 'empty.sdc'), '');

		const freq = await parser.parseSdcFrequency(dir);
		assert.strictEqual(freq, undefined);
	});

	test('returns undefined when no SDC files exist', async () => {
		const dir = path.join(tmpDir, 'test5');
		await fs.mkdir(dir, { recursive: true });
		// Write a non-SDC file to ensure it's not picked up
		await fs.writeFile(path.join(dir, 'constraints.lpf'), 'LOCATE COMP "CLK" SITE "P6";');

		const freq = await parser.parseSdcFrequency(dir);
		assert.strictEqual(freq, undefined);
	});

	test('picks up first SDC with a create_clock when multiple exist', async () => {
		const dir = path.join(tmpDir, 'test6');
		await fs.mkdir(dir, { recursive: true });
		// First file is empty (like accum.sdc in real Clash output)
		await fs.writeFile(path.join(dir, 'accum.sdc'), '');
		// Second file has the clock constraint
		await fs.writeFile(
			path.join(dir, 'top.sdc'),
			'create_clock -name {CLK} -period 40.000 -waveform {0.000 20.000} [get_ports {CLK}]\n'
		);

		const freq = await parser.parseSdcFrequency(dir);
		assert.ok(freq !== undefined, 'Should find frequency in second file');
		assert.strictEqual(freq!, 25); // 1000 / 40 = 25 MHz
	});

	test('ignores SDC lines without create_clock', async () => {
		const dir = path.join(tmpDir, 'test7');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(
			path.join(dir, 'timing.sdc'),
			'# This is a comment\nset_input_delay -clock CLK 2.0 [all_inputs]\n'
		);

		const freq = await parser.parseSdcFrequency(dir);
		assert.strictEqual(freq, undefined);
	});

	test('handles SDC with minimal create_clock syntax', async () => {
		const dir = path.join(tmpDir, 'test8');
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(
			path.join(dir, 'min.sdc'),
			'create_clock -period 5.0 [get_ports CLK]\n'
		);

		const freq = await parser.parseSdcFrequency(dir);
		assert.ok(freq !== undefined);
		assert.strictEqual(freq!, 200); // 1000 / 5 = 200 MHz
	});
});

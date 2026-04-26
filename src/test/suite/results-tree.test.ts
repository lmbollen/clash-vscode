import * as assert from 'assert';
import * as vscode from 'vscode';
import { SynthesisResultsTreeProvider } from '../../synthesis-results-tree';
import { ModuleSynthesisResult } from '../../yosys-types';
import { NextpnrResult } from '../../nextpnr-types';

/**
 * Tests for how the sidebar tree renders PNR timing, utilization, and
 * critical-path data — this is what makes those numbers visible without
 * the user opening log files.
 */
suite('Synthesis Results Tree', () => {

	function makeModule(name: string, overrides: Partial<ModuleSynthesisResult> = {}): ModuleSynthesisResult {
		return {
			name,
			success: true,
			elapsedMs: 10,
			errors: [],
			statistics: { rawStats: '', cellCount: 10, wireCount: 20 },
			...overrides,
		};
	}

	test('shows placeholder when no results and no PNR', () => {
		const tree = new SynthesisResultsTreeProvider();
		const roots = tree.getChildren() as vscode.TreeItem[];
		assert.strictEqual(roots.length, 1);
		assert.match(String(roots[0].label), /No synthesis results/);
	});

	test('shows module rows only when PNR is absent', () => {
		const tree = new SynthesisResultsTreeProvider();
		tree.refresh([makeModule('top'), makeModule('sub')]);
		const roots = tree.getChildren() as vscode.TreeItem[];
		assert.strictEqual(roots.length, 2);
		assert.strictEqual(roots[0].label, 'top');
		assert.strictEqual(roots[1].label, 'sub');
	});

	test('appends Timing / Utilization / Critical Paths sections when PNR ran', () => {
		const tree = new SynthesisResultsTreeProvider();
		const pnr: NextpnrResult = {
			success: true,
			output: '',
			warnings: [],
			errors: [],
			timing: {
				maxFrequency: 120.5,
				criticalPathDelay: 8.2,
				constraintsMet: true,
			},
			utilization: {
				luts: { used: 142, total: 24288 },
				registers: { used: 80, total: 24288 },
			},
			criticalPaths: [
				{
					from: 'clkA',
					to: 'clkA',
					totalDelay: 8.2,
					steps: [
						{ delay: 0.5, type: 'clk-to-q', fromCell: 'ff1', toCell: 'ff1' },
						{ delay: 7.7, type: 'routing',  fromCell: 'ff1', toCell: 'ff2', net: 'n1' },
					],
				},
			],
		};
		tree.refresh([makeModule('top')], pnr);

		const roots = tree.getChildren() as vscode.TreeItem[];
		const labels = roots.map(r => String(r.label));
		assert.deepStrictEqual(
			labels,
			['top', 'Timing', 'Utilization', 'Critical Paths'],
			'module + three PNR sections'
		);
	});

	test('Timing section lists Fmax, critical-path delay, constraint status', () => {
		const tree = new SynthesisResultsTreeProvider();
		const pnr: NextpnrResult = {
			success: true,
			output: '',
			warnings: [],
			errors: [],
			timing: {
				maxFrequency: 250.0,
				criticalPathDelay: 4.0,
				setupSlack: 1.2,
				constraintsMet: false,
			},
		};
		tree.refresh([], pnr);

		const roots = tree.getChildren() as vscode.TreeItem[];
		const timingSection = roots.find(r => r.label === 'Timing');
		assert.ok(timingSection, 'Timing section present');

		const rows = tree.getChildren(timingSection) as vscode.TreeItem[];
		const rowMap = new Map(rows.map(r => [String(r.label), String(r.description ?? '')]));
		assert.ok(rowMap.get('Max Frequency')?.includes('250.00 MHz'));
		assert.ok(rowMap.get('Critical Path Delay')?.includes('4.00 ns'));
		assert.ok(rowMap.get('Setup Slack')?.includes('1.200 ns'));
		assert.strictEqual(rowMap.get('Constraints'), 'MISSED');
	});

	test('Utilization section skips buckets without data', () => {
		const tree = new SynthesisResultsTreeProvider();
		const pnr: NextpnrResult = {
			success: true,
			output: '',
			warnings: [],
			errors: [],
			utilization: {
				luts: { used: 5, total: 100 },
				// no registers / bram / dsp / io
			},
		};
		tree.refresh([], pnr);

		const utilSection = (tree.getChildren() as vscode.TreeItem[])
			.find(r => r.label === 'Utilization');
		assert.ok(utilSection);
		const rows = tree.getChildren(utilSection) as vscode.TreeItem[];
		assert.strictEqual(rows.length, 1, 'only the LUT row');
		assert.ok(String(rows[0].description).includes('5 / 100'));
	});

	test('Critical path is expandable into step rows', () => {
		const tree = new SynthesisResultsTreeProvider();
		const pnr: NextpnrResult = {
			success: true,
			output: '',
			warnings: [],
			errors: [],
			criticalPaths: [
				{
					from: 'clkA',
					to: 'clkA',
					totalDelay: 5.5,
					steps: [
						{ delay: 0.5, type: 'clk-to-q' },
						{ delay: 5.0, type: 'routing', fromCell: 'a', toCell: 'b', net: 'wireX' },
					],
				},
			],
		};
		tree.refresh([], pnr);

		const cpSection = (tree.getChildren() as vscode.TreeItem[])
			.find(r => r.label === 'Critical Paths');
		assert.ok(cpSection);

		const pathRows = tree.getChildren(cpSection) as vscode.TreeItem[];
		assert.strictEqual(pathRows.length, 1);
		assert.ok(String(pathRows[0].description).includes('5.50 ns'));

		const stepRows = tree.getChildren(pathRows[0]) as vscode.TreeItem[];
		assert.strictEqual(stepRows.length, 2);
		assert.match(String(stepRows[0].label), /clk-to-q/);
		assert.match(String(stepRows[1].label), /routing/);
	});

	test('re-running synthesis clears any stale PNR sections', () => {
		const tree = new SynthesisResultsTreeProvider();
		tree.refresh([makeModule('top')], {
			success: true, output: '', warnings: [], errors: [],
			timing: { maxFrequency: 100, constraintsMet: true },
		});
		// First pass: PNR section is there.
		assert.ok((tree.getChildren() as vscode.TreeItem[])
			.some(r => r.label === 'Timing'));

		// User re-runs synthesis → refresh without PNR result.
		tree.refresh([makeModule('top')]);
		const roots = tree.getChildren() as vscode.TreeItem[];
		assert.strictEqual(
			roots.some(r => r.label === 'Timing'),
			false,
			'PNR section should be cleared'
		);
	});
});

import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import { ClashManifestParser } from '../../clash-manifest-parser';

/**
 * Tests for expanding a single manifest with multiple internal components
 * into a proper dependency graph for parallel synthesis.
 */
suite('Internal Component Expansion', () => {
	let parser: ClashManifestParser;
	let tmpDir: string;

	suiteSetup(async () => {
		parser = new ClashManifestParser();
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-expand-test-'));
	});

	suiteTeardown(async () => {
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true });
		}
	});

	/**
	 * Helper: create a fake manifest directory with a clash-manifest.json
	 * and Verilog files.
	 */
	async function createManifest(
		dir: string,
		components: string[],
		verilogFiles: { name: string; content: string }[],
		deps: string[] = []
	): Promise<string> {
		await fs.mkdir(dir, { recursive: true });
		const manifest = {
			components,
			dependencies: { transitive: deps },
			domains: {},
			files: verilogFiles.map(f => ({ name: f.name, sha256: 'fake' })),
			flags: [],
			hash: 'fake',
			top_component: {
				name: components[components.length - 1],
				ports_flat: []
			},
			version: '1.9.0'
		};
		const manifestPath = path.join(dir, 'clash-manifest.json');
		await fs.writeFile(manifestPath, JSON.stringify(manifest));
		for (const f of verilogFiles) {
			await fs.writeFile(path.join(dir, f.name), f.content);
		}
		return manifestPath;
	}

	test('single component with 1 module returns 1 component', async () => {
		const dir = path.join(tmpDir, 'single');
		const manifestPath = await createManifest(dir, ['top'], [
			{ name: 'top.v', content: 'module top(); endmodule' }
		]);

		const components = await parser.buildDependencyGraph(manifestPath);
		assert.strictEqual(components.length, 1);
		assert.strictEqual(components[0].name, 'top');
	});

	test('expands manifest with multiple internal components', async () => {
		const dir = path.join(tmpDir, 'multi');
		const manifestPath = await createManifest(dir,
			['sub_a', 'sub_b', 'top_module'],
			[
				{ name: 'sub_a.v', content: 'module sub_a(); endmodule' },
				{ name: 'sub_b.v', content: 'module sub_b(); endmodule' },
				{
					name: 'top_module.v',
					content: [
						'module top_module();',
						'  sub_a sub_a_inst (.clk(clk));',
						'  sub_b sub_b_inst (.clk(clk));',
						'endmodule'
					].join('\n')
				}
			]
		);

		const components = await parser.buildDependencyGraph(manifestPath);
		assert.strictEqual(components.length, 3, 'Should have 3 components');

		const names = components.map(c => c.name);
		assert.ok(names.includes('sub_a'));
		assert.ok(names.includes('sub_b'));
		assert.ok(names.includes('top_module'));

		// Leaves should come first
		const topIdx = names.indexOf('top_module');
		const subAIdx = names.indexOf('sub_a');
		const subBIdx = names.indexOf('sub_b');
		assert.ok(subAIdx < topIdx, 'sub_a should come before top_module');
		assert.ok(subBIdx < topIdx, 'sub_b should come before top_module');

		// top_module should depend on sub_a and sub_b
		const top = components[topIdx];
		assert.ok(top.dependencies.includes('sub_a'));
		assert.ok(top.dependencies.includes('sub_b'));

		// Leaves should have no deps
		assert.deepStrictEqual(components[subAIdx].dependencies, []);
		assert.deepStrictEqual(components[subBIdx].dependencies, []);
	});

	test('detects chain dependency: top -> mid -> leaf', async () => {
		const dir = path.join(tmpDir, 'chain');
		const manifestPath = await createManifest(dir,
			['leaf', 'mid', 'top'],
			[
				{ name: 'leaf.v', content: 'module leaf(); endmodule' },
				{
					name: 'mid.v',
					content: 'module mid();\n  leaf leaf_inst();\nendmodule'
				},
				{
					name: 'top.v',
					content: 'module top();\n  mid mid_inst();\nendmodule'
				}
			]
		);

		const components = await parser.buildDependencyGraph(manifestPath);
		assert.strictEqual(components.length, 3);

		const names = components.map(c => c.name);
		assert.ok(names.indexOf('leaf') < names.indexOf('mid'));
		assert.ok(names.indexOf('mid') < names.indexOf('top'));

		const mid = components.find(c => c.name === 'mid')!;
		assert.deepStrictEqual(mid.dependencies, ['leaf']);

		const top = components.find(c => c.name === 'top')!;
		assert.deepStrictEqual(top.dependencies, ['mid']);
	});

	test('attaches extra Verilog files to referencing component', async () => {
		const dir = path.join(tmpDir, 'extra');
		const manifestPath = await createManifest(dir,
			['wrapper', 'top'],
			[
				// External Verilog not in components list
				{ name: 'VexRiscv_ABC123.v', content: 'module VexRiscv_ABC123(); endmodule' },
				{
					name: 'wrapper.v',
					content: 'module wrapper();\n  VexRiscv_ABC123 cpu();\nendmodule'
				},
				{
					name: 'top.v',
					content: 'module top();\n  wrapper wrapper_inst();\nendmodule'
				}
			]
		);

		const components = await parser.buildDependencyGraph(manifestPath);
		assert.strictEqual(components.length, 2);

		const wrapper = components.find(c => c.name === 'wrapper')!;
		assert.ok(wrapper, 'Should have wrapper component');
		// wrapper should include the external VexRiscv file
		const vFiles = wrapper.verilogFiles.map(f => path.basename(f));
		assert.ok(vFiles.includes('VexRiscv_ABC123.v'),
			'wrapper should include external VexRiscv Verilog');
		assert.ok(vFiles.includes('wrapper.v'),
			'wrapper should include its own Verilog');
	});

	test('each component has correct verilogFiles path', async () => {
		const dir = path.join(tmpDir, 'paths');
		const manifestPath = await createManifest(dir,
			['a', 'b'],
			[
				{ name: 'a.v', content: 'module a(); endmodule' },
				{ name: 'b.v', content: 'module b();\n  a a_inst();\nendmodule' }
			]
		);

		const components = await parser.buildDependencyGraph(manifestPath);
		for (const c of components) {
			for (const vFile of c.verilogFiles) {
				assert.ok(path.isAbsolute(vFile), `${vFile} should be absolute`);
				assert.ok(vFile.endsWith('.v'), `${vFile} should end with .v`);
			}
		}
	});

	test('no false dependency from substring match (wbStorage vs wbStorage_0)', async () => {
		const dir = path.join(tmpDir, 'substring');
		const manifestPath = await createManifest(dir,
			['Mod_wbStorage', 'Mod_wbStorage_0', 'top'],
			[
				{ name: 'Mod_wbStorage.v', content: 'module Mod_wbStorage(); endmodule' },
				{ name: 'Mod_wbStorage_0.v', content: 'module Mod_wbStorage_0(); endmodule' },
				{
					name: 'top.v',
					content: [
						'module top();',
						'  Mod_wbStorage ws (.clk(clk));',
						'  Mod_wbStorage_0 ws0 (.clk(clk));',
						'endmodule'
					].join('\n')
				}
			]
		);

		const components = await parser.buildDependencyGraph(manifestPath);
		assert.strictEqual(components.length, 3);

		// wbStorage_0 should NOT depend on wbStorage
		const ws0 = components.find(c => c.name === 'Mod_wbStorage_0')!;
		assert.ok(ws0, 'Should have Mod_wbStorage_0');
		assert.deepStrictEqual(ws0.dependencies, [],
			'wbStorage_0 must not falsely depend on wbStorage');

		const ws = components.find(c => c.name === 'Mod_wbStorage')!;
		assert.deepStrictEqual(ws.dependencies, [],
			'wbStorage must not have deps');

		// Both wbStorage and wbStorage_0 should be leaves (wave 1)
		const names = components.map(c => c.name);
		const topIdx = names.indexOf('top');
		assert.ok(names.indexOf('Mod_wbStorage') < topIdx);
		assert.ok(names.indexOf('Mod_wbStorage_0') < topIdx);
	});

	test('extra file matched by module name, not filename', async () => {
		// Simulates SpinalHDL: filename is "prefix_Riscv_HASH.v" but
		// the module inside is just "Riscv"
		const dir = path.join(tmpDir, 'modname');
		const manifestPath = await createManifest(dir,
			['vexRiscv', 'top'],
			[
				{
					name: 'prefix_Riscv_ABC123.v',
					content: 'module Riscv();\nendmodule\nmodule RiscvDebug();\nendmodule'
				},
				{
					name: 'vexRiscv.v',
					content: 'module vexRiscv();\n  Riscv riscv_inst();\nendmodule'
				},
				{
					name: 'top.v',
					content: 'module top();\n  vexRiscv vex_inst();\nendmodule'
				}
			]
		);

		const components = await parser.buildDependencyGraph(manifestPath);
		const vex = components.find(c => c.name === 'vexRiscv')!;
		assert.ok(vex, 'Should have vexRiscv component');
		const vFiles = vex.verilogFiles.map(f => path.basename(f));
		assert.ok(vFiles.includes('prefix_Riscv_ABC123.v'),
			'vexRiscv should include extra file matched by module name');
		assert.ok(vFiles.includes('vexRiscv.v'),
			'vexRiscv should include its own file');
	});

	test('deduplicates extra Verilog files listed multiple times', async () => {
		const dir = path.join(tmpDir, 'dedup');
		// Manifest lists the same extra file 3 times (real-world scenario)
		await fs.mkdir(dir, { recursive: true });
		const manifest = {
			components: ['wrapper', 'top'],
			dependencies: { transitive: [] as string[] },
			domains: {},
			files: [
				{ name: 'ExtraCore.v', sha256: 'a' },
				{ name: 'ExtraCore.v', sha256: 'a' },
				{ name: 'ExtraCore.v', sha256: 'a' },
				{ name: 'wrapper.v', sha256: 'b' },
				{ name: 'top.v', sha256: 'c' }
			],
			flags: [],
			hash: 'fake',
			top_component: { name: 'top', ports_flat: [] as unknown[] },
			version: '1.9.0'
		};
		const manifestPath = path.join(dir, 'clash-manifest.json');
		await fs.writeFile(manifestPath, JSON.stringify(manifest));
		await fs.writeFile(path.join(dir, 'ExtraCore.v'), 'module ExtraCore(); endmodule');
		await fs.writeFile(path.join(dir, 'wrapper.v'), 'module wrapper();\n  ExtraCore core();\nendmodule');
		await fs.writeFile(path.join(dir, 'top.v'), 'module top();\n  wrapper w();\nendmodule');

		const components = await parser.buildDependencyGraph(manifestPath);
		const wrapper = components.find(c => c.name === 'wrapper')!;
		// Should have ExtraCore.v exactly once, not 3 times
		const extraCount = wrapper.verilogFiles.filter(f =>
			path.basename(f) === 'ExtraCore.v'
		).length;
		assert.strictEqual(extraCount, 1, 'Extra file should appear exactly once');
	});
});

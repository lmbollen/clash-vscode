import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';

import {
	PipelineCache,
	compilationCacheKey,
	synthesisCacheKey,
} from '../../pipeline-cache';
import { YosysRunner } from '../../yosys-runner';
import {
	HaskellFunctionsTreeProvider,
	FunctionNode,
} from '../../haskell-functions-tree';
import {
	SynthesisResultsTreeProvider,
	ModuleTreeItem,
} from '../../synthesis-results-tree';
import { unwrapFuncArg } from '../../extension';
import { FunctionInfo } from '../../types';
import { ModuleSynthesisResult } from '../../yosys-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFunc(filePath: string, name: string): FunctionInfo {
	return {
		name,
		filePath,
		typeSignature: 'Signal System1 Bool',
		isMonomorphic: true,
		range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
	} as unknown as FunctionInfo;
}

function makeModuleResult(
	name: string,
	opts: Partial<ModuleSynthesisResult> = {}
): ModuleSynthesisResult {
	return {
		name,
		success: true,
		elapsedMs: 10,
		errors: [],
		...opts,
	};
}

// ── PipelineCache key helpers ─────────────────────────────────────────────────

suite('PipelineCache — key helpers', () => {
	test('compilationCacheKey returns filePath:name', () => {
		const key = compilationCacheKey({ filePath: '/a/b.hs', name: 'myTop' });
		assert.strictEqual(key, '/a/b.hs:myTop');
	});

	test('synthesisCacheKey returns filePath:name:mode', () => {
		const key = synthesisCacheKey({ filePath: '/a/b.hs', name: 'myTop' }, 'per-module');
		assert.strictEqual(key, '/a/b.hs:myTop:per-module');
	});

	test('synthesisCacheKey differentiates modes', () => {
		const f = { filePath: '/a/b.hs', name: 'myTop' };
		assert.notStrictEqual(
			synthesisCacheKey(f, 'per-module'),
			synthesisCacheKey(f, 'whole-design'),
		);
	});
});

// ── PipelineCache — set/get/invalidate ───────────────────────────────────────

suite('PipelineCache — operations', () => {
	let cache: PipelineCache;
	let tmpDir: string;

	suiteSetup(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clash-cache-test-'));
	});

	suiteTeardown(async () => {
		if (tmpDir) { await fs.rm(tmpDir, { recursive: true, force: true }); }
	});

	setup(() => {
		cache = new PipelineCache();
	});

	test('initially empty', () => {
		assert.strictEqual(cache.compilationSize, 0);
		assert.strictEqual(cache.synthesisSize, 0);
	});

	test('getCompilation returns undefined for unknown function', async () => {
		const result = await cache.getCompilation(makeFunc('/a.hs', 'foo'));
		assert.strictEqual(result, undefined);
	});

	test('getSynthesis returns undefined for unknown function', async () => {
		const result = await cache.getSynthesis(makeFunc('/a.hs', 'foo'), 'per-module');
		assert.strictEqual(result, undefined);
	});

	test('setCompilation / getCompilation round-trips when file exists', async () => {
		const vFile = path.join(tmpDir, 'test.v');
		await fs.writeFile(vFile, '// verilog');

		const func = makeFunc('/a.hs', 'foo');
		cache.setCompilation(func, { verilogInput: vFile });
		assert.strictEqual(cache.compilationSize, 1);

		const got = await cache.getCompilation(func);
		assert.ok(got);
		assert.strictEqual(got.verilogInput, vFile);
	});

	test('getCompilation evicts entry when file deleted', async () => {
		const vFile = path.join(tmpDir, 'gone.v');
		await fs.writeFile(vFile, '// verilog');

		const func = makeFunc('/a.hs', 'bar');
		cache.setCompilation(func, { verilogInput: vFile });

		await fs.unlink(vFile);

		const got = await cache.getCompilation(func);
		assert.strictEqual(got, undefined);
		assert.strictEqual(cache.compilationSize, 0, 'evicted entry should be removed');
	});

	test('getCompilation evicts when first element of array is missing', async () => {
		const func = makeFunc('/a.hs', 'baz');
		cache.setCompilation(func, { verilogInput: ['/nonexistent/path.v', '/other.v'] });

		const got = await cache.getCompilation(func);
		assert.strictEqual(got, undefined);
		assert.strictEqual(cache.compilationSize, 0);
	});

	test('setSynthesis / getSynthesis round-trips when json file exists', async () => {
		const jsonFile = path.join(tmpDir, 'synth.json');
		await fs.writeFile(jsonFile, '{}');

		const func = makeFunc('/a.hs', 'top');
		cache.setSynthesis(func, 'per-module', { synthResult: { jsonPath: jsonFile } });
		assert.strictEqual(cache.synthesisSize, 1);

		const got = await cache.getSynthesis(func, 'per-module');
		assert.ok(got);
		assert.strictEqual(got.synthResult.jsonPath, jsonFile);
	});

	test('getSynthesis evicts when json file deleted', async () => {
		const jsonFile = path.join(tmpDir, 'gone.json');
		await fs.writeFile(jsonFile, '{}');

		const func = makeFunc('/a.hs', 'qux');
		cache.setSynthesis(func, 'per-module', { synthResult: { jsonPath: jsonFile } });

		await fs.unlink(jsonFile);

		const got = await cache.getSynthesis(func, 'per-module');
		assert.strictEqual(got, undefined);
		assert.strictEqual(cache.synthesisSize, 0);
	});

	test('getSynthesis evicts when jsonPath is undefined', async () => {
		const func = makeFunc('/a.hs', 'nojson');
		cache.setSynthesis(func, 'per-module', { synthResult: {} });

		const got = await cache.getSynthesis(func, 'per-module');
		assert.strictEqual(got, undefined);
		assert.strictEqual(cache.synthesisSize, 0);
	});

	test('invalidateFile removes all entries for that file', async () => {
		const vFile = path.join(tmpDir, 'keep.v');
		const jsonFile = path.join(tmpDir, 'keep.json');
		await fs.writeFile(vFile, '');
		await fs.writeFile(jsonFile, '{}');

		const target = makeFunc('/target.hs', 'fn');
		const other  = makeFunc('/other.hs',  'fn');

		cache.setCompilation(target, { verilogInput: vFile });
		cache.setCompilation(other,  { verilogInput: vFile });
		cache.setSynthesis(target, 'per-module', { synthResult: { jsonPath: jsonFile } });

		cache.invalidateFile('/target.hs');

		assert.strictEqual(cache.compilationSize, 1, 'other file entry should survive');
		assert.strictEqual(cache.synthesisSize,   0, 'target synthesis entry should be gone');
		assert.ok(await cache.getCompilation(other),  'other compile cache should be intact');
		assert.strictEqual(await cache.getCompilation(target), undefined, 'target should be evicted');
	});

	test('per-mode cache entries are independent', async () => {
		const jsonA = path.join(tmpDir, 'a.json');
		const jsonB = path.join(tmpDir, 'b.json');
		await fs.writeFile(jsonA, '{}');
		await fs.writeFile(jsonB, '{}');

		const func = makeFunc('/a.hs', 'dual');
		cache.setSynthesis(func, 'per-module',   { synthResult: { jsonPath: jsonA } });
		cache.setSynthesis(func, 'whole-design', { synthResult: { jsonPath: jsonB } });

		assert.strictEqual(cache.synthesisSize, 2);

		const gotA = await cache.getSynthesis(func, 'per-module');
		const gotB = await cache.getSynthesis(func, 'whole-design');
		assert.strictEqual(gotA!.synthResult.jsonPath, jsonA);
		assert.strictEqual(gotB!.synthResult.jsonPath, jsonB);
	});
});

// ── unwrapFuncArg ─────────────────────────────────────────────────────────────

suite('unwrapFuncArg', () => {
	const sampleFunc = makeFunc('/a.hs', 'myFunc');

	test('returns FunctionInfo unchanged when passed a real FunctionInfo', () => {
		const result = unwrapFuncArg(sampleFunc);
		assert.strictEqual(result, sampleFunc);
	});

	test('unwraps FunctionNode to its .info', () => {
		const node = new FunctionNode(sampleFunc, false);
		const result = unwrapFuncArg(node);
		assert.strictEqual(result, sampleFunc);
	});

	test('returns undefined for undefined', () => {
		assert.strictEqual(unwrapFuncArg(undefined), undefined);
	});

	test('returns undefined for a plain object without range', () => {
		assert.strictEqual(unwrapFuncArg({ name: 'foo' }), undefined);
	});

	test('returns undefined for a string', () => {
		assert.strictEqual(unwrapFuncArg('myFunc'), undefined);
	});

	test('returns undefined for a vscode.TreeItem that is not FunctionNode', () => {
		const item = new vscode.TreeItem('section');
		assert.strictEqual(unwrapFuncArg(item), undefined);
	});
});

// ── HaskellFunctionsTreeProvider ──────────────────────────────────────────────

suite('HaskellFunctionsTreeProvider', () => {
	let provider: HaskellFunctionsTreeProvider;
	const monoFunc = makeFunc('/a.hs', 'monoFn');
	const polyFunc = { ...makeFunc('/a.hs', 'polyFn'), isMonomorphic: false } as unknown as FunctionInfo;

	setup(() => {
		provider = new HaskellFunctionsTreeProvider();
	});

	test('shows placeholder when no file is active', () => {
		const children = provider.getChildren();
		assert.strictEqual(children.length, 1);
		const item = provider.getTreeItem(children[0]);
		assert.ok((item.label as string).includes('Open a Haskell file'));
	});

	test('shows loading spinner during analysis', () => {
		provider.setLoading('/a.hs');
		const children = provider.getChildren();
		assert.strictEqual(children.length, 1);
		const item = provider.getTreeItem(children[0]);
		assert.ok((item.label as string).includes('Analyzing'));
	});

	test('shows two section nodes after refresh', () => {
		provider.refresh([monoFunc, polyFunc], '/a.hs');
		const children = provider.getChildren();
		assert.strictEqual(children.length, 2);
	});

	test('monomorphic section has count in label', () => {
		provider.refresh([monoFunc, polyFunc], '/a.hs');
		const children = provider.getChildren();
		const monoSection = provider.getTreeItem(children[0]);
		assert.ok((monoSection.label as string).includes('(1)'));
	});

	test('polymorphic section has count in label', () => {
		provider.refresh([monoFunc, polyFunc], '/a.hs');
		const children = provider.getChildren();
		const polySection = provider.getTreeItem(children[1]);
		assert.ok((polySection.label as string).includes('(1)'));
	});

	test('mono section children are FunctionNodes with isPolymorphic=false', () => {
		provider.refresh([monoFunc], '/a.hs');
		const sections = provider.getChildren();
		const monoChildren = provider.getChildren(sections[0]);
		assert.strictEqual(monoChildren.length, 1);
		const node = monoChildren[0] as FunctionNode;
		assert.ok(node instanceof FunctionNode);
		assert.strictEqual(node.isPolymorphic, false);
		assert.strictEqual(node.info.name, 'monoFn');
	});

	test('poly section children are FunctionNodes with isPolymorphic=true', () => {
		provider.refresh([polyFunc], '/a.hs');
		const sections = provider.getChildren();
		const polyChildren = provider.getChildren(sections[1]);
		assert.strictEqual(polyChildren.length, 1);
		const node = polyChildren[0] as FunctionNode;
		assert.ok(node instanceof FunctionNode);
		assert.strictEqual(node.isPolymorphic, true);
	});

	test('clear resets to placeholder state', () => {
		provider.refresh([monoFunc], '/a.hs');
		provider.clear();
		const children = provider.getChildren();
		assert.strictEqual(children.length, 1);
		const item = provider.getTreeItem(children[0]);
		assert.ok((item.label as string).includes('Open a Haskell file'));
	});

	test('functions are sorted alphabetically within sections', () => {
		const zFunc = makeFunc('/a.hs', 'zFn');
		const aFunc = makeFunc('/a.hs', 'aFn');
		provider.refresh([zFunc, aFunc], '/a.hs');
		const sections = provider.getChildren();
		const monoChildren = provider.getChildren(sections[0]);
		assert.strictEqual((monoChildren[0] as FunctionNode).info.name, 'aFn');
		assert.strictEqual((monoChildren[1] as FunctionNode).info.name, 'zFn');
	});
});

// ── FunctionNode ──────────────────────────────────────────────────────────────

suite('FunctionNode', () => {
	const func = makeFunc('/a.hs', 'myFn');

	test('stores FunctionInfo on .info', () => {
		const node = new FunctionNode(func, false);
		assert.strictEqual(node.info, func);
	});

	test('contextValue is monoFunction for monomorphic', () => {
		const node = new FunctionNode(func, false);
		assert.strictEqual(node.contextValue, 'monoFunction');
	});

	test('contextValue is polyFunction for polymorphic', () => {
		const node = new FunctionNode(func, true);
		assert.strictEqual(node.contextValue, 'polyFunction');
	});

	test('has goToFunction command', () => {
		const node = new FunctionNode(func, false);
		assert.ok(node.command);
		assert.strictEqual(node.command!.command, 'clash-vscode-yosys.goToFunction');
		assert.deepStrictEqual(node.command!.arguments, [func]);
	});

	test('description shows type signature', () => {
		const node = new FunctionNode(func, false);
		assert.ok((node.description as string).includes('Signal System1 Bool'));
	});
});

// ── SynthesisResultsTreeProvider ─────────────────────────────────────────────

suite('SynthesisResultsTreeProvider', () => {
	let provider: SynthesisResultsTreeProvider;

	setup(() => {
		provider = new SynthesisResultsTreeProvider();
	});

	test('shows placeholder when no results', () => {
		const children = provider.getChildren();
		assert.strictEqual(children.length, 1);
		const item = provider.getTreeItem(children[0]) as ModuleTreeItem;
		assert.ok((item.label as string).includes('No synthesis results'));
	});

	test('shows one ModuleTreeItem per result after refresh', () => {
		provider.refresh([makeModuleResult('top'), makeModuleResult('sub')]);
		const children = provider.getChildren();
		assert.strictEqual(children.length, 2);
	});

	test('ModuleTreeItem with no cell types is not collapsible', () => {
		provider.refresh([makeModuleResult('top')]);
		const [item] = provider.getChildren() as ModuleTreeItem[];
		assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
	});

	test('ModuleTreeItem with FPGA cells is collapsible', () => {
		const cellTypes = new Map([['LUT4', 5], ['TRELLIS_FF', 2]]);
		const result = makeModuleResult('top', { statistics: { rawStats: '', cellTypes } });
		provider.refresh([result]);
		const [item] = provider.getChildren() as ModuleTreeItem[];
		assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
	});

	test('fpgaCells includes all cell types from statistics', () => {
		const cellTypes = new Map([['$dffe', 10], ['LUT4', 5], ['TRELLIS_FF', 2]]);
		const result = makeModuleResult('top', { statistics: { rawStats: '', cellTypes } });
		provider.refresh([result]);
		const [item] = provider.getChildren() as ModuleTreeItem[];
		const names = item.fpgaCells.map(([n]) => n);
		assert.ok(names.includes('$dffe'), 'should include $-prefixed cells');
		assert.ok(names.includes('LUT4'));
		assert.ok(names.includes('TRELLIS_FF'));
	});

	test('fpgaCells are sorted by count descending', () => {
		const cellTypes = new Map([['LUT4', 3], ['TRELLIS_FF', 10], ['DP16KD', 1]]);
		const result = makeModuleResult('top', { statistics: { rawStats: '', cellTypes } });
		provider.refresh([result]);
		const [item] = provider.getChildren() as ModuleTreeItem[];
		const counts = item.fpgaCells.map(([, c]) => c);
		assert.deepStrictEqual(counts, [10, 3, 1]);
	});

	test('contextValue includes -diagram tag when diagramJsonPath set', () => {
		const result = makeModuleResult('top', { diagramJsonPath: '/tmp/d.json' });
		provider.refresh([result]);
		const [item] = provider.getChildren() as ModuleTreeItem[];
		assert.ok(item.contextValue!.includes('diagram'), 'should contain diagram tag');
	});

	test('contextValue is synthesisModule when no diagramJsonPath', () => {
		provider.refresh([makeModuleResult('top')]);
		const [item] = provider.getChildren() as ModuleTreeItem[];
		assert.strictEqual(item.contextValue, 'synthesisModule');
	});

	test('children of ModuleTreeItem are utilization entries', () => {
		const cellTypes = new Map([['LUT4', 7]]);
		const result = makeModuleResult('top', { statistics: { rawStats: '', cellTypes } });
		provider.refresh([result]);
		const [item] = provider.getChildren() as ModuleTreeItem[];
		const children = provider.getChildren(item);
		assert.strictEqual(children.length, 1);
		const child = provider.getTreeItem(children[0]);
		assert.strictEqual(child.label, 'LUT4');
		assert.strictEqual(child.description, '7');
	});

	test('failed module shows error contextValue', () => {
		const result = makeModuleResult('top', {
			success: false,
			errors: [{ message: 'timeout' }],
		});
		provider.refresh([result]);
		const [item] = provider.getChildren() as ModuleTreeItem[];
		assert.strictEqual(item.contextValue, 'synthesisModule');
	});
});

// ── YosysRunner.parseStatisticsOutput ────────────────────────────────────────

suite('YosysRunner.parseStatisticsOutput', () => {
	const sampleOutput = [
		'=== myTop ===',
		'',
		'   Number of wires:                 42',
		'   Number of cells:                 18',
		'',
		'     $dffe                           5',
		'     LUT4                            8',
		'     TRELLIS_FF                      5',
		'',
	].join('\n');

	test('parses cellCount', () => {
		const stats = YosysRunner.parseStatisticsOutput(sampleOutput);
		assert.strictEqual(stats.cellCount, 18);
	});

	test('parses wireCount', () => {
		const stats = YosysRunner.parseStatisticsOutput(sampleOutput);
		assert.strictEqual(stats.wireCount, 42);
	});

	test('parses $-prefixed internal cell types', () => {
		const stats = YosysRunner.parseStatisticsOutput(sampleOutput);
		assert.ok(stats.cellTypes);
		assert.strictEqual(stats.cellTypes!.get('$dffe'), 5);
	});

	test('parses plain FPGA primitive cell types', () => {
		const stats = YosysRunner.parseStatisticsOutput(sampleOutput);
		assert.ok(stats.cellTypes);
		assert.strictEqual(stats.cellTypes!.get('LUT4'), 8);
		assert.strictEqual(stats.cellTypes!.get('TRELLIS_FF'), 5);
	});

	test('returns empty stats for empty string', () => {
		const stats = YosysRunner.parseStatisticsOutput('');
		assert.strictEqual(stats.cellCount, undefined);
		assert.strictEqual(stats.wireCount, undefined);
		assert.strictEqual(stats.cellTypes, undefined);
	});

	test('parses chip area when present', () => {
		const out = 'Chip area for module top: 123.45\n';
		const stats = YosysRunner.parseStatisticsOutput(out);
		assert.ok(Math.abs((stats.chipArea ?? 0) - 123.45) < 0.001);
	});

	test('does not capture statistics-section header line as a cell type', () => {
		const out = [
			'=== top ===',
			'   Number of cells:  2',
			'     LUT4            2',
		].join('\n');
		const stats = YosysRunner.parseStatisticsOutput(out);
		assert.ok(stats.cellTypes);
		// "top" from the header should NOT appear as a cell
		assert.strictEqual(stats.cellTypes!.get('top'), undefined);
	});
});

// ── New command registrations ─────────────────────────────────────────────────

suite('New command registrations', () => {
	test('viewModuleDiagram command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.viewModuleDiagram'),
			'viewModuleDiagram command should be registered',
		);
	});

	test('refreshHaskellFunctions command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.refreshHaskellFunctions'),
			'refreshHaskellFunctions command should be registered',
		);
	});

	test('goToFunction command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.goToFunction'),
			'goToFunction command should be registered',
		);
	});

	test('openResultsPanel command is registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes('clash-vscode-yosys.openResultsPanel'),
			'openResultsPanel command should be registered',
		);
	});
});

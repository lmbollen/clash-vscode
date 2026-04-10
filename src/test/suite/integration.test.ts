import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { CodeGenerator, GenerationConfig } from '../../code-generator';
import { ClashCompiler } from '../../clash-compiler';
import { YosysRunner } from '../../yosys-runner';
import { NextpnrRunner } from '../../nextpnr-runner';
import { FunctionInfo } from '../../types';


/**
 * End-to-end integration tests that run the full synthesis and PnR flow
 * on the test-project workspace.
 *
 * These tests require that cabal, clash-ghc, yosys, nextpnr-ecp5, and
 * ecppack are all available in the environment.
 */
suite('Integration: Full Synthesis + PnR Flow', () => {
	let outputChannel: vscode.OutputChannel;
	let codeGenerator: CodeGenerator;
	let clashCompiler: ClashCompiler;
	let yosysRunner: YosysRunner;
	let nextpnrRunner: NextpnrRunner;
	let wsRoot: string;

	// Shared state across the ordered test steps
	let generatedModuleName: string;
	let synthProjectRoot: string;
	let cabalProjectDir: string | null;
	let verilogPath: string;
	let allVerilogFiles: string[] | undefined;
	let topModule: string;
	let yosysJsonPath: string;

	/** The function we synthesize through the whole flow. */
	const testFunc: FunctionInfo = {
		name: 'plusSigned',
		range: new vscode.Range(0, 0, 0, 0),
		typeSignature: 'Signed 8 -> Signed 8 -> Signed 8',
		isMonomorphic: true,
		filePath: '', // set in suiteSetup
		moduleName: 'Example.Project',
	};

	suiteSetup(async function () {
		this.timeout(30000);

		outputChannel = vscode.window.createOutputChannel('Test Integration');
		codeGenerator = new CodeGenerator(outputChannel);
		clashCompiler = new ClashCompiler(outputChannel);
		yosysRunner = new YosysRunner(outputChannel);
		nextpnrRunner = new NextpnrRunner(outputChannel);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error('No workspace folder — cannot run integration tests');
		}
		wsRoot = workspaceFolders[0].uri.fsPath;
		testFunc.filePath = path.join(wsRoot, 'src', 'Example', 'Project.hs');

		// Clean any stale synth project left by previous test suites so
		// leftover wrapper files don't cause compilation errors.
		const synthRoot = CodeGenerator.getSynthProjectRoot(wsRoot);
		await fs.rm(synthRoot, { recursive: true, force: true });
	});

	suiteTeardown(() => {
		if (outputChannel) {
			outputChannel.dispose();
		}
	});

	// ---------------------------------------------------------------
	// Step 1: Generate wrapper module
	// ---------------------------------------------------------------

	test('Step 1: Generate wrapper module', async function () {
		this.timeout(15000);

		const projectDirs = CodeGenerator.getProjectDirectories(wsRoot, testFunc);
		const genConfig: GenerationConfig = {
			outputDir: projectDirs.haskell,
			keepFiles: true,
			modulePrefix: 'ClashSynth_',
		};

		const result = await codeGenerator.generateWrapper(testFunc, genConfig, wsRoot);

		assert.ok(result.filePath, 'Should produce a wrapper file');
		assert.ok(result.moduleName, 'Should produce a module name');
		assert.ok(result.content.includes('topEntity'), 'Wrapper should contain topEntity');
		assert.ok(result.content.includes('import qualified Example.Project'), 'Wrapper should import user module');
		assert.ok(result.content.includes('Synthesize'), 'Wrapper should have Synthesize annotation');

		generatedModuleName = result.moduleName;

		// Verify the file was written
		const stat = await fs.stat(result.filePath);
		assert.ok(stat.isFile(), 'Wrapper file should exist on disk');
	});

	// ---------------------------------------------------------------
	// Step 2: Set up synthesis cabal project
	// ---------------------------------------------------------------

	test('Step 2: Ensure synthesis cabal project', async function () {
		this.timeout(15000);

		const synthInfo = await codeGenerator.ensureSynthProject(wsRoot, testFunc.filePath);

		synthProjectRoot = synthInfo.synthRoot;
		cabalProjectDir = synthInfo.cabalProjectDir;

		// Verify key files exist
		const cabalProjectFile = path.join(synthProjectRoot, 'cabal.project');
		const cabalFile = path.join(synthProjectRoot, 'clash-synth.cabal');
		const clashMain = path.join(synthProjectRoot, 'bin', 'Clash.hs');

		const [cpStat, cfStat, cmStat] = await Promise.all([
			fs.stat(cabalProjectFile),
			fs.stat(cabalFile),
			fs.stat(clashMain),
		]);

		assert.ok(cpStat.isFile(), 'cabal.project should exist');
		assert.ok(cfStat.isFile(), 'clash-synth.cabal should exist');
		assert.ok(cmStat.isFile(), 'bin/Clash.hs should exist');

		// Should have detected the user project
		assert.ok(cabalProjectDir, 'Should detect cabal project dir');

		// The .cabal file should depend on the user package
		const cabalContent = await fs.readFile(cabalFile, 'utf8');
		assert.ok(cabalContent.includes('simple'), 'Should depend on user package "simple"');
	});

	// ---------------------------------------------------------------
	// Step 3: Compile with Clash (Haskell → Verilog)
	// ---------------------------------------------------------------

	test('Step 3: Compile to Verilog with Clash', async function () {
		// This can take a very long time on a cold cabal build
		this.timeout(600_000);

		const projectDirs = CodeGenerator.getProjectDirectories(wsRoot, testFunc);

		const result = await clashCompiler.compileToVerilog(
			path.join(projectDirs.haskell, `${generatedModuleName}.hs`),
			{
				workspaceRoot: wsRoot,
				outputDir: projectDirs.root,
				moduleName: generatedModuleName,
				hdlDir: projectDirs.verilog,
				synthProjectRoot,
				cabalProjectDir: cabalProjectDir ?? undefined,
			}
		);

		assert.ok(result.success, `Clash compilation should succeed.\nErrors: ${result.errors.join('\n')}`);
		assert.ok(result.verilogPath, 'Should produce a Verilog file');

		verilogPath = result.verilogPath!;
		allVerilogFiles = result.allVerilogFiles;

		// Determine top module from manifest or filename
		if (result.manifest?.top_component?.name) {
			topModule = result.manifest.top_component.name;
		} else {
			topModule = path.basename(verilogPath, '.v');
		}

		// Verify the Verilog file exists and is non-empty
		const stat = await fs.stat(verilogPath);
		assert.ok(stat.size > 0, 'Verilog file should be non-empty');
	});

	// ---------------------------------------------------------------
	// Step 4: Synthesize with Yosys (Verilog → netlist JSON)
	// ---------------------------------------------------------------

	test('Step 4: Synthesize with Yosys', async function () {
		this.timeout(120_000);

		assert.ok(verilogPath, 'Step 3 must have produced a Verilog path');

		const projectDirs = CodeGenerator.getProjectDirectories(wsRoot, testFunc);
		const verilogInput = allVerilogFiles || verilogPath;

		const result = await yosysRunner.synthesize({
			workspaceRoot: wsRoot,
			outputDir: projectDirs.yosys,
			topModule,
			verilogPath: verilogInput,
			targetFamily: 'ecp5',
		});

		assert.ok(result.success, `Yosys synthesis should succeed.\nErrors: ${result.errors.map(e => e.message).join('\n')}`);
		assert.ok(result.jsonPath, 'Should produce a JSON netlist');

		yosysJsonPath = result.jsonPath!;

		// Verify synthesis produced the JSON file
		const stat = await fs.stat(yosysJsonPath);
		assert.ok(stat.size > 0, 'JSON netlist should be non-empty');

		// Statistics should be populated
		if (result.statistics) {
			assert.ok(
				result.statistics.cellCount === undefined || result.statistics.cellCount >= 0,
				'Cell count should be non-negative'
			);
		}
	});

	// ---------------------------------------------------------------
	// Step 5: Place & Route with nextpnr-ecp5
	// ---------------------------------------------------------------

	test('Step 5: Place & Route with nextpnr-ecp5', async function () {
		this.timeout(120_000);

		assert.ok(yosysJsonPath, 'Step 4 must have produced a JSON netlist path');

		const projectDirs = CodeGenerator.getProjectDirectories(wsRoot, testFunc);

		const result = await nextpnrRunner.placeAndRoute({
			family: 'ecp5',
			jsonPath: yosysJsonPath,
			outputDir: projectDirs.nextpnr,
			topModule,
			ecp5: {
				device: '25k',
				package: 'CABGA381',
				speedGrade: '6',
			},
		});

		assert.ok(result.success, `nextpnr should succeed.\nErrors: ${result.errors.map(e => e.message).join('\n')}`);
		assert.ok(result.textcfgPath, 'Should produce a textcfg file');

		// Verify textcfg exists
		const stat = await fs.stat(result.textcfgPath!);
		assert.ok(stat.size > 0, 'Textcfg should be non-empty');

		// Timing info should be present
		if (result.timing) {
			if (result.timing.maxFrequency !== undefined) {
				assert.ok(result.timing.maxFrequency > 0, 'Max frequency should be positive');
			}
		}

		// Utilization info should be present
		if (result.utilization) {
			assert.ok(
				result.utilization.luts === undefined || result.utilization.luts.used >= 0,
				'LUT count should be non-negative'
			);
		}
	});

	// ---------------------------------------------------------------
	// Step 6: Generate bitstream with ecppack
	// ---------------------------------------------------------------

	test('Step 6: Bitstream should exist (ecppack)', async function () {
		this.timeout(60_000);

		assert.ok(yosysJsonPath, 'Step 4 must have produced a JSON netlist path');

		// ecppack is run by nextpnrRunner.placeAndRoute automatically for ecp5.
		// Just verify the bitstream file was created.
		const projectDirs = CodeGenerator.getProjectDirectories(wsRoot, testFunc);
		const bitstreamPath = path.join(projectDirs.nextpnr, `${topModule}.bit`);

		const stat = await fs.stat(bitstreamPath);
		assert.ok(stat.size > 0, 'Bitstream file should be non-empty');
	});
});

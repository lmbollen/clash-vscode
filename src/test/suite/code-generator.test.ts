import * as assert from 'assert';
import * as path from 'path';
import { promises as fsp } from 'fs';
import * as vscode from 'vscode';
import { CodeGenerator, GenerationConfig } from '../../code-generator';
import { FunctionInfo } from '../../types';

/**
 * Tests for Code Generator
 */
suite('Code Generator Test Suite', () => {
	let outputChannel: vscode.OutputChannel;
	let codeGenerator: CodeGenerator;
	let tempDir: string;

	suiteSetup(() => {
		// Create output channel once for entire suite
		outputChannel = vscode.window.createOutputChannel('Test Code Generator');
	});

	suiteTeardown(() => {
		// Dispose only once at end of suite
		if (outputChannel) {
			outputChannel.dispose();
		}
	});

	setup(() => {
		// Create generator for each test (reuses same output channel)
		codeGenerator = new CodeGenerator(outputChannel);
		
		// Use a temp directory in the workspace
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			tempDir = path.join(workspaceFolders[0].uri.fsPath, '.test-synth');
		}
	});

	test('Should generate wrapper module with correct structure', async function() {
		this.timeout(10000);

		const testFunction: FunctionInfo = {
			name: 'plusSigned',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Signed 8 -> Signed 8 -> Signed 8',
			isMonomorphic: true,
			filePath: '/test/Example/Project.hs',
			moduleName: 'Example.Project'
		};

		if (!tempDir) {
			this.skip();
			return;
		}

		const config: GenerationConfig = {
			keepFiles: true,
			modulePrefix: 'ClashSynth_'
		};

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp';
		const result = await codeGenerator.generateWrapper(testFunction, config, wsRoot);

		// Verify result structure
		assert.ok(result.filePath, 'Should have file path');
		assert.ok(result.moduleName, 'Should have module name');
		assert.ok(result.content, 'Should have content');

		// Verify module name follows convention
		assert.strictEqual(result.moduleName, 'ClashSynth_PlusSigned');

		// Verify content has required elements
		assert.ok(result.content.includes('module ClashSynth_PlusSigned'), 'Should have module declaration');
		assert.ok(result.content.includes('import Clash.Prelude'), 'Should import Clash.Prelude');
		assert.ok(result.content.includes('import qualified Example.Project'), 'Should import original module');
		assert.ok(result.content.includes('Synthesize'), 'Should have Synthesize annotation');
		assert.ok(result.content.includes('OPAQUE'), 'Should have OPAQUE pragma');
	});

	test('Should generate correct port names', async function() {
		this.timeout(10000);

		const testFunction: FunctionInfo = {
			name: 'testFunc',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Unsigned 16 -> Unsigned 16 -> Unsigned 32',
			isMonomorphic: true,
			filePath: '/test/Test.hs',
			moduleName: 'Test'
		};

		if (!tempDir) {
			this.skip();
			return;
		}

		const config: GenerationConfig = {
			keepFiles: true,
			modulePrefix: 'Test_'
		};

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp';
		const result = await codeGenerator.generateWrapper(testFunction, config, wsRoot);

		// Should have input ports INA and INB
		assert.ok(result.content.includes('INA'), 'Should have INA port');
		assert.ok(result.content.includes('INB'), 'Should have INB port');
		assert.ok(result.content.includes('OUT'), 'Should have OUT port');
	});

	test('Should handle clock/reset/enable signals', async function() {
		this.timeout(10000);

		const testFunction: FunctionInfo = {
			name: 'topEntity',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Clock Dom50 -> Reset Dom50 -> Enable Dom50 -> Signal Dom50 (Unsigned 8) -> Signal Dom50 (Unsigned 8)',
			isMonomorphic: true,
			filePath: '/test/Example/Project.hs',
			moduleName: 'Example.Project'
		};

		if (!tempDir) {
			this.skip();
			return;
		}

		const config: GenerationConfig = {
			keepFiles: true,
			modulePrefix: 'Test_'
		};

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp';
		const result = await codeGenerator.generateWrapper(testFunction, config, wsRoot);

		// Should recognize clock, reset, enable
		assert.ok(result.content.includes('CLK'), 'Should have CLK port');
		assert.ok(result.content.includes('RST'), 'Should have RST port');
		assert.ok(result.content.includes('EN'), 'Should have EN port');
	});

	test('Should use PortProduct for DiffClock', async function() {
		this.timeout(10000);

		const testFunction: FunctionInfo = {
			name: 'topEntity',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'DiffClock "Basic625" -> Signal "Basic625" (Unsigned 8) -> Signal "Basic625" (Unsigned 8)',
			isMonomorphic: true,
			filePath: '/test/Example/Project.hs',
			moduleName: 'Example.Project'
		};

		if (!tempDir) {
			this.skip();
			return;
		}

		const config: GenerationConfig = {
			keepFiles: true,
			modulePrefix: 'Test_'
		};

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp';
		const result = await codeGenerator.generateWrapper(testFunction, config, wsRoot);

		// DiffClock must use PortProduct, not PortName
		assert.ok(
			result.content.includes('PortProduct "CLK" [PortName "p", PortName "n"]'),
			'DiffClock should produce PortProduct with p/n sub-ports'
		);
		// Should NOT have a bare PortName "CLK" for the DiffClock port
		assert.ok(
			!result.content.includes('PortName "CLK"'),
			'DiffClock should NOT use PortName for the clock port'
		);
	});

	test('formatPortAnnotation: PortName', () => {
		const result = CodeGenerator.formatPortAnnotation({ kind: 'name', name: 'RST' });
		assert.strictEqual(result, 'PortName "RST"');
	});

	test('formatPortAnnotation: PortProduct', () => {
		const result = CodeGenerator.formatPortAnnotation({ kind: 'product', name: 'CLK', subPorts: ['p', 'n'] });
		assert.strictEqual(result, 'PortProduct "CLK" [PortName "p", PortName "n"]');
	});

	test('Should generate snake_case synthesis names', async function() {
		this.timeout(10000);

		const testFunction: FunctionInfo = {
			name: 'myComplexFunction',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Int -> Int',
			isMonomorphic: true,
			filePath: '/test/Test.hs',
			moduleName: 'Test'
		};

		if (!tempDir) {
			this.skip();
			return;
		}

		const config: GenerationConfig = {
			keepFiles: true,
			modulePrefix: 'Test_'
		};

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp';
		const result = await codeGenerator.generateWrapper(testFunction, config, wsRoot);

		// Should convert camelCase to snake_case
		assert.ok(result.content.includes('my_complex_function'), 'Should have snake_case name');
	});
	test('Should use qualified import for original module', async function() {
		this.timeout(10000);

		const testFunction: FunctionInfo = {
			name: 'myFunc',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Int -> Bool',
			isMonomorphic: true,
			filePath: '/test/Foo/Bar.hs',
			moduleName: 'Foo.Bar'
		};

		if (!tempDir) {
			this.skip();
			return;
		}

		const config: GenerationConfig = {
			keepFiles: true,
			modulePrefix: 'ClashSynth_'
		};

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp';
		const result = await codeGenerator.generateWrapper(testFunction, config, wsRoot);

		assert.ok(result.content.includes('import qualified Foo.Bar'), 'Should import the original module');
		assert.ok(result.content.includes('topEntity = Foo.Bar.myFunc'), 'Should reference the qualified function');
	});

	test('Should generate correct project directories', () => {
		const func: FunctionInfo = {
			name: 'myFunc',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Int -> Int',
			isMonomorphic: true,
			filePath: '/test/Test.hs',
			moduleName: 'Example.Module'
		};

		const dirs = CodeGenerator.getProjectDirectories('/workspace', func);
		assert.ok(dirs.root.includes('Example.Module.myFunc'));
		assert.ok(dirs.verilog.includes('02-verilog'));
		assert.ok(dirs.yosys.includes('03-yosys'));
		assert.ok(dirs.nextpnr.includes('04-nextpnr'));
	});

	test('Should detect cabal package name', async function() {
		this.timeout(10000);

		// The test workspace is test-project/ which has simple.cabal
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			this.skip();
			return;
		}

		const name = await CodeGenerator.detectCabalPackageName(
			workspaceFolders[0].uri.fsPath
		);
		assert.strictEqual(name, 'simple', 'Should detect package name "simple" from simple.cabal');
	});

	test('Should return null when no .cabal file exists', async function() {
		this.timeout(5000);

		const name = await CodeGenerator.detectCabalPackageName('/tmp');
		assert.strictEqual(name, null);
	});

	test('Should create synthesis cabal project (with user package)', async function() {
		this.timeout(15000);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			this.skip();
			return;
		}

		const wsRoot = workspaceFolders[0].uri.fsPath;
		// Use a source file that lives inside the test-project cabal package
		const sourceFile = path.join(wsRoot, 'src', 'Example', 'Project.hs');
		const synthInfo = await codeGenerator.ensureSynthProject(wsRoot, sourceFile);

		// Verify the synth project was created
		const cabalProjectContent = await fsp.readFile(
			path.join(synthInfo.synthRoot, 'cabal.project'), 'utf8'
		);
		assert.ok(cabalProjectContent.includes('import:'), 'cabal.project should import user cabal.project');
		assert.ok(cabalProjectContent.includes('optional-packages'), 'Should include synth package via optional-packages');

		// Should report cabalProjectDir since the test workspace has a cabal.project
		assert.ok(synthInfo.cabalProjectDir, 'Should have cabalProjectDir');

		const cabalFileContent = await fsp.readFile(
			path.join(synthInfo.synthRoot, 'clash-synth.cabal'), 'utf8'
		);
		assert.ok(cabalFileContent.includes('simple'), 'Should depend on user package "simple"');
		assert.ok(cabalFileContent.includes('clash-prelude'), 'Should depend on clash-prelude');
		assert.ok(cabalFileContent.includes('clash-ghc'), 'Should have a clash executable');

		const clashMain = await fsp.readFile(
			path.join(synthInfo.synthRoot, 'bin', 'Clash.hs'), 'utf8'
		);
		assert.ok(clashMain.includes('Clash.Main'), 'Clash.hs should import Clash.Main');
	});

	test('Should create standalone synth project when no .cabal found', async function() {
		this.timeout(15000);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			this.skip();
			return;
		}

		const wsRoot = workspaceFolders[0].uri.fsPath;
		// Use a source file in /tmp which has no .cabal
		const sourceFile = '/tmp/Standalone.hs';
		const synthInfo = await codeGenerator.ensureSynthProject(wsRoot, sourceFile);

		const cabalProjectContent = await fsp.readFile(
			path.join(synthInfo.synthRoot, 'cabal.project'), 'utf8'
		);
		assert.ok(cabalProjectContent.includes('packages:'), 'cabal.project should list packages');
		assert.ok(!cabalProjectContent.includes('optional-packages'), 'Should NOT reference user project');

		// Should NOT have cabalProjectDir
		assert.strictEqual(synthInfo.cabalProjectDir, null);

		const cabalFileContent = await fsp.readFile(
			path.join(synthInfo.synthRoot, 'clash-synth.cabal'), 'utf8'
		);
		assert.ok(!cabalFileContent.includes('simple'), 'Should NOT depend on any user package');
		assert.ok(cabalFileContent.includes('clash-prelude'), 'Should still depend on clash-prelude');
		assert.ok(cabalFileContent.includes('/tmp'), 'Should add source dir to hs-source-dirs');
	});

	test('Should include synthProjectRoot in generation result', async function() {
		this.timeout(10000);

		const testFunction: FunctionInfo = {
			name: 'testSynth',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Int -> Int',
			isMonomorphic: true,
			filePath: '/test/Test.hs',
			moduleName: 'Test'
		};

		if (!tempDir) {
			this.skip();
			return;
		}

		const config: GenerationConfig = {
			keepFiles: true,
			modulePrefix: 'ClashSynth_'
		};

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/tmp';
		const result = await codeGenerator.generateWrapper(testFunction, config, wsRoot);
		assert.ok(result.synthProjectRoot, 'Should have synthProjectRoot in result');
		assert.ok(
			result.synthProjectRoot.includes('synth-project'),
			'synthProjectRoot should point to synth-project'
		);
	});

	test('Should find cabal project from nested source file', async function() {
		this.timeout(10000);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			this.skip();
			return;
		}

		const wsRoot = workspaceFolders[0].uri.fsPath;
		// Source file deep inside the test-project
		const sourceFile = path.join(wsRoot, 'src', 'Example', 'Project.hs');
		const result = await CodeGenerator.findCabalProject(sourceFile);

		assert.ok(result, 'Should find a cabal project');
		assert.strictEqual(result!.packageName, 'simple');
		assert.strictEqual(result!.projectRoot, wsRoot);
	});

	test('Should return null for file outside any cabal project', async function() {
		this.timeout(5000);

		const result = await CodeGenerator.findCabalProject('/tmp/Standalone.hs');
		assert.strictEqual(result, null);
	});

	test('Should find cabal.project file from project root', async function() {
		this.timeout(10000);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			this.skip();
			return;
		}

		const wsRoot = workspaceFolders[0].uri.fsPath;
		const result = await CodeGenerator.findCabalProjectFile(wsRoot);

		assert.ok(result, 'Should find cabal.project');
		assert.ok(result!.endsWith('cabal.project'));
	});

	test('Should return null for findCabalProjectFile in directory without one', async function() {
		this.timeout(5000);

		const result = await CodeGenerator.findCabalProjectFile('/tmp');
		assert.strictEqual(result, null);
	});

	// ── Regression tests ────────────────────────────────────────────────────

	/**
	 * Regression: synthesizing function B after function A left A's wrapper
	 * file on disk.  The stale module was still listed in clash-synth.cabal,
	 * causing cabal to error about a missing dependency when the user's package
	 * was no longer relevant to the new synthesis target.
	 */
	test('Regression: stale wrapper from previous function is removed', async function() {
		this.timeout(15000);

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!wsRoot) { return this.skip(); }

		const config: GenerationConfig = { keepFiles: true, modulePrefix: 'ClashSynth_' };

		const funcA: FunctionInfo = {
			name: 'regressionAlpha',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Int -> Int',
			isMonomorphic: true,
			filePath: '/tmp/Reg.hs',
			moduleName: 'Reg'
		};
		const funcB: FunctionInfo = {
			name: 'regressionBeta',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Bool -> Bool',
			isMonomorphic: true,
			filePath: '/tmp/Reg.hs',
			moduleName: 'Reg'
		};

		const synthRoot = CodeGenerator.getSynthProjectRoot(wsRoot);
		const srcDir   = path.join(synthRoot, 'src');
		const wrapperA = path.join(srcDir, 'ClashSynth_RegressionAlpha.hs');
		const wrapperB = path.join(srcDir, 'ClashSynth_RegressionBeta.hs');

		// ── Step 1: synthesize function A ────────────────────────────────────
		await codeGenerator.generateWrapper(funcA, config, wsRoot);
		await codeGenerator.ensureSynthProject(wsRoot, funcA.filePath);

		// A's wrapper must exist after the first synthesis
		await fsp.access(wrapperA);  // throws if missing

		// ── Step 2: synthesize function B ────────────────────────────────────
		await codeGenerator.generateWrapper(funcB, config, wsRoot);
		await codeGenerator.ensureSynthProject(wsRoot, funcB.filePath);

		// A's wrapper must now be gone
		let aStillExists = false;
		try { await fsp.access(wrapperA); aStillExists = true; } catch {}
		assert.strictEqual(aStillExists, false,
			'ClashSynth_RegressionAlpha.hs should have been deleted when switching to function B');

		// B's wrapper must exist
		await fsp.access(wrapperB);  // throws if missing

		// The cabal file must list B but not A
		const cabalContent = await fsp.readFile(
			path.join(synthRoot, 'clash-synth.cabal'), 'utf8'
		);
		assert.ok(cabalContent.includes('ClashSynth_RegressionBeta'),
			'clash-synth.cabal should list ClashSynth_RegressionBeta');
		assert.ok(!cabalContent.includes('ClashSynth_RegressionAlpha'),
			'clash-synth.cabal must not list the stale ClashSynth_RegressionAlpha');
	});

	/**
	 * Regression: every synthesis run unconditionally rewrote the wrapper .hs,
	 * cabal.project, clash-synth.cabal, and bin/Clash.hs with identical content.
	 * That dirtied the file mtimes and caused cabal to re-compile even though
	 * nothing had changed, wasting significant build time.
	 */
	test('Regression: re-synthesizing the same function does not touch file mtimes', async function() {
		this.timeout(15000);

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!wsRoot) { return this.skip(); }

		const config: GenerationConfig = { keepFiles: true, modulePrefix: 'ClashSynth_' };
		const sourceFile = path.join(wsRoot, 'src', 'Example', 'Project.hs');

		const func: FunctionInfo = {
			name: 'idempotentFunc',
			range: new vscode.Range(0, 0, 0, 0),
			typeSignature: 'Unsigned 8 -> Unsigned 8',
			isMonomorphic: true,
			filePath: sourceFile,
			moduleName: 'Example.Project'
		};

		const synthRoot     = CodeGenerator.getSynthProjectRoot(wsRoot);
		const wrapperPath   = path.join(synthRoot, 'src',  'ClashSynth_IdempotentFunc.hs');
		const cabalProjPath = path.join(synthRoot,         'cabal.project');
		const cabalFilePath = path.join(synthRoot,         'clash-synth.cabal');
		const clashMainPath = path.join(synthRoot, 'bin',  'Clash.hs');

		// ── First run: write everything for the first time ───────────────────
		await codeGenerator.generateWrapper(func, config, wsRoot);
		await codeGenerator.ensureSynthProject(wsRoot, sourceFile);

		// Snapshot mtimes after the first write
		const [mWrapper, mCabalProj, mCabalFile, mClashMain] = await Promise.all([
			fsp.stat(wrapperPath).then(s => s.mtimeMs),
			fsp.stat(cabalProjPath).then(s => s.mtimeMs),
			fsp.stat(cabalFilePath).then(s => s.mtimeMs),
			fsp.stat(clashMainPath).then(s => s.mtimeMs),
		]);

		// Wait long enough that any write would produce a different mtime
		await new Promise<void>(r => setTimeout(r, 50));

		// ── Second run: identical inputs, nothing should be rewritten ─────────
		await codeGenerator.generateWrapper(func, config, wsRoot);
		await codeGenerator.ensureSynthProject(wsRoot, sourceFile);

		assert.strictEqual(
			(await fsp.stat(wrapperPath)).mtimeMs, mWrapper,
			'Wrapper .hs mtime must not change when re-synthesizing the same function'
		);
		assert.strictEqual(
			(await fsp.stat(cabalProjPath)).mtimeMs, mCabalProj,
			'cabal.project mtime must not change on re-synthesis'
		);
		assert.strictEqual(
			(await fsp.stat(cabalFilePath)).mtimeMs, mCabalFile,
			'clash-synth.cabal mtime must not change on re-synthesis'
		);
		assert.strictEqual(
			(await fsp.stat(clashMainPath)).mtimeMs, mClashMain,
			'bin/Clash.hs mtime must not change on re-synthesis'
		);
	});
});

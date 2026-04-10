import * as assert from 'assert';
import * as path from 'path';
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
			outputDir: tempDir,
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
			outputDir: tempDir,
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
			outputDir: tempDir,
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
			outputDir: tempDir,
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
			outputDir: tempDir,
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
		assert.ok(dirs.haskell.includes('01-haskell'));
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
		const { promises: fsp } = require('fs');
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

		const { promises: fsp } = require('fs');
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
			outputDir: tempDir,
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
});

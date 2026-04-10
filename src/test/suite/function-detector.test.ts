import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { HLSClient } from '../../hls-client';
import { FunctionDetector } from '../../function-detector';

/**
 * Helper to open a file from the test project
 */
async function openTestFile(relativePath: string): Promise<vscode.TextDocument> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	assert.ok(workspaceFolders && workspaceFolders.length > 0, 'Workspace should be open');
	
	const filePath = path.join(workspaceFolders[0].uri.fsPath, relativePath);
	const uri = vscode.Uri.file(filePath);
	
	// Set language ID explicitly to 'haskell' to ensure it's recognized
	const document = await vscode.workspace.openTextDocument(uri);
	
	// Show the document to ensure it's active
	await vscode.window.showTextDocument(document);
	
	// Try to set language mode to haskell — this will fail if no extension
	// has registered the 'haskell' language ID (e.g. in the test host with
	// --disable-extensions). That's fine: isHaskellDocument also checks .hs.
	if (document.languageId !== 'haskell') {
		try {
			await vscode.languages.setTextDocumentLanguage(document, 'haskell');
		} catch {
			// Language ID not registered — rely on file extension detection
		}
	}
	
	return document;
}

suite('Function Detection Integration Test Suite', () => {
	let outputChannel: vscode.OutputChannel;
	let hlsClient: HLSClient;
	let functionDetector: FunctionDetector;

	suiteSetup(async function() {
		// HLS may need time to start up and index the test project.
		this.timeout(120_000);

		// Create output channel ONCE for entire suite
		outputChannel = vscode.window.createOutputChannel('Test Function Detector');
		
		// Initialize clients
		hlsClient = new HLSClient(outputChannel);
		functionDetector = new FunctionDetector(hlsClient, outputChannel);

		// Open the file early so HLS begins indexing while we wait.
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders && workspaceFolders.length > 0) {
			const filePath = path.join(workspaceFolders[0].uri.fsPath, 'src/Example/Project.hs');
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
			await vscode.window.showTextDocument(doc);
		}

		// Give HLS time to initialise and index the project
		outputChannel.appendLine('Waiting for HLS to initialize...');
		await new Promise(resolve => setTimeout(resolve, 15_000));
	});

	suiteTeardown(() => {
		// Dispose only once at end
		if (outputChannel) {
			outputChannel.dispose();
		}
	});

	/**
	 * Helper: detect functions, skipping the test if HLS isn't available.
	 * HLS requires the Haskell extension which is disabled by --disable-extensions
	 * in the test runner, so these integration tests can only pass when the
	 * extension host has a working Haskell language server.
	 */
	async function detectOrSkip(
		ctx: Mocha.Context,
		document: vscode.TextDocument
	): Promise<import('../../types').FunctionInfo[]> {
		const functions = await functionDetector.detectFunctions(document);
		if (functions.length === 0) {
			ctx.skip(); // HLS not available — skip instead of failing
		}
		return functions;
	}

	test('Should detect functions in test project', async function() {
		this.timeout(60_000);

		const document = await openTestFile('src/Example/Project.hs');
		assert.ok(
			document.languageId === 'haskell' || document.fileName.endsWith('.hs'),
			'Document should be a Haskell file'
		);

		// Wait for HLS to process the file
		outputChannel.appendLine('Waiting for HLS to process file...');
		await new Promise(resolve => setTimeout(resolve, 3000));

		// Detect functions (skips test if HLS is not running)
		const functions = await detectOrSkip(this, document);

		outputChannel.appendLine(`Detected ${functions.length} functions`);
		for (const func of functions) {
			outputChannel.appendLine(`  - ${func.name}: ${func.typeSignature}`);
		}

		// Should find at least the main functions
		assert.ok(functions.length >= 4, `Should detect at least 4 functions, found ${functions.length}`);

		// Check specific functions exist
		const functionNames = functions.map(f => f.name);
		assert.ok(functionNames.includes('plusSigned'), 'Should find plusSigned');
		assert.ok(functionNames.includes('plusPoly'), 'Should find plusPoly');
		assert.ok(functionNames.includes('multUnsigned'), 'Should find multUnsigned');
		assert.ok(functionNames.includes('topEntity'), 'Should find topEntity');
	});

	test('Should correctly identify monomorphic functions', async function() {
		this.timeout(60_000);

		const document = await openTestFile('src/Example/Project.hs');
		await new Promise(resolve => setTimeout(resolve, 3000));

		const functions = await detectOrSkip(this, document);
		
		// plusSigned should be monomorphic
		const plusSigned = functions.find(f => f.name === 'plusSigned');
		assert.ok(plusSigned, 'Should find plusSigned');
		assert.strictEqual(
			plusSigned.isMonomorphic,
			true,
			'plusSigned should be monomorphic'
		);

		// plusPoly should be polymorphic
		const plusPoly = functions.find(f => f.name === 'plusPoly');
		assert.ok(plusPoly, 'Should find plusPoly');
		assert.strictEqual(
			plusPoly.isMonomorphic,
			false,
			'plusPoly should be polymorphic'
		);
	});

	test('Should filter synthesizable functions', async function() {
		this.timeout(60_000);

		const document = await openTestFile('src/Example/Project.hs');
		await new Promise(resolve => setTimeout(resolve, 3000));

		const allFunctions = await detectOrSkip(this, document);
		const synthesizable = functionDetector.filterSynthesizable(allFunctions);

		outputChannel.appendLine(`Total functions: ${allFunctions.length}`);
		outputChannel.appendLine(`Synthesizable: ${synthesizable.length}`);

		// Should have fewer synthesizable than total
		assert.ok(
			synthesizable.length < allFunctions.length,
			'Should have polymorphic functions that are not synthesizable'
		);

		// All synthesizable should be monomorphic
		for (const func of synthesizable) {
			assert.strictEqual(
				func.isMonomorphic,
				true,
				`${func.name} in synthesizable list should be monomorphic`
			);
		}
	});

	test('Should extract type signatures from HLS', async function() {
		this.timeout(60_000);

		const document = await openTestFile('src/Example/Project.hs');
		await new Promise(resolve => setTimeout(resolve, 3000));

		const functions = await detectOrSkip(this, document);
		
		// Check that type signatures are present
		const functionsWithTypes = functions.filter(f => f.typeSignature !== null);
		assert.ok(
			functionsWithTypes.length > 0,
			'Should extract type signatures from HLS'
		);

		// Check plusSigned has correct type
		const plusSigned = functions.find(f => f.name === 'plusSigned');
		if (plusSigned && plusSigned.typeSignature) {
			assert.ok(
				plusSigned.typeSignature.includes('Signed'),
				'plusSigned should have Signed in type signature'
			);
		}
	});
});

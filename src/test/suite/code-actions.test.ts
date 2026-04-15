import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ClashCodeActionProvider } from '../../clash-code-actions';
import { FunctionDetector } from '../../function-detector';
import { HLSClient } from '../../hls-client';

/**
 * Tests for Clash code action provider (Ctrl+.)
 */
suite('Code Action Provider', () => {
	let outputChannel: vscode.OutputChannel;

	suiteSetup(() => {
		outputChannel = vscode.window.createOutputChannel('Test Code Actions');
	});

	suiteTeardown(() => {
		if (outputChannel) {
			outputChannel.dispose();
		}
	});

	test('providedCodeActionKinds is defined', () => {
		assert.ok(
			Array.isArray(ClashCodeActionProvider.providedCodeActionKinds),
			'Should expose providedCodeActionKinds'
		);
		assert.ok(
			ClashCodeActionProvider.providedCodeActionKinds.length > 0,
			'Should have at least one kind'
		);
	});

	test('returns empty actions for non-Haskell document', async function () {
		this.timeout(10000);

		const hlsClient = new HLSClient(outputChannel);
		const detector = new FunctionDetector(hlsClient, outputChannel);
		const provider = new ClashCodeActionProvider(detector);

		// Create a plaintext document — no Haskell functions will be detected
		const doc = await vscode.workspace.openTextDocument({
			content: 'hello world',
			language: 'plaintext'
		});

		const range = new vscode.Range(0, 0, 0, 0);
		const actions = await provider.provideCodeActions(doc, range);

		assert.ok(Array.isArray(actions), 'Should return an array');
		assert.strictEqual(actions.length, 0, 'Should return no actions for plaintext');
	});

	test('actions use correct command IDs', async function () {
		this.timeout(30000);

		// Open the test-project Haskell file — requires HLS running
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			this.skip();
			return;
		}

		const hlsClient = new HLSClient(outputChannel);
		const detector = new FunctionDetector(hlsClient, outputChannel);
		const provider = new ClashCodeActionProvider(detector);

		const testFile = vscode.Uri.file(
			path.join(workspaceFolders[0].uri.fsPath, 'src', 'Example', 'Project.hs')
		);

		let doc: vscode.TextDocument;
		try {
			doc = await vscode.workspace.openTextDocument(testFile);
		} catch {
			this.skip();
			return;
		}

		// Wait a bit for HLS
		await new Promise(resolve => setTimeout(resolve, 3000));

		// Try to get actions at line 0 — might detect topEntity
		const range = new vscode.Range(0, 0, doc.lineCount - 1, 0);
		const actions = await provider.provideCodeActions(doc, range);

		// If HLS found monomorphic functions, verify command structure
		for (const action of actions) {
			assert.ok(action.command, 'Action should have a command');
			assert.ok(
				action.command!.command === 'clash-vscode-yosys.synthesizeOnly' ||
				action.command!.command === 'clash-vscode-yosys.synthesizeAndPnR',
				`Command should be synthesizeOnly or synthesizeAndPnR, got: ${action.command!.command}`
			);
			assert.ok(
				action.command!.arguments && action.command!.arguments.length === 1,
				'Command should pass FunctionInfo as argument'
			);
			const funcArg = action.command!.arguments![0];
			assert.ok(funcArg.name, 'FunctionInfo should have a name');
			assert.ok(funcArg.isMonomorphic === true, 'FunctionInfo should be monomorphic');
		}
	});
});

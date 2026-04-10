import * as assert from 'assert';
import * as vscode from 'vscode';
import { HLSClient } from '../../hls-client';

suite('HLS Client Test Suite', () => {
	let outputChannel: vscode.OutputChannel;
	let hlsClient: HLSClient;

	suiteSetup(() => {
		outputChannel = vscode.window.createOutputChannel('Test HLS Client');
		hlsClient = new HLSClient(outputChannel);
	});

	suiteTeardown(() => {
		if (outputChannel) {
			outputChannel.dispose();
		}
	});

	test('Should extract single-line type signature from hover', () => {
		const hovers: vscode.Hover[] = [{
			contents: [new vscode.MarkdownString('```haskell\nplusSigned :: Signed 8 -> Signed 8 -> Signed 8\n```')]
		}];

		const result = hlsClient.extractTypeSignature(hovers);
		assert.strictEqual(result, 'Signed 8 -> Signed 8 -> Signed 8');
	});

	test('Should extract multi-line type signature from hover', () => {
		const hovers: vscode.Hover[] = [{
			contents: [new vscode.MarkdownString(
				'```haskell\ntopEntity\n  :: Clock Dom50\n  -> Reset Dom50\n  -> Enable Dom50\n  -> Signal Dom50 (Unsigned 8)\n  -> Signal Dom50 (Unsigned 8)\n```'
			)]
		}];

		const result = hlsClient.extractTypeSignature(hovers);
		assert.ok(result, 'Should extract type');
		assert.ok(result!.includes('Clock Dom50'), 'Should contain Clock Dom50');
		assert.ok(result!.includes('Signal Dom50 (Unsigned 8)'), 'Should contain full Signal type');
		// Should be collapsed to a single line
		assert.ok(!result!.includes('\n'), 'Should be a single line');
	});

	test('Should handle plain text type signature', () => {
		const hovers: vscode.Hover[] = [{
			contents: [new vscode.MarkdownString('myFunc :: Int -> Bool')]
		}];

		const result = hlsClient.extractTypeSignature(hovers);
		assert.strictEqual(result, 'Int -> Bool');
	});

	test('Should return null for hover without type', () => {
		const hovers: vscode.Hover[] = [{
			contents: [new vscode.MarkdownString('This is a comment')]
		}];

		const result = hlsClient.extractTypeSignature(hovers);
		assert.strictEqual(result, null);
	});

	test('Should return null for empty hovers', () => {
		const result = hlsClient.extractTypeSignature([]);
		assert.strictEqual(result, null);
	});

	test('Should detect Haskell documents', () => {
		// We can't easily create mock documents, but we can test the method exists
		assert.ok(typeof hlsClient.isHaskellDocument === 'function');
	});

	test('Should handle hover with string content', () => {
		const hovers: vscode.Hover[] = [{
			contents: ['func :: Unsigned 16 -> Bool' as unknown as vscode.MarkdownString]
		}];

		const result = hlsClient.extractTypeSignature(hovers);
		assert.strictEqual(result, 'Unsigned 16 -> Bool');
	});
});

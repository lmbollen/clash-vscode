import * as vscode from 'vscode';
import { FunctionDetector } from './function-detector';

/**
 * Provides code actions (Ctrl+.) for monomorphic Haskell functions,
 * offering "Synthesize" and "Synthesize + Place & Route" options.
 */
export class ClashCodeActionProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [
		vscode.CodeActionKind.Empty
	];

	constructor(private functionDetector: FunctionDetector) {}

	async provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection
	): Promise<vscode.CodeAction[]> {
		// Use the targeted single-symbol lookup — safe to call on every cursor move.
		const func = await this.functionDetector.getFunctionAtPosition(document, range.start);
		if (!func || !func.isMonomorphic) {
			return [];
		}

		const actions: vscode.CodeAction[] = [];

		// Synthesize Only
		const synthAction = new vscode.CodeAction(
			`Clash: Synthesize '${func.name}'`,
			vscode.CodeActionKind.Empty
		);
		synthAction.command = {
			command: 'clash-vscode-yosys.synthesizeOnly',
			title: `Synthesize ${func.name}`,
			arguments: [func]
		};
		actions.push(synthAction);

		// Synthesize + PnR
		const pnrAction = new vscode.CodeAction(
			`Clash: Synthesize + Place & Route '${func.name}'`,
			vscode.CodeActionKind.Empty
		);
		pnrAction.command = {
			command: 'clash-vscode-yosys.synthesizeAndPnR',
			title: `Synthesize + PnR ${func.name}`,
			arguments: [func]
		};
		actions.push(pnrAction);

		return actions;
	}

}


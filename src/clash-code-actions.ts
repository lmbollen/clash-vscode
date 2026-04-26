import * as vscode from 'vscode';
import { FunctionDetector } from './function-detector';

/**
 * Provides code actions (Ctrl+.) for monomorphic Haskell functions,
 * offering "Elaborate", "Synthesize", and "Place & Route" options.
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

		// Elaborate
		const elabAction = new vscode.CodeAction(
			`Clash: Elaborate '${func.name}'`,
			vscode.CodeActionKind.Empty
		);
		elabAction.command = {
			command: 'clash-toolkit.elaborate',
			title: `Elaborate ${func.name}`,
			arguments: [func]
		};
		actions.push(elabAction);

		// Synthesize
		const synthAction = new vscode.CodeAction(
			`Clash: Synthesize '${func.name}'`,
			vscode.CodeActionKind.Empty
		);
		synthAction.command = {
			command: 'clash-toolkit.synthesize',
			title: `Synthesize ${func.name}`,
			arguments: [func]
		};
		actions.push(synthAction);

		// Place & Route
		const pnrAction = new vscode.CodeAction(
			`Clash: Place & Route '${func.name}'`,
			vscode.CodeActionKind.Empty
		);
		pnrAction.command = {
			command: 'clash-toolkit.placeAndRoute',
			title: `Place & Route ${func.name}`,
			arguments: [func]
		};
		actions.push(pnrAction);

		return actions;
	}

}


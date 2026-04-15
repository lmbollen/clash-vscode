import * as vscode from 'vscode';
import { FunctionInfo } from './types';

export type FunctionTreeNode = SectionNode | FunctionNode;

/**
 * Provides the "Haskell Functions" sidebar view.
 *
 * Shows two collapsible sections — Synthesizable (monomorphic) on top,
 * Polymorphic (grayed) below — for the currently active Haskell file.
 */
export class HaskellFunctionsTreeProvider
    implements vscode.TreeDataProvider<FunctionTreeNode>
{
    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<FunctionTreeNode | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private mono: FunctionInfo[] = [];
    private poly: FunctionInfo[] = [];
    private fileName: string | undefined;
    private loading = false;

    /** Called while HLS analysis is in progress. */
    setLoading(fileName: string): void {
        this.fileName = fileName;
        this.loading = true;
        this.mono = [];
        this.poly = [];
        this._onDidChangeTreeData.fire(undefined);
    }

    /** Called with the final results once analysis completes. */
    refresh(functions: FunctionInfo[], fileName?: string): void {
        this.loading = false;
        this.fileName = fileName;
        this.mono = functions.filter(f => f.isMonomorphic)
            .sort((a, b) => a.name.localeCompare(b.name));
        this.poly = functions.filter(f => !f.isMonomorphic)
            .sort((a, b) => a.name.localeCompare(b.name));
        this._onDidChangeTreeData.fire(undefined);
    }

    /** Called when no Haskell file is active. */
    clear(): void {
        this.loading = false;
        this.fileName = undefined;
        this.mono = [];
        this.poly = [];
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: FunctionTreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FunctionTreeNode): FunctionTreeNode[] {
        if (element instanceof SectionNode) {
            return element.kind === 'mono'
                ? this.mono.map(f => new FunctionNode(f, false))
                : this.poly.map(f => new FunctionNode(f, true));
        }

        // Root level
        if (this.loading) {
            const placeholder = new vscode.TreeItem('Analyzing…');
            placeholder.iconPath = new vscode.ThemeIcon('loading~spin');
            // vscode.TreeItem is not our union type, but getTreeItem handles it via duck-typing
            return [placeholder as unknown as FunctionTreeNode];
        }

        if (!this.fileName) {
            const placeholder = new vscode.TreeItem('Open a Haskell file to see functions');
            placeholder.iconPath = new vscode.ThemeIcon('info');
            return [placeholder as unknown as FunctionTreeNode];
        }

        return [
            new SectionNode('mono', this.mono.length),
            new SectionNode('poly', this.poly.length),
        ];
    }
}

// ── Section header nodes ─────────────────────────────────────────────────────

class SectionNode extends vscode.TreeItem {
    constructor(
        readonly kind: 'mono' | 'poly',
        count: number,
    ) {
        const label = kind === 'mono'
            ? `Monomorphic (${count})`
            : `Polymorphic (${count})`;
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = kind === 'mono' ? 'monoSection' : 'polySection';

        if (kind === 'mono') {
            this.iconPath = new vscode.ThemeIcon(
                'symbol-function',
                new vscode.ThemeColor('testing.iconPassed'),
            );
        } else {
            this.iconPath = new vscode.ThemeIcon(
                'symbol-function',
                new vscode.ThemeColor('disabledForeground'),
            );
        }
    }
}

// ── Function leaf nodes ──────────────────────────────────────────────────────

export class FunctionNode extends vscode.TreeItem {
    constructor(
        readonly info: FunctionInfo,
        readonly isPolymorphic: boolean,
    ) {
        super(info.name, vscode.TreeItemCollapsibleState.None);

        this.description = info.typeSignature
            ? `:: ${info.typeSignature}`
            : undefined;

        this.tooltip = new vscode.MarkdownString(
            `**${info.name}**` +
            (info.typeSignature ? `\n\n\`\`\`haskell\n:: ${info.typeSignature}\n\`\`\`` : '') +
            (isPolymorphic
                ? '\n\n*Polymorphic — cannot be synthesized directly.*'
                : '\n\n*Monomorphic — can be synthesized.*')
        );

        this.iconPath = isPolymorphic
            ? new vscode.ThemeIcon('symbol-variable', new vscode.ThemeColor('disabledForeground'))
            : new vscode.ThemeIcon('symbol-function', new vscode.ThemeColor('symbolIcon.functionForeground'));

        this.contextValue = isPolymorphic ? 'polyFunction' : 'monoFunction';

        // Navigate to the function on click
        this.command = {
            command: 'clash-vscode-yosys.goToFunction',
            title: 'Go to function',
            arguments: [info],
        };
    }
}

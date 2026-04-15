import * as vscode from 'vscode';
import { ModuleSynthesisResult } from './yosys-types';

type SynthTreeNode = ModuleTreeItem | UtilizationEntry;

/**
 * Provides the tree data for the "Synthesis Results" sidebar view.
 *
 * Each module item is expandable and shows a breakdown of mapped FPGA
 * primitive cell types (LUT4, TRELLIS_FF, …) as children.  An inline
 * "View Diagram" action button appears on items that have a diagram.
 */
export class SynthesisResultsTreeProvider
    implements vscode.TreeDataProvider<SynthTreeNode>
{
    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<SynthTreeNode | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private results: ModuleSynthesisResult[] = [];

    /** Call this whenever synthesis completes to update the sidebar. */
    refresh(results: ModuleSynthesisResult[]): void {
        this.results = results;
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: SynthTreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SynthTreeNode): SynthTreeNode[] {
        if (element instanceof ModuleTreeItem) {
            return element.fpgaCells.map(
                ([name, count]) => new UtilizationEntry(name, count)
            );
        }

        // Root level
        if (this.results.length === 0) {
            const placeholder = new ModuleTreeItem('No synthesis results yet');
            placeholder.description = 'Run synthesis to populate this view';
            placeholder.iconPath = new vscode.ThemeIcon('info');
            placeholder.contextValue = 'placeholder';
            return [placeholder];
        }
        return this.results.map(r => new ModuleTreeItem(r));
    }
}

// ── Module item ──────────────────────────────────────────────────────────────

export class ModuleTreeItem extends vscode.TreeItem {
    /** Non-$ cell types sorted by count descending. Empty for OOC modules. */
    readonly fpgaCells: [string, number][];

    constructor(labelOrPlaceholder: string);
    constructor(result: ModuleSynthesisResult);
    constructor(arg: string | ModuleSynthesisResult) {
        if (typeof arg === 'string') {
            super(arg, vscode.TreeItemCollapsibleState.None);
            this.fpgaCells = [];
            return;
        }

        const r = arg;
        const fpgaCells = r.statistics?.cellTypes
            ? Array.from(r.statistics.cellTypes.entries())
                .filter(([name]) => !name.startsWith('$'))
                .sort((a, b) => b[1] - a[1])
            : [];

        super(
            r.name,
            fpgaCells.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );

        this.fpgaCells = fpgaCells;

        const cells = r.statistics?.cellCount;
        const wires = r.statistics?.wireCount;

        if (r.success) {
            const parts: string[] = [];
            if (cells !== undefined) { parts.push(`${cells.toLocaleString()} cells`); }
            if (wires !== undefined) { parts.push(`${wires.toLocaleString()} wires`); }
            this.description = parts.join(' · ') || 'OK';
            this.iconPath = new vscode.ThemeIcon(
                'pass',
                new vscode.ThemeColor('testing.iconPassed')
            );
            this.tooltip = new vscode.MarkdownString(
                `**${r.name}**\n\n` +
                `Cells: ${cells ?? '—'}  ·  Wires: ${wires ?? '—'}  ·  ${r.elapsedMs} ms`
            );
        } else {
            this.description = r.errors[0]?.message ?? 'failed';
            this.iconPath = new vscode.ThemeIcon(
                'error',
                new vscode.ThemeColor('testing.iconFailed')
            );
            this.tooltip = new vscode.MarkdownString(
                `**${r.name}** — failed\n\n` +
                r.errors.map(e => `- ${e.message}`).join('\n')
            );
        }

        // contextValue drives the inline View button visibility in package.json.
        this.contextValue = r.diagramJsonPath
            ? 'synthesisModuleWithDiagram'
            : 'synthesisModule';

        // Store the full result so the viewModuleDiagram command can use it.
        this.result = r;
    }

    // Attached by the constructor for modules built from a result.
    result?: ModuleSynthesisResult;
}

// ── Utilization child items ──────────────────────────────────────────────────

class UtilizationEntry extends vscode.TreeItem {
    constructor(cellType: string, count: number) {
        super(cellType, vscode.TreeItemCollapsibleState.None);
        this.description = count.toLocaleString();
        this.iconPath = new vscode.ThemeIcon('symbol-constant');
        this.contextValue = 'utilizationEntry';
    }
}

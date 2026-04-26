import * as vscode from 'vscode';
import { ModuleSynthesisResult } from './yosys-types';
import { CriticalPath, NextpnrResult } from './nextpnr-types';

type SynthTreeNode =
    | ModuleTreeItem
    | UtilizationEntry
    | SectionItem
    | KeyValueItem
    | CriticalPathItem;

/**
 * Provides the tree data for the "Synthesis Results" sidebar view.
 *
 * Layout:
 *   ├─ <module-1>  (cells, wires, depth — expandable → cell-type breakdown)
 *   ├─ <module-N>
 *   ├─ Timing             ← only after Place & Route
 *   │   ├─ Max Frequency
 *   │   ├─ Constraint
 *   │   └─ Critical Path Delay
 *   ├─ Utilization        ← only after Place & Route
 *   │   ├─ LUTs
 *   │   └─ ...
 *   └─ Critical Paths     ← only after Place & Route
 *       └─ <from → to>   (expandable → step-by-step)
 *
 * PNR sections are cleared when the user re-runs elaborate or synthesize
 * so stale place-and-route numbers never survive a fresh synthesis.
 */
export class SynthesisResultsTreeProvider
    implements vscode.TreeDataProvider<SynthTreeNode>
{
    private readonly _onDidChangeTreeData =
        new vscode.EventEmitter<SynthTreeNode | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private results: ModuleSynthesisResult[] = [];
    private pnr: NextpnrResult | undefined;

    /**
     * Replace the current contents of the tree.
     *
     * `pnr` is undefined for elaborate / synthesize runs, which intentionally
     * clears any previous PNR section so the view never shows stale Fmax /
     * utilization from a prior placeAndRoute.
     */
    refresh(results: ModuleSynthesisResult[], pnr?: NextpnrResult): void {
        this.results = results;
        this.pnr = pnr;
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
        if (element instanceof SectionItem) {
            return element.children;
        }
        if (element instanceof CriticalPathItem) {
            return element.stepItems;
        }

        // Root level
        if (this.results.length === 0 && !this.pnr) {
            const placeholder = new ModuleTreeItem('No synthesis results yet');
            placeholder.description = 'Run elaboration, synthesis or P&R to populate this view';
            placeholder.iconPath = new vscode.ThemeIcon('info');
            placeholder.contextValue = 'placeholder';
            return [placeholder];
        }

        const roots: SynthTreeNode[] = this.results.map(r => new ModuleTreeItem(r));

        if (this.pnr) {
            const timingSection = buildTimingSection(this.pnr);
            if (timingSection) { roots.push(timingSection); }

            const utilSection = buildUtilizationSection(this.pnr);
            if (utilSection) { roots.push(utilSection); }

            const cpSection = buildCriticalPathSection(this.pnr.criticalPaths);
            if (cpSection) { roots.push(cpSection); }
        }

        return roots;
    }
}

// ── Module item ──────────────────────────────────────────────────────────────

export class ModuleTreeItem extends vscode.TreeItem {
    /** Cell types sorted by count descending. */
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
            if (r.statistics?.logicDepth !== undefined) {
                parts.push(`depth ${r.statistics.logicDepth}`);
            }
            this.description = parts.join(' · ') || 'OK';
            this.iconPath = new vscode.ThemeIcon(
                'pass',
                new vscode.ThemeColor('testing.iconPassed')
            );
            const depthStr = r.statistics?.logicDepth !== undefined
                ? `  ·  Depth: ${r.statistics.logicDepth}`
                : '';
            this.tooltip = new vscode.MarkdownString(
                `**${r.name}**\n\n` +
                `Cells: ${cells ?? '—'}  ·  Wires: ${wires ?? '—'}${depthStr}  ·  ${r.elapsedMs} ms`
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

        // contextValue drives inline button visibility in package.json.
        // Tags are appended so menu "when" clauses can use regex matching.
        let ctx = 'synthesisModule';
        if (r.diagramJsonPath) { ctx += '-diagram'; }
        if (r.verilogFiles?.length) { ctx += '-verilog'; }
        this.contextValue = ctx;

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

// ── PNR section framework ────────────────────────────────────────────────────

/** Expandable section header with a fixed list of children. */
class SectionItem extends vscode.TreeItem {
    constructor(
        label: string,
        icon: string,
        readonly children: SynthTreeNode[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = 'pnrSection';
    }
}

/** Generic label/value row used inside PNR sections. */
class KeyValueItem extends vscode.TreeItem {
    constructor(label: string, value: string, icon = 'symbol-field', tooltip?: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = value;
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = 'pnrRow';
        if (tooltip) { this.tooltip = tooltip; }
    }
}

/** Critical-path row — expandable into the step chain. */
class CriticalPathItem extends vscode.TreeItem {
    readonly stepItems: KeyValueItem[];

    constructor(path: CriticalPath) {
        const label = truncate(path.from, 24) + ' → ' + truncate(path.to, 24);
        super(label, vscode.TreeItemCollapsibleState.Collapsed);

        this.description = `${path.totalDelay.toFixed(2)} ns`;
        this.iconPath = new vscode.ThemeIcon('arrow-right');
        this.contextValue = 'pnrCriticalPath';
        this.tooltip = new vscode.MarkdownString(
            `**${path.from}** → **${path.to}**\n\n` +
            `Total delay: \`${path.totalDelay.toFixed(3)} ns\`  ·  ${path.steps.length} step(s)`
        );

        this.stepItems = path.steps.map((step, i) => {
            const fromLabel = step.fromCell ? step.fromCell : '';
            const toLabel = step.toCell ? step.toCell : '';
            const arrow = fromLabel && toLabel && fromLabel !== toLabel
                ? `${truncate(fromLabel, 18)} → ${truncate(toLabel, 18)}`
                : fromLabel || toLabel || step.type;
            const kv = new KeyValueItem(
                `${i + 1}. ${step.type}`,
                `${step.delay.toFixed(3)} ns  ${arrow}`,
                iconForStep(step.type),
                step.net ? `net: ${step.net}` : undefined,
            );
            return kv;
        });
    }
}

function iconForStep(type: string): string {
    switch (type) {
        case 'source':    return 'debug-start';
        case 'routing':   return 'circuit-board';
        case 'clk-to-q':  return 'watch';
        case 'setup':     return 'debug-stop';
        default:          return 'symbol-field';
    }
}

function truncate(s: string, max: number): string {
    if (s.length <= max) { return s; }
    return s.slice(0, max - 1) + '…';
}

// ── Section builders ─────────────────────────────────────────────────────────

function buildTimingSection(pnr: NextpnrResult): SectionItem | undefined {
    const t = pnr.timing;
    if (!t) { return undefined; }

    const rows: KeyValueItem[] = [];

    if (t.maxFrequency !== undefined) {
        rows.push(new KeyValueItem('Max Frequency', `${t.maxFrequency.toFixed(2)} MHz`, 'pulse'));
    }
    if (t.prePlacementFrequency !== undefined && t.prePlacementFrequency !== t.maxFrequency) {
        rows.push(new KeyValueItem(
            'Pre-Route Estimate',
            `${t.prePlacementFrequency.toFixed(2)} MHz`,
            'dashboard',
        ));
    }
    if (t.criticalPathDelay !== undefined) {
        rows.push(new KeyValueItem(
            'Critical Path Delay',
            `${t.criticalPathDelay.toFixed(2)} ns`,
            'clock',
        ));
    }
    if (t.setupSlack !== undefined) {
        rows.push(new KeyValueItem(
            'Setup Slack',
            `${t.setupSlack.toFixed(3)} ns`,
            t.setupSlack >= 0 ? 'pass' : 'error',
        ));
    }
    if (t.holdSlack !== undefined) {
        rows.push(new KeyValueItem(
            'Hold Slack',
            `${t.holdSlack.toFixed(3)} ns`,
            t.holdSlack >= 0 ? 'pass' : 'error',
        ));
    }

    rows.push(new KeyValueItem(
        'Constraints',
        t.constraintsMet ? 'MET' : 'MISSED',
        t.constraintsMet ? 'pass' : 'error',
    ));

    if (rows.length === 0) { return undefined; }
    return new SectionItem('Timing', 'watch', rows);
}

function buildUtilizationSection(pnr: NextpnrResult): SectionItem | undefined {
    const u = pnr.utilization;
    if (!u) { return undefined; }

    const rows: KeyValueItem[] = [];
    const addRow = (label: string, bucket?: { used: number; total: number }, icon = 'symbol-field') => {
        if (!bucket || bucket.total === 0) { return; }
        const pct = (bucket.used / bucket.total) * 100;
        rows.push(new KeyValueItem(
            label,
            `${bucket.used.toLocaleString()} / ${bucket.total.toLocaleString()} (${pct.toFixed(1)}%)`,
            icon,
        ));
    };

    addRow('LUTs',       u.luts,      'circuit-board');
    addRow('Registers',  u.registers, 'symbol-variable');
    addRow('BRAM',       u.bram,      'database');
    addRow('DSP',        u.dsp,       'symbol-operator');
    addRow('IO',         u.io,        'plug');

    if (rows.length === 0) { return undefined; }
    return new SectionItem('Utilization', 'graph', rows);
}

function buildCriticalPathSection(paths?: CriticalPath[]): SectionItem | undefined {
    if (!paths || paths.length === 0) { return undefined; }
    // Cap at 5 so the tree doesn't explode for large designs with many
    // cross-domain paths; users can still open report.json for the full list.
    const items = paths.slice(0, 5).map(p => new CriticalPathItem(p));
    return new SectionItem('Critical Paths', 'arrow-right', items);
}

import * as vscode from 'vscode';
import { HLSClient } from './hls-client';
import { TypeAnalyzer } from './type-analyzer';
import { FunctionInfo } from './types';

/**
 * Detects Haskell functions in documents and analyzes them for synthesis
 */
export class FunctionDetector {
    private hlsClient: HLSClient;
    private typeAnalyzer: TypeAnalyzer;
    private outputChannel: vscode.OutputChannel;

    constructor(hlsClient: HLSClient, outputChannel: vscode.OutputChannel) {
        this.hlsClient = hlsClient;
        this.typeAnalyzer = new TypeAnalyzer();
        this.outputChannel = outputChannel;
    }

    /**
     * Detect all functions in a document with full diagnostic logging.
     * Use this for explicit user-triggered commands ("Detect Functions").
     */
    async detectFunctions(document: vscode.TextDocument): Promise<FunctionInfo[]> {
        if (!this.hlsClient.isHaskellDocument(document)) {
            this.outputChannel.appendLine(`Document ${document.fileName} is not a Haskell file`);
            return [];
        }

        this.outputChannel.appendLine(`Detecting functions in ${document.fileName}...`);

        // Verbose fetch: bypasses cache and logs diagnostics.
        const symbols = await this.hlsClient.getDocumentSymbolsVerbose(document);

        if (symbols.length > 0) {
            this.outputChannel.appendLine('Symbols found:');
            for (const symbol of symbols) {
                this.outputChannel.appendLine(
                    `  - ${symbol.name} (kind: ${this.getSymbolKindName(symbol.kind)}, children: ${symbol.children?.length ?? 0})`
                );
                if (symbol.children && symbol.children.length > 0) {
                    for (const child of symbol.children) {
                        this.outputChannel.appendLine(
                            `    └─ ${child.name} (kind: ${this.getSymbolKindName(child.kind)})`
                        );
                    }
                }
            }
        } else {
            this.outputChannel.appendLine('⚠️  No symbols returned. Possible reasons:');
            this.outputChannel.appendLine('   1. HLS is still indexing the file');
            this.outputChannel.appendLine('   2. File has compilation errors');
            this.outputChannel.appendLine('   3. Haskell extension is not active');
            this.outputChannel.appendLine('   Try: Save the file, wait a moment, and run the command again');
        }

        const functions: FunctionInfo[] = [];
        const moduleName = await this.hlsClient.getModuleName(document);

        const extractFunctions = async (syms: vscode.DocumentSymbol[]) => {
            for (const symbol of syms) {
                if (this.isFunction(symbol)) {
                    const functionInfo = await this.analyzeFunctionSymbol(symbol, document, moduleName);
                    if (functionInfo) {
                        functions.push(functionInfo);
                        this.outputChannel.appendLine(
                            `  ✓ Found: ${functionInfo.name} :: ${functionInfo.typeSignature || 'unknown'} ` +
                            `[${functionInfo.isMonomorphic ? 'monomorphic' : 'polymorphic'}]`
                        );
                    }
                }
                if (symbol.children && symbol.children.length > 0) {
                    await extractFunctions(symbol.children);
                }
            }
        };

        await extractFunctions(symbols);
        this.outputChannel.appendLine(`Detected ${functions.length} functions`);
        return functions;
    }

    /**
     * Find the function at a cursor position with minimal HLS interaction.
     *
     * Uses the cached symbol list (1 request, often free) to locate the
     * symbol under the cursor, then fires a single hover request for just
     * that symbol.  This is safe to call from provideCodeActions which runs
     * on every cursor move.
     */
    async getFunctionAtPosition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<FunctionInfo | undefined> {
        // Cached — no HLS round-trip when the document hasn't changed.
        const symbols = await this.hlsClient.getDocumentSymbols(document);

        // Flatten symbols + children into a single list.
        const allSymbols: vscode.DocumentSymbol[] = [];
        const flatten = (syms: vscode.DocumentSymbol[]) => {
            for (const s of syms) {
                allSymbols.push(s);
                if (s.children?.length) { flatten(s.children); }
            }
        };
        flatten(symbols);

        // Find the innermost function symbol whose range contains the cursor.
        const candidates = allSymbols.filter(
            s => this.isFunction(s) && s.range.contains(position)
        );
        if (candidates.length === 0) { return undefined; }

        // Prefer the narrowest range (innermost symbol).
        const symbol = candidates.reduce((best, s) =>
            s.range.start.isAfterOrEqual(best.range.start) &&
            s.range.end.isBeforeOrEqual(best.range.end) ? s : best
        );

        // Single hover request only for this one symbol.
        const hovers = await this.hlsClient.getHoverInfo(document, symbol.range.start);
        const typeSignature = this.hlsClient.extractTypeSignature(hovers);
        const isMonomorphic = typeSignature ? this.typeAnalyzer.isMonomorphic(typeSignature) : false;
        const moduleName = await this.hlsClient.getModuleName(document);

        return {
            name: symbol.name,
            range: symbol.range,
            typeSignature,
            isMonomorphic,
            filePath: document.fileName,
            moduleName
        };
    }

    /**
     * Detect functions in all open Haskell documents
     */
    async detectFunctionsInWorkspace(): Promise<FunctionInfo[]> {
        const allFunctions: FunctionInfo[] = [];

        for (const document of vscode.workspace.textDocuments) {
            if (this.hlsClient.isHaskellDocument(document)) {
                const functions = await this.detectFunctions(document);
                allFunctions.push(...functions);
            }
        }

        return allFunctions;
    }

    /**
     * Show detected functions in a QuickPick UI
     */
    async showFunctionPicker(functions: FunctionInfo[]): Promise<FunctionInfo | undefined> {
        if (functions.length === 0) {
            vscode.window.showInformationMessage('No functions detected. Make sure HLS is running.');
            return undefined;
        }

        // Sort: monomorphic first, then alphabetically
        const sorted = functions.sort((a, b) => {
            if (a.isMonomorphic !== b.isMonomorphic) {
                return a.isMonomorphic ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        interface FunctionQuickPickItem extends vscode.QuickPickItem {
            functionInfo: FunctionInfo;
        }

        const items: FunctionQuickPickItem[] = sorted.map(func => ({
            label: `${func.isMonomorphic ? '$(check)' : '$(x)'} ${func.name}`,
            description: `${func.moduleName || 'Unknown module'} — ${func.isMonomorphic ? 'Synthesizable' : 'Polymorphic'}`,
            detail: func.typeSignature ? `:: ${func.typeSignature}` : 'No type signature',
            functionInfo: func
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a function to synthesize (✓ = monomorphic, ✗ = polymorphic)',
            matchOnDescription: true,
            matchOnDetail: true
        });

        return selected?.functionInfo;
    }

    /**
     * Check if a symbol represents a function
     */
    private isFunction(symbol: vscode.DocumentSymbol): boolean {
        // In Haskell, functions are typically SymbolKind.Function or SymbolKind.Variable
        return symbol.kind === vscode.SymbolKind.Function ||
               symbol.kind === vscode.SymbolKind.Variable ||
               symbol.kind === vscode.SymbolKind.Method;
    }

    /**
     * Analyze a function symbol and extract its information
     */
    private async analyzeFunctionSymbol(
        symbol: vscode.DocumentSymbol,
        document: vscode.TextDocument,
        moduleName: string | null
    ): Promise<FunctionInfo | null> {
        // Get hover information at the symbol's location to extract type
        const position = symbol.range.start;
        const hovers = await this.hlsClient.getHoverInfo(document, position);
        const typeSignature = this.hlsClient.extractTypeSignature(hovers);

        // Analyze if the function is monomorphic
        const isMonomorphic = typeSignature ? 
            this.typeAnalyzer.isMonomorphic(typeSignature) : 
            false;

        return {
            name: symbol.name,
            range: symbol.range,
            typeSignature,
            isMonomorphic,
            filePath: document.fileName,
            moduleName
        };
    }

    /**
     * Filter functions to only synthesizable (monomorphic) ones
     */
    filterSynthesizable(functions: FunctionInfo[]): FunctionInfo[] {
        return functions.filter(f => f.isMonomorphic);
    }

    /**
     * Get detailed analysis of a function
     */
    getAnalysis(func: FunctionInfo): string {
        const lines: string[] = [
            `Function: ${func.name}`,
            `Module: ${func.moduleName || 'Unknown'}`,
            `File: ${func.filePath}`,
            `Type: ${func.typeSignature || 'No type signature'}`,
            ``,
            this.typeAnalyzer.explainMonomorphism(func.typeSignature || '')
        ];

        if (func.isMonomorphic) {
            lines.push('');
            lines.push('This function can be synthesized to hardware using Clash.');
        } else {
            lines.push('');
            lines.push('To synthesize this function, you need to create a monomorphic wrapper');
            lines.push('that instantiates all type variables with concrete types.');
        }

        return lines.join('\n');
    }

    /**
     * Get human-readable symbol kind name
     */
    private getSymbolKindName(kind: vscode.SymbolKind): string {
        const names: { [key: number]: string } = {
            [vscode.SymbolKind.File]: 'File',
            [vscode.SymbolKind.Module]: 'Module',
            [vscode.SymbolKind.Namespace]: 'Namespace',
            [vscode.SymbolKind.Package]: 'Package',
            [vscode.SymbolKind.Class]: 'Class',
            [vscode.SymbolKind.Method]: 'Method',
            [vscode.SymbolKind.Property]: 'Property',
            [vscode.SymbolKind.Field]: 'Field',
            [vscode.SymbolKind.Constructor]: 'Constructor',
            [vscode.SymbolKind.Enum]: 'Enum',
            [vscode.SymbolKind.Interface]: 'Interface',
            [vscode.SymbolKind.Function]: 'Function',
            [vscode.SymbolKind.Variable]: 'Variable',
            [vscode.SymbolKind.Constant]: 'Constant',
            [vscode.SymbolKind.String]: 'String',
            [vscode.SymbolKind.Number]: 'Number',
            [vscode.SymbolKind.Boolean]: 'Boolean',
            [vscode.SymbolKind.Array]: 'Array',
            [vscode.SymbolKind.Object]: 'Object',
            [vscode.SymbolKind.Key]: 'Key',
            [vscode.SymbolKind.Null]: 'Null',
            [vscode.SymbolKind.EnumMember]: 'EnumMember',
            [vscode.SymbolKind.Struct]: 'Struct',
            [vscode.SymbolKind.Event]: 'Event',
            [vscode.SymbolKind.Operator]: 'Operator',
            [vscode.SymbolKind.TypeParameter]: 'TypeParameter',
        };
        return names[kind] || `Unknown(${kind})`;
    }
}

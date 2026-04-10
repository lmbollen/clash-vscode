import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Manager for Haskell Language Server client
 * 
 * This class provides access to HLS functionality without directly
 * managing the language client (which is typically handled by the
 * Haskell extension). We use VS Code's built-in language features
 * that communicate with HLS.
 */
export class HLSClient {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Get all symbols in a document
     * This uses VS Code's document symbol provider which talks to HLS
     */
    async getDocumentSymbols(document: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
        try {
            this.outputChannel.appendLine(`[HLS] Requesting symbols for ${document.fileName}...`);
            
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );
            
            this.outputChannel.appendLine(`[HLS] Received ${symbols?.length ?? 0} symbols`);
            
            if (!symbols || symbols.length === 0) {
                this.outputChannel.appendLine('[HLS] WARNING: No symbols returned. HLS may not be ready or file not indexed.');
                this.outputChannel.appendLine(`[HLS] Document language: ${document.languageId}`);
                this.outputChannel.appendLine(`[HLS] Document URI: ${document.uri.toString()}`);
            }
            
            return symbols || [];
        } catch (error) {
            this.outputChannel.appendLine(`[HLS] Error getting document symbols: ${error}`);
            return [];
        }
    }

    /**
     * Get hover information for a position (includes type signature)
     */
    async getHoverInfo(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover[]> {
        try {
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                document.uri,
                position
            );
            
            return hovers || [];
        } catch (error) {
            this.outputChannel.appendLine(`Error getting hover info: ${error}`);
            return [];
        }
    }

    /**
     * Extract type signature from hover information
     */
    extractTypeSignature(hovers: vscode.Hover[]): string | null {
        for (const hover of hovers) {
            for (const content of hover.contents) {
                if (typeof content === 'string') {
                    const typeMatch = this.parseTypeFromString(content);
                    if (typeMatch) {
                        return typeMatch;
                    }
                } else if ('value' in content) {
                    // MarkdownString
                    const typeMatch = this.parseTypeFromString(content.value);
                    if (typeMatch) {
                        return typeMatch;
                    }
                }
            }
        }
        return null;
    }

    /**
     * Parse type signature from hover text.
     *
     * HLS returns hover info as markdown with fenced code blocks.  Type
     * signatures may span multiple lines, e.g.:
     *
     * ```haskell
     * functionName
     *   :: Clock Dom50
     *   -> Reset Dom50
     *   -> Signal Dom50 (Unsigned 8)
     * ```
     *
     * We collapse multi-line signatures into a single line so callers
     * always see the full type, not just the first argument.
     */
    private parseTypeFromString(text: string): string | null {
        // Extract content from a haskell code fence if present
        const fencePattern = /```haskell\s*\n([\s\S]*?)```/;
        const fenced = text.match(fencePattern);
        const block = fenced ? fenced[1] : text;

        // Look for name :: type (possibly across multiple lines)
        const typePattern = /^([a-zA-Z_][a-zA-Z0-9_']*)\s*::\s*([\s\S]+)/m;
        const match = block.match(typePattern);

        if (match && match[2]) {
            // Collapse newlines + leading whitespace into single spaces
            return match[2].replace(/\n\s*/g, ' ').trim();
        }

        // Fallback: look for :: anywhere
        const simplePattern = /::\s*([\s\S]+?)(?:```|$)/;
        const simpleMatch = text.match(simplePattern);

        if (simpleMatch && simpleMatch[1]) {
            return simpleMatch[1].replace(/\n\s*/g, ' ').trim();
        }

        return null;
    }

    /**
     * Check if a document is a Haskell file
     */
    isHaskellDocument(document: vscode.TextDocument): boolean {
        return document.languageId === 'haskell' || 
               document.fileName.endsWith('.hs');
    }

    /**
     * Get the module name from a document
     */
    async getModuleName(document: vscode.TextDocument): Promise<string | null> {
        const text = document.getText();
        const modulePattern = /^\s*module\s+([A-Z][A-Za-z0-9._]*)/m;
        const match = text.match(modulePattern);
        
        if (match && match[1]) {
            return match[1];
        }
        
        // Fallback: derive from file path
        // e.g., src/Example/Project.hs -> Example.Project
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (workspaceFolder) {
            const relativePath = path.relative(workspaceFolder.uri.fsPath, document.fileName);
            const srcMatch = relativePath.match(/src[\/\\](.+)\.hs$/);
            if (srcMatch && srcMatch[1]) {
                return srcMatch[1].replace(/[\/\\]/g, '.');
            }
        }
        
        return null;
    }

    /**
     * Log to output channel
     */
    log(message: string): void {
        this.outputChannel.appendLine(message);
    }
}

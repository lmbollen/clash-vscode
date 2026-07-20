import * as vscode from 'vscode';

/**
 * Information about a detected Haskell function
 */
export interface FunctionInfo {
    /** Function name */
    name: string;
    
    /** Location in the source file */
    range: vscode.Range;
    
    /** Type signature as a string (e.g., "Signed 8 -> Signed 8 -> Signed 8") */
    typeSignature: string | null;
    
    /** Whether the function is monomorphic (can be synthesized) */
    isMonomorphic: boolean;
    
    /** File path where the function is defined */
    filePath: string;
    
    /** The module this function belongs to */
    moduleName: string | null;
}

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

/**
 * Configuration for Clash synthesis
 */
export interface SynthesisConfig {
    /** Output format (verilog, vhdl, systemverilog) */
    outputFormat: 'verilog' | 'vhdl' | 'systemverilog';
    
    /** Whether to auto-cleanup temporary files */
    autoCleanup: boolean;
}

/**
 * Result of a synthesis operation
 */
export interface SynthesisResult {
    /** Whether synthesis was successful */
    success: boolean;
    
    /** Path to generated HDL file */
    outputPath: string | null;
    
    /** Error messages if any */
    errors: string[];
    
    /** Warnings if any */
    warnings: string[];
    
    /** Full output from Clash */
    output: string;
}

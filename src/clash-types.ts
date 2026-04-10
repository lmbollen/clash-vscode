/**
 * Type definitions for Clash compiler integration
 */

/**
 * Options for Clash compilation
 */
export interface ClashCompileOptions {
	/** Workspace root directory */
	workspaceRoot: string;
	
	/** Output directory for HDL files */
	hdlDir: string;
	
	/** Target HDL (verilog, vhdl, systemverilog) */
	target: 'verilog' | 'vhdl' | 'systemverilog';
	
	/** Additional Clash compiler flags */
	additionalFlags?: string[];
}

/**
 * Result of Clash compilation
 */
export interface ClashCompileResult {
	/** Whether compilation succeeded */
	success: boolean;
	
	/** Path to the top-level generated HDL file */
	topLevelPath?: string;
	
	/** Directory containing all generated HDL files */
	hdlDirectory?: string;
	
	/** Module name that was compiled */
	moduleName: string;
	
	/** Full compilation output */
	output: string;
	
	/** Parsed error messages */
	errors: ClashError[];
	
	/** Parsed warning messages */
	warnings: ClashWarning[];
}

/**
 * Clash compiler error
 */
export interface ClashError {
	/** Error message */
	message: string;
	
	/** Source file (if available) */
	file?: string;
	
	/** Line number (if available) */
	line?: number;
	
	/** Column number (if available) */
	column?: number;
}

/**
 * Clash compiler warning
 */
export interface ClashWarning {
	/** Warning message */
	message: string;
	
	/** Source file (if available) */
	file?: string;
	
	/** Line number (if available) */
	line?: number;
	
	/** Column number (if available) */
	column?: number;
}

/**
 * Type definitions for Yosys synthesis integration
 */

/**
 * Options for Yosys synthesis
 */
export interface YosysOptions {
	/** Workspace root directory */
	workspaceRoot: string;
	
	/** Output directory for synthesis results */
	outputDir: string;
	
	/** Top module name to synthesize */
	topModule: string;
	
	/** Input Verilog file path(s) - can be single file or array for dependencies */
	verilogPath: string | string[];
	
	/** Technology library file (optional) */
	libertyFile?: string;
	
	/** Target FPGA family (optional) */
	targetFamily?: 'ice40' | 'ecp5' | 'xilinx' | 'generic';
}

/**
 * Result of Yosys synthesis
 */
export interface YosysSynthesisResult {
	/** Whether synthesis succeeded */
	success: boolean;
	
	/** Path to synthesized Verilog file */
	synthesizedVerilogPath?: string;
	
	/** Path to JSON output for DigitalJS */
	jsonPath?: string;
	
	/** Synthesis statistics */
	statistics?: SynthesisStatistics;
	
	/** Full synthesis output */
	output: string;
	
	/** Parsed warnings */
	warnings: YosysWarning[];
	
	/** Parsed errors */
	errors: YosysError[];

	/** Per-module results when using parallel OOC synthesis */
	moduleResults?: ModuleSynthesisResult[];
}

/**
 * Result of synthesizing a single module in an OOC parallel flow
 */
export interface ModuleSynthesisResult {
	/** Module name */
	name: string;
	/** Whether synthesis succeeded */
	success: boolean;
	/** Path to synthesized netlist (JSON) */
	netlistPath?: string;
	/** Path to RTLIL (.il) file (per-module mode) */
	rtlilPath?: string;
	/** Path to JSON for DigitalJS visualization (per-module mode) */
	diagramJsonPath?: string;
	/** Synthesis time in milliseconds */
	elapsedMs: number;
	/** Statistics for this module */
	statistics?: SynthesisStatistics;
	/** Errors */
	errors: YosysError[];
}

/**
 * Synthesis statistics extracted from Yosys output
 */
export interface SynthesisStatistics {
	/** Number of cells in design */
	cellCount?: number;
	
	/** Number of wires in design */
	wireCount?: number;
	
	/** Chip area (if available) */
	chipArea?: number;
	
	/** Number of different cell types */
	cellTypes?: Map<string, number>;
	
	/** Raw statistics text */
	rawStats: string;
}

/**
 * Yosys warning message
 */
export interface YosysWarning {
	/** Warning message */
	message: string;
	
	/** Source file (if available) */
	file?: string;
	
	/** Line number (if available) */
	line?: number;
}

/**
 * Yosys error message
 */
export interface YosysError {
	/** Error message */
	message: string;
	
	/** Source file (if available) */
	file?: string;
	
	/** Line number (if available) */
	line?: number;
}

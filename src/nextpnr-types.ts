/**
 * Types for nextpnr place-and-route integration
 */

/**
 * Supported FPGA families for nextpnr
 */
export type NextpnrFamily = 'ecp5' | 'ice40' | 'gowin' | 'nexus' | 'machxo2' | 'generic';

/**
 * ECP5 chip variants
 */
export type ECP5Device = 
	| '25k' | 'um-25k' | 'um5g-25k'  // LFE5U-25F, LFE5UM-25F, LFE5UM5G-25F
	| '45k' | 'um-45k' | 'um5g-45k'  // LFE5U-45F, LFE5UM-45F, LFE5UM5G-45F  
	| '85k' | 'um-85k' | 'um5g-85k'; // LFE5U-85F, LFE5UM-85F, LFE5UM5G-85F

/**
 * ECP5 package types
 */
export type ECP5Package = 
	| 'CABGA256' | 'CABGA381' | 'CABGA554' | 'CABGA756' 
	| 'CSFBGA285' | 'CSFBGA381' | 'CSFBGA554';

/**
 * Speed grades for ECP5
 */
export type ECP5SpeedGrade = '6' | '7' | '8';

/**
 * Options for nextpnr execution
 */
export interface NextpnrOptions {
	/**
	 * FPGA family (ice40, ecp5, etc.)
	 */
	family: NextpnrFamily;

	/**
	 * Input JSON file from Yosys
	 */
	jsonPath: string;

	/**
	 * Output directory for results
	 */
	outputDir: string;

	/**
	 * Top module name
	 */
	topModule: string;

	/**
	 * Device-specific options for ECP5
	 */
	ecp5?: {
		device: ECP5Device;
		package: ECP5Package;
		speedGrade?: ECP5SpeedGrade;
	};

	/**
	 * Constraints file (LPF for ECP5, PCF for iCE40)
	 */
	constraintsFile?: string;

	/**
	 * Target frequency in MHz (for timing analysis)
	 */
	frequency?: number;

	/**
	 * Seed for deterministic placement
	 */
	seed?: number;

	/**
	 * Enable detailed timing report
	 */
	timing?: boolean;

	/**
	 * Additional nextpnr arguments
	 */
	extraArgs?: string[];
}

/**
 * Result from nextpnr place-and-route
 */
export interface NextpnrResult {
	/**
	 * Whether PnR succeeded
	 */
	success: boolean;

	/**
	 * Path to generated textual config (if successful)
	 */
	textcfgPath?: string;

	/**
	 * Path to generated bitstream (if ecppack ran)
	 */
	bitstreamPath?: string;

	/**
	 * Combined stdout/stderr output
	 */
	output: string;

	/**
	 * Timing information
	 */
	timing?: TimingInfo;

	/**
	 * Resource utilization
	 */
	utilization?: UtilizationInfo;

	/**
	 * Warnings from nextpnr
	 */
	warnings: NextpnrWarning[];

	/**
	 * Errors from nextpnr
	 */
	errors: NextpnrError[];
}

/**
 * Timing information from nextpnr
 */
export interface TimingInfo {
	/**
	 * Maximum frequency achieved (MHz) - FINAL value after routing
	 * This is the actual achievable frequency including routing delays
	 */
	maxFrequency?: number;

	/**
	 * Maximum frequency estimate after placement, before routing (MHz)
	 * This is typically higher than maxFrequency as it doesn't include routing delays
	 */
	prePlacementFrequency?: number;

	/**
	 * Critical path delay (ns)
	 */
	criticalPathDelay?: number;

	/**
	 * Whether timing constraints were met
	 */
	constraintsMet: boolean;

	/**
	 * Setup slack (if available)
	 */
	setupSlack?: number;

	/**
	 * Hold slack (if available)
	 */
	holdSlack?: number;
}

/**
 * Resource utilization from nextpnr
 */
export interface UtilizationInfo {
	/**
	 * Logic cells used
	 */
	luts?: { used: number; total: number };

	/**
	 * Registers/flip-flops used
	 */
	registers?: { used: number; total: number };

	/**
	 * Block RAM (EBR) used
	 */
	bram?: { used: number; total: number };

	/**
	 * DSP blocks used
	 */
	dsp?: { used: number; total: number };

	/**
	 * IO pins used
	 */
	io?: { used: number; total: number };
}

/**
 * Warning from nextpnr
 */
export interface NextpnrWarning {
	message: string;
	location?: string;
}

/**
 * Error from nextpnr
 */
export interface NextpnrError {
	message: string;
	location?: string;
}

/**
 * Synthesis target definitions and script template helpers.
 *
 * Each target corresponds to a Yosys `synth_*` command (or generic passes)
 * and carries a default script template with placeholders that are resolved
 * at synthesis time.
 *
 * Placeholders:
 *   {files}          — expands to one `read_verilog <path>` line per input file
 *   {topModule}      — the top-level module name
 *   {outputDir}      — directory for output artefacts
 *   {outputBaseName} — base name for output files (usually === topModule)
 */

/** Describes a Yosys synthesis target. */
export interface SynthesisTarget {
	/** Machine-readable identifier used in settings and cache keys. */
	id: string;
	/** Human-readable label for UI dropdowns. */
	label: string;
	/** The `synth_*` Yosys command, or `null` for generic synthesis. */
	synthCommand: string | null;
	/** Default script template with placeholders. */
	defaultScript: string;
}

// ---------------------------------------------------------------------------
// Default script templates
// ---------------------------------------------------------------------------

function makeTargetScript(synthLine: string): string {
	return `# Read design files
{files}

# Elaborate design
hierarchy -check -top {topModule}

# Synthesize
${synthLine}

# Generate statistics
stat -width
tee -o {outputDir}/synthesis_stats.txt stat

# Write synthesized Verilog
write_verilog -noattr {outputDir}/{outputBaseName}_synth.v

# Prepare design for DigitalJS
delete */t:$specify2 */t:$specify3
opt_clean
clean

# Write JSON for DigitalJS
write_json {outputDir}/{outputBaseName}.json
`;
}

const GENERIC_SCRIPT = `# Read design files
{files}

# Elaborate design
hierarchy -check -top {topModule}

# High-level synthesis
proc
opt
fsm
opt
memory
opt

# Technology mapping (generic)
techmap
opt

# Generate statistics
stat -width
tee -o {outputDir}/synthesis_stats.txt stat

# Write synthesized Verilog
write_verilog -noattr {outputDir}/{outputBaseName}_synth.v

# Prepare design for DigitalJS
delete */t:$specify2 */t:$specify3
opt_clean
clean

# Write JSON for DigitalJS
write_json {outputDir}/{outputBaseName}.json
`;

// ---------------------------------------------------------------------------
// Target registry
// ---------------------------------------------------------------------------

const targetList: SynthesisTarget[] = [
	{
		id: 'generic',
		label: 'Generic (technology-independent)',
		synthCommand: null,
		defaultScript: GENERIC_SCRIPT,
	},
	{
		id: 'ice40',
		label: 'Lattice iCE40',
		synthCommand: 'synth_ice40',
		defaultScript: makeTargetScript('synth_ice40 -top {topModule}'),
	},
	{
		id: 'ecp5',
		label: 'Lattice ECP5',
		synthCommand: 'synth_ecp5',
		defaultScript: makeTargetScript('synth_ecp5 -top {topModule}'),
	},
	{
		id: 'xilinx',
		label: 'AMD / Xilinx 7-series',
		synthCommand: 'synth_xilinx',
		defaultScript: makeTargetScript('synth_xilinx -top {topModule}'),
	},
	{
		id: 'gowin',
		label: 'Gowin',
		synthCommand: 'synth_gowin',
		defaultScript: makeTargetScript('synth_gowin -top {topModule}'),
	},
	{
		id: 'intel',
		label: 'Intel / Altera',
		synthCommand: 'synth_intel',
		defaultScript: makeTargetScript('synth_intel -top {topModule}'),
	},
	{
		id: 'quicklogic',
		label: 'QuickLogic',
		synthCommand: 'synth_quicklogic',
		defaultScript: makeTargetScript('synth_quicklogic -top {topModule}'),
	},
	{
		id: 'sf2',
		label: 'Microsemi SmartFusion2',
		synthCommand: 'synth_sf2',
		defaultScript: makeTargetScript('synth_sf2 -top {topModule}'),
	},
];

/** All available synthesis targets, keyed by id. */
export const SYNTHESIS_TARGETS: ReadonlyMap<string, SynthesisTarget> =
	new Map(targetList.map(t => [t.id, t]));

/** Ordered list of target ids (for dropdowns). */
export const TARGET_IDS: readonly string[] = targetList.map(t => t.id);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the default script template for the given target id. */
export function getDefaultScript(targetId: string): string {
	return SYNTHESIS_TARGETS.get(targetId)?.defaultScript ?? GENERIC_SCRIPT;
}

/** Return the SynthesisTarget for the given id, falling back to generic. */
export function getTarget(targetId: string): SynthesisTarget {
	return SYNTHESIS_TARGETS.get(targetId) ?? SYNTHESIS_TARGETS.get('generic')!;
}

/**
 * Replace placeholders in a script template with concrete values.
 *
 * `vars.files` should be an array of absolute Verilog paths — each is
 * expanded to a `read_verilog <path>` line.
 */
export function resolveScript(
	template: string,
	vars: {
		files: string[];
		topModule: string;
		outputDir: string;
		outputBaseName: string;
	}
): string {
	const filesBlock = vars.files.map(f => `read_verilog ${f}`).join('\n');
	return template
		.replace(/\{files\}/g, filesBlock)
		.replace(/\{topModule\}/g, vars.topModule)
		.replace(/\{outputDir\}/g, vars.outputDir)
		.replace(/\{outputBaseName\}/g, vars.outputBaseName);
}

// ---------------------------------------------------------------------------
// Diff computation for the webview
// ---------------------------------------------------------------------------

export type DiffLineKind = 'equal' | 'added' | 'removed';

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
}

/**
 * Compute a simple line-by-line diff between two scripts.
 *
 * Uses a basic LCS (longest common subsequence) approach which is good
 * enough for the short scripts we deal with (10-40 lines).
 */
export function computeScriptDiff(defaultScript: string, userScript: string): DiffLine[] {
	const a = defaultScript.split('\n');
	const b = userScript.split('\n');

	// Build LCS table
	const m = a.length;
	const n = b.length;
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] = a[i - 1] === b[j - 1]
				? dp[i - 1][j - 1] + 1
				: Math.max(dp[i - 1][j], dp[i][j - 1]);
		}
	}

	// Back-track to produce diff lines
	const result: DiffLine[] = [];
	let i = m;
	let j = n;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
			result.push({ kind: 'equal', text: a[i - 1] });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			result.push({ kind: 'added', text: b[j - 1] });
			j--;
		} else {
			result.push({ kind: 'removed', text: a[i - 1] });
			i--;
		}
	}
	result.reverse();
	return result;
}

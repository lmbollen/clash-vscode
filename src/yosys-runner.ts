import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import { promises as fs } from 'fs';
import {
	YosysOptions,
	YosysSynthesisResult,
	SynthesisStatistics,
	ModuleSynthesisResult,
	YosysWarning,
	YosysError
} from './yosys-types';
import { ComponentInfo } from './clash-manifest-types';
import { getLogger } from './file-logger';
import { getTarget, getDefaultScript, resolveScript } from './synthesis-targets';

/**
 * Handles Yosys synthesis from Verilog
 */
export class YosysRunner {
	constructor(private outputChannel: vscode.OutputChannel) {}

	/**
	 * Synthesize Verilog using Yosys
	 */
	async synthesize(options: YosysOptions): Promise<YosysSynthesisResult> {
		this.outputChannel.appendLine('');
		this.outputChannel.appendLine('='.repeat(60));
		this.outputChannel.appendLine('Yosys Synthesis');
		this.outputChannel.appendLine('='.repeat(60));
		
		// Log input files
		if (Array.isArray(options.verilogPath)) {
			this.outputChannel.appendLine(`Input: ${options.verilogPath.length} Verilog file(s)`);
			options.verilogPath.forEach(f => {
				this.outputChannel.appendLine(`  - ${path.basename(f)}`);
			});
		} else {
			this.outputChannel.appendLine(`Input: ${options.verilogPath}`);
		}
		
		this.outputChannel.appendLine(`Top Module: ${options.topModule}`);
		this.outputChannel.appendLine('');

		// Create output directory
		await fs.mkdir(options.outputDir, { recursive: true });

		// Generate Yosys script
		const scriptPath = await this.generateScript(options);
		this.outputChannel.appendLine(`Generated script: ${scriptPath}`);
		this.outputChannel.appendLine('');

		return new Promise((resolve) => {
			const logger = getLogger();
			const finishLog = logger?.command('yosys', ['-s', scriptPath], options.workspaceRoot);
			const yosys = spawn('yosys', ['-s', scriptPath], {
				cwd: options.workspaceRoot,
				env: process.env
			});

			let stdout = '';
			let stderr = '';
			const warnings: YosysWarning[] = [];
			const errors: YosysError[] = [];

			yosys.stdout.on('data', (data) => {
				const text = data.toString();
				stdout += text;
				this.outputChannel.append(text);

				// Parse warnings in real-time
				const warningMatch = text.match(/warning:/i);
				if (warningMatch) {
					warnings.push({ message: text.trim() });
				}
			});

			yosys.stderr.on('data', (data) => {
				const text = data.toString();
				stderr += text;
				this.outputChannel.append(text);

				// Parse errors in real-time
				if (text.toLowerCase().includes('error')) {
					errors.push({ message: text.trim() });
				}
			});

			yosys.on('error', (error) => {
				this.outputChannel.appendLine(`\nERROR: Failed to spawn yosys: ${error.message}`);
				this.outputChannel.appendLine('Make sure Yosys is installed and in your PATH');
				resolve({
					success: false,
					output: stdout + stderr,
					warnings,
					errors: [{ message: error.message }]
				});
			});

			yosys.on('close', async (code) => {
				finishLog?.then(fn => fn(code));
				this.outputChannel.appendLine('');
				this.outputChannel.appendLine(`Yosys exited with code ${code}`);

				// Save complete log to file
				const logPath = path.join(options.outputDir, 'yosys.log');
				const fullOutput = stdout + stderr;
				try {
					await fs.writeFile(logPath, fullOutput, 'utf8');
					this.outputChannel.appendLine(`Log saved: ${logPath}`);
				} catch (err) {
					this.outputChannel.appendLine(`Warning: Could not save log file: ${err}`);
				}

				if (code === 0) {
					this.outputChannel.appendLine('✓ Synthesis successful');

					// Parse statistics
					const stats = YosysRunner.parseStatisticsOutput(stdout);

					// Save statistics report
					try {
						const statsReport = this.formatStatisticsReport(stats);
						const statsPath = path.join(options.outputDir, 'statistics.txt');
						await fs.writeFile(statsPath, statsReport, 'utf8');
						this.outputChannel.appendLine(`Statistics report saved: ${statsPath}`);
					} catch (err) {
						this.outputChannel.appendLine(`Warning: Could not save statistics report: ${err}`);
					}

					// Check for output files
					const synthesizedPath = path.join(
						options.outputDir,
						`${options.topModule}_synth.v`
					);
					const jsonPath = path.join(options.outputDir, `${options.topModule}.json`);

					resolve({
						success: true,
						synthesizedVerilogPath: synthesizedPath,
						jsonPath,
						statistics: stats,
						output: fullOutput,
						warnings,
						errors: []
					});
				} else {
					this.outputChannel.appendLine(`✗ Synthesis failed with code ${code}`);
					resolve({
						success: false,
						output: fullOutput,
						warnings,
						errors: errors.length > 0 ? errors : [{ message: 'Synthesis failed' }]
					});
				}
			});
		});
	}

	/**
	 * Get the Yosys synthesis command for a given FPGA family.
	 * Returns the `synth_*` command string, or null for generic synthesis.
	 */
	static getSynthCommand(targetFamily: string, topModule: string): string | null {
		const target = getTarget(targetFamily);
		if (target.synthCommand) {
			return `${target.synthCommand} -top ${topModule}`;
		}
		return null; // generic synthesis (no single command)
	}

	/**
	 * Generate Yosys synthesis script.
	 *
	 * Uses the template system from synthesis-targets.ts.  If the user has
	 * provided a custom script via `options.customScript`, it is used as the
	 * template; otherwise the built-in default for the selected target is used.
	 */
	private async generateScript(options: YosysOptions): Promise<string> {
		const outputBaseName = path.basename(options.topModule);

		// Determine which Verilog files to use
		let verilogFiles: string[];
		if (Array.isArray(options.verilogPath)) {
			verilogFiles = options.verilogPath;
			this.outputChannel.appendLine(`Using ${verilogFiles.length} Verilog files from manifest (includes dependencies, deduplicated)`);
		} else {
			const verilogDir = path.dirname(options.verilogPath);
			const allFiles = await fs.readdir(verilogDir);
			verilogFiles = allFiles
				.filter(f => f.endsWith('.v') && !f.includes('_shim'))
				.map(f => path.join(verilogDir, f));
			this.outputChannel.appendLine(`Scanning directory: found ${verilogFiles.length} Verilog files`);
		}

		// Select the script template
		const template = options.customScript || getDefaultScript(options.targetFamily || 'generic');

		// Resolve placeholders
		const script = resolveScript(template, {
			files: verilogFiles,
			topModule: options.topModule,
			outputDir: options.outputDir,
			outputBaseName,
		});

		// Write script to file
		const scriptPath = path.join(options.outputDir, 'synth.ys');
		await fs.writeFile(scriptPath, script);

		return scriptPath;
	}

	/**
	 * Parse synthesis statistics from Yosys output
	 */
	static parseStatisticsOutput(output: string): SynthesisStatistics {
		const stats: SynthesisStatistics = {
			rawStats: ''
		};

		// Extract statistics section
		const statsMatch = output.match(/=== .+ ===([\s\S]+?)(?:===|$)/);
		if (statsMatch) {
			stats.rawStats = statsMatch[1].trim();
		}

		// Parse number of cells
		const cellMatch = output.match(/Number of cells:\s+(\d+)/);
		if (cellMatch) {
			stats.cellCount = parseInt(cellMatch[1], 10);
		}

		// Parse number of wires
		const wireMatch = output.match(/Number of wires:\s+(\d+)/);
		if (wireMatch) {
			stats.wireCount = parseInt(wireMatch[1], 10);
		}

		// Parse chip area
		const areaMatch = output.match(/Chip area.*?:\s+([\d.]+)/);
		if (areaMatch) {
			stats.chipArea = parseFloat(areaMatch[1]);
		}

		// Parse cell types — capture both $-prefixed internal cells (e.g. "$dffe")
		// and plain-name FPGA primitives (e.g. "LUT4", "TRELLIS_FF") that appear
		// as indented lines after "Number of cells:" in yosys stat output.
		const cellTypes = new Map<string, number>();
		const cellTypeRegex = /^ {4,}(\$?\w+)\s+(\d+)\s*$/gm;
		let match;
		while ((match = cellTypeRegex.exec(output)) !== null) {
			cellTypes.set(match[1], parseInt(match[2], 10));
		}
		if (cellTypes.size > 0) {
			stats.cellTypes = cellTypes;
		}

		return stats;
	}

	/**
	 * Format synthesis statistics for report file
	 */
	private formatStatisticsReport(stats: SynthesisStatistics): string {
		let report = 'Yosys Synthesis Statistics Report\n';
		report += '='.repeat(60) + '\n';
		report += `Generated: ${new Date().toISOString()}\n\n`;

		if (stats.cellCount !== undefined) {
			report += `Number of Cells:    ${stats.cellCount}\n`;
		}

		if (stats.wireCount !== undefined) {
			report += `Number of Wires:    ${stats.wireCount}\n`;
		}

		if (stats.chipArea !== undefined) {
			report += `Chip Area:          ${stats.chipArea}\n`;
		}

		if (stats.cellTypes && stats.cellTypes.size > 0) {
			report += '\nCell Types:\n';
			report += '-'.repeat(40) + '\n';
			const sortedTypes = Array.from(stats.cellTypes.entries())
				.sort((a, b) => b[1] - a[1]); // Sort by count descending
			for (const [type, count] of sortedTypes) {
				report += `  $${type.padEnd(25)} ${count.toString().padStart(6)}\n`;
			}
		}

		if (stats.rawStats) {
			report += '\nRaw Statistics:\n';
			report += '-'.repeat(60) + '\n';
			report += stats.rawStats + '\n';
		}

		return report;
	}

	// ---------------------------------------------------------------
	// Parallel out-of-context (OOC) synthesis
	// ---------------------------------------------------------------

	/**
	 * Synthesize a multi-module Clash design using parallel out-of-context
	 * synthesis. Each component in the dependency graph is synthesized
	 * independently, with independent components running in parallel.
	 *
	 * Falls back to regular `synthesize()` for single-component designs.
	 */
	async synthesizeParallel(
		components: ComponentInfo[],
		options: YosysOptions
	): Promise<YosysSynthesisResult> {
		if (components.length <= 1) {
			return this.synthesize(options);
		}

		this.outputChannel.appendLine('');
		this.outputChannel.appendLine('='.repeat(60));
		this.outputChannel.appendLine('Parallel OOC Synthesis');
		this.outputChannel.appendLine(`${components.length} components detected`);
		this.outputChannel.appendLine('='.repeat(60));

		const waves = YosysRunner.buildSynthesisWaves(components);

		this.outputChannel.appendLine(`Planned ${waves.length} synthesis wave(s):`);
		for (let i = 0; i < waves.length; i++) {
			this.outputChannel.appendLine(
				`  Wave ${i + 1}: ${waves[i].map(c => c.name).join(', ')}`
			);
		}

		const moduleResults: ModuleSynthesisResult[] = [];
		const netlistPaths = new Map<string, string>();
		const oocDir = path.join(options.outputDir, 'ooc');
		await fs.mkdir(oocDir, { recursive: true });

		for (let i = 0; i < waves.length; i++) {
			const wave = waves[i];
			const isTopWave = i === waves.length - 1;

			this.outputChannel.appendLine('');
			this.outputChannel.appendLine(
				`--- Wave ${i + 1}/${waves.length}: ${wave.map(c => c.name).join(', ')} ---`
			);

			if (isTopWave && wave.length === 1) {
				// Top module: synthesize with pre-synthesized deps & full output
				const topComponent = wave[0];
				const depNetlists = topComponent.dependencies
					.map(d => netlistPaths.get(d))
					.filter((p): p is string => !!p);

				const topResult = await this.synthesizeTopOOC(
					topComponent, depNetlists, options
				);
				moduleResults.push(topResult.moduleResult);

				return {
					...topResult.synthesisResult,
					moduleResults
				};
			}

			// Synthesize all modules in this wave in parallel.
			// Use an AbortController so that if any module fails, the
			// remaining sibling processes are killed immediately instead
			// of making the user wait for long-running syntheses.
			const waveAbort = new AbortController();
			const wavePromises = wave.map(async (component) => {
				const moduleDir = path.join(oocDir, component.name);
				await fs.mkdir(moduleDir, { recursive: true });

				const depNetlists = component.dependencies
					.map(d => netlistPaths.get(d))
					.filter((p): p is string => !!p);

				const result = await this.synthesizeModuleOOC(
					component, depNetlists, moduleDir, options, waveAbort.signal
				);
				if (!result.success) {
					waveAbort.abort();
				}
				return result;
			});

			const waveResults = await Promise.all(wavePromises);

			for (const result of waveResults) {
				moduleResults.push(result);
				if (result.success && result.netlistPath) {
					netlistPaths.set(result.name, result.netlistPath);
				}
			}

			const failures = waveResults.filter(r => !r.success);
			if (failures.length > 0) {
				this.outputChannel.appendLine(
					`✗ ${failures.length} module(s) failed in wave ${i + 1}`
				);
				return {
					success: false,
					output: '',
					warnings: [],
					errors: failures.flatMap(f => f.errors),
					moduleResults
				};
			}
		}

		return {
			success: false,
			output: '',
			warnings: [],
			errors: [{ message: 'Internal error: no top module synthesized' }],
			moduleResults
		};
	}

	/**
	 * Per-module synthesis: each component gets its own .il (RTLIL) and
	 * .json (DigitalJS) output, allowing individual circuit diagrams.
	 *
	 * Falls back to regular `synthesize()` for single-component designs.
	 */
	async synthesizePerModule(
		components: ComponentInfo[],
		options: YosysOptions
	): Promise<YosysSynthesisResult> {
		if (components.length <= 1) {
			return this.synthesize(options);
		}

		this.outputChannel.appendLine('');
		this.outputChannel.appendLine('='.repeat(60));
		this.outputChannel.appendLine('Per-Module Synthesis');
		this.outputChannel.appendLine(`${components.length} components detected`);
		this.outputChannel.appendLine('='.repeat(60));

		const moduleResults: ModuleSynthesisResult[] = [];
		const perModuleDir = path.join(options.outputDir, 'per-module');
		await fs.mkdir(perModuleDir, { recursive: true });

		// Build lookup so we can resolve transitive dependency Verilog files
		const byName = new Map(components.map(c => [c.name, c]));
		const collectDepVerilog = (name: string, visited: Set<string> = new Set()): string[] => {
			if (visited.has(name)) { return []; }
			visited.add(name);
			const comp = byName.get(name);
			if (!comp) { return []; }
			const files: string[] = [];
			for (const dep of comp.dependencies) {
				files.push(...collectDepVerilog(dep, visited));
			}
			files.push(...comp.verilogFiles);
			return files;
		};

		for (const component of components) {
			const moduleDir = path.join(perModuleDir, component.name);
			await fs.mkdir(moduleDir, { recursive: true });

			const startTime = Date.now();
			this.outputChannel.appendLine(`  Synthesizing ${component.name}...`);

			const ilPath = path.join(moduleDir, `${component.name}.il`);
			const jsonPath = path.join(moduleDir, `${component.name}.json`);
			const scriptPath = path.join(moduleDir, 'synth.ys');

			let script = `# Per-Module Synthesis: ${component.name}\n\n`;

			// Read dependency Verilog so hierarchy -check can resolve references
			const depVerilog = new Set<string>();
			for (const dep of component.dependencies) {
				for (const f of collectDepVerilog(dep)) {
					depVerilog.add(f);
				}
			}
			for (const vFile of depVerilog) {
				script += `read_verilog ${vFile}\n`;
			}

			// Read this component's own Verilog
			for (const vFile of component.verilogFiles) {
				script += `read_verilog ${vFile}\n`;
			}

			script += `\nhierarchy -check -top ${component.name}\n\n`;

			// Use the same safe pass sequence as OOC synthesis: explicit
			// passes that convert processes and collect memories as $mem
			// cells without expanding them to FF arrays.  Full `synth` hangs
			// indefinitely on modules containing large block RAMs (e.g.
			// blockRamU 16 384 entries) because memory_map + abc cannot
			// finish on the resulting ~500 k flip-flop circuit.
			script += `proc\nflatten\nopt -purge\nmemory -nomap\nopt\n\n`;

			script += `stat -width\n\n`;
			script += `# Write RTLIL\nwrite_rtlil ${ilPath}\n\n`;
			script += `# Prepare for DigitalJS\ndelete */t:$specify2 */t:$specify3\nopt_clean\nclean\n`;
			script += `write_json ${jsonPath}\n`;

			await fs.writeFile(scriptPath, script);

			const run = await this.runYosysScript(scriptPath, options.workspaceRoot, false);
			const elapsed = Date.now() - startTime;

			try {
				await fs.writeFile(path.join(moduleDir, 'yosys.log'), run.stdout + run.stderr);
			} catch { /* ignore */ }

			if (run.code === 0) {
				this.outputChannel.appendLine(`  ✓ ${component.name} (${elapsed}ms)`);
				moduleResults.push({
					name: component.name,
					success: true,
					netlistPath: jsonPath,
					rtlilPath: ilPath,
					diagramJsonPath: jsonPath,
					verilogFiles: component.verilogFiles,
					elapsedMs: elapsed,
					statistics: YosysRunner.parseStatisticsOutput(run.stdout),
					errors: []
				});
			} else {
				this.outputChannel.appendLine(`  ✗ ${component.name} failed (${elapsed}ms)`);
				moduleResults.push({
					name: component.name,
					success: false,
					elapsedMs: elapsed,
					errors: run.errors.length > 0
						? run.errors
						: [{ message: `Synthesis of ${component.name} failed with code ${run.code}` }]
				});
			}
		}

		const failures = moduleResults.filter(r => !r.success);
		if (failures.length > 0) {
			return {
				success: false,
				output: '',
				warnings: [],
				errors: failures.flatMap(f => f.errors),
				moduleResults
			};
		}

		// Also produce a combined whole-design result for statistics
		const topResult = moduleResults[moduleResults.length - 1];
		return {
			success: true,
			jsonPath: topResult.netlistPath,
			statistics: topResult.statistics,
			output: '',
			warnings: [],
			errors: [],
			moduleResults
		};
	}

	/**
	 * Group components into waves of mutually-independent modules
	 * that can be synthesized in parallel.
	 */
	static buildSynthesisWaves(components: ComponentInfo[]): ComponentInfo[][] {
		const waves: ComponentInfo[][] = [];
		const completed = new Set<string>();
		const remaining = [...components];

		while (remaining.length > 0) {
			const wave: ComponentInfo[] = [];

			for (let i = remaining.length - 1; i >= 0; i--) {
				if (remaining[i].dependencies.every(d => completed.has(d))) {
					wave.push(remaining[i]);
					remaining.splice(i, 1);
				}
			}

			if (wave.length === 0) {
				// Circular dependency — add all remaining to break the cycle
				wave.push(...remaining.splice(0));
			}

			for (const c of wave) {
				completed.add(c.name);
			}
			waves.push(wave);
		}

		return waves;
	}

	/**
	 * Synthesize a single sub-module out of context.
	 */
	private async synthesizeModuleOOC(
		component: ComponentInfo,
		depNetlists: string[],
		moduleDir: string,
		options: YosysOptions,
		abortSignal?: AbortSignal
	): Promise<ModuleSynthesisResult> {
		const startTime = Date.now();
		this.outputChannel.appendLine(`  Synthesizing ${component.name}...`);

		const netlistPath = path.join(moduleDir, `${component.name}.json`);
		const diagramJsonPath = path.join(moduleDir, `${component.name}_diagram.json`);
		const script = this.generateOOCScript(
			component, depNetlists, netlistPath, diagramJsonPath, options
		);
		const scriptPath = path.join(moduleDir, 'synth.ys');
		await fs.writeFile(scriptPath, script);

		const run = await this.runYosysScript(scriptPath, options.workspaceRoot, false, abortSignal);
		const elapsed = Date.now() - startTime;

		try {
			await fs.writeFile(path.join(moduleDir, 'yosys.log'), run.stdout + run.stderr);
		} catch { /* ignore */ }

		if (run.code === 0) {
			this.outputChannel.appendLine(`  ✓ ${component.name} (${elapsed}ms)`);
			return {
				name: component.name,
				success: true,
				netlistPath,
				diagramJsonPath,
				verilogFiles: component.verilogFiles,
				elapsedMs: elapsed,
				statistics: YosysRunner.parseStatisticsOutput(run.stdout),
				errors: []
			};
		} else {
			this.outputChannel.appendLine(`  ✗ ${component.name} failed (${elapsed}ms)`);
			return {
				name: component.name,
				success: false,
				elapsedMs: elapsed,
				errors: run.errors.length > 0
					? run.errors
					: [{ message: `Synthesis failed with code ${run.code}` }]
			};
		}
	}

	/**
	 * Synthesize the top module, reading pre-synthesized dependency netlists,
	 * and producing full output (synthesized Verilog, JSON, statistics).
	 */
	private async synthesizeTopOOC(
		topComponent: ComponentInfo,
		depNetlists: string[],
		options: YosysOptions
	): Promise<{
		moduleResult: ModuleSynthesisResult;
		synthesisResult: YosysSynthesisResult;
	}> {
		const startTime = Date.now();
		this.outputChannel.appendLine(
			`  Synthesizing top module ${topComponent.name} with ` +
			`${depNetlists.length} pre-synthesized dep(s)...`
		);

		const outputBaseName = topComponent.name;
		const synthesizedVerilog = path.join(
			options.outputDir, `${outputBaseName}_synth.v`
		);
		const jsonPath = path.join(options.outputDir, `${outputBaseName}.json`);
		const diagramJsonPath = path.join(options.outputDir, `${outputBaseName}_diagram.json`);
		const statsFile = path.join(options.outputDir, 'synthesis_stats.txt');

		let script = `# Top Module OOC Synthesis: ${topComponent.name}\n\n`;

		// Read pre-synthesized dependency netlists
		for (const netlist of depNetlists) {
			script += `read_json ${netlist}\n`;
		}

		// Read top module Verilog
		for (const vFile of topComponent.verilogFiles) {
			script += `read_verilog ${vFile}\n`;
		}

		script += `\nhierarchy -check -top ${topComponent.name}\n\n`;

		// Target-specific synthesis
		const synthCmd = YosysRunner.getSynthCommand(
			options.targetFamily || 'generic', topComponent.name
		);
		if (synthCmd) {
			script += `${synthCmd}\n\n`;
		} else {
			script += `proc\nopt\nfsm\nopt\nmemory\nopt\ntechmap\nopt\n\n`;
		}

		// Statistics
		script += `stat -width\n`;
		if (options.libertyFile) {
			script += `stat -liberty ${options.libertyFile}\n`;
		}
		script += `tee -o ${statsFile} stat\n\n`;

		// Outputs
		script += `write_verilog -noattr ${synthesizedVerilog}\n\n`;
		// PnR netlist — keep as-is (includes FPGA-mapped cells for nextpnr).
		script += `write_json ${jsonPath}\n\n`;
		// Diagram JSON — strip timing/specify cells so DigitalJS can render it.
		script += `delete */t:$specify2 */t:$specify3 */t:$specp\nopt_clean\nclean\n`;
		script += `write_json ${diagramJsonPath}\n`;

		const scriptPath = path.join(options.outputDir, 'synth_top.ys');
		await fs.writeFile(scriptPath, script);

		const run = await this.runYosysScript(
			scriptPath, options.workspaceRoot, true
		);
		const elapsed = Date.now() - startTime;

		const fullOutput = run.stdout + run.stderr;
		const logPath = path.join(options.outputDir, 'yosys.log');
		try { await fs.writeFile(logPath, fullOutput); } catch { /* ignore */ }

		if (run.code === 0) {
			this.outputChannel.appendLine(`  ✓ Top module ${topComponent.name} (${elapsed}ms)`);
			const stats = YosysRunner.parseStatisticsOutput(run.stdout);

			try {
				const statsReport = this.formatStatisticsReport(stats);
				await fs.writeFile(
					path.join(options.outputDir, 'statistics.txt'), statsReport
				);
			} catch { /* ignore */ }

			return {
				moduleResult: {
					name: topComponent.name,
					success: true,
					netlistPath: jsonPath,
					diagramJsonPath,
					verilogFiles: topComponent.verilogFiles,
					elapsedMs: elapsed,
					statistics: stats,
					errors: []
				},
				synthesisResult: {
					success: true,
					synthesizedVerilogPath: synthesizedVerilog,
					jsonPath,
					statistics: stats,
					output: fullOutput,
					warnings: run.warnings,
					errors: []
				}
			};
		} else {
			this.outputChannel.appendLine(`  ✗ Top module ${topComponent.name} failed (${elapsed}ms)`);
			const errors = run.errors.length > 0
				? run.errors
				: [{ message: 'Synthesis failed' }];
			return {
				moduleResult: {
					name: topComponent.name,
					success: false,
					elapsedMs: elapsed,
					errors
				},
				synthesisResult: {
					success: false,
					output: fullOutput,
					warnings: run.warnings,
					errors
				}
			};
		}
	}

	/**
	 * Generate a Yosys script for out-of-context synthesis of one module.
	 *
	 * Runs only `proc`, `flatten`, `opt`, and `memory -nomap` — deliberately
	 * omitting `memory_map` and `abc`.
	 *
	 * `memory_map` converts `$mem` cells to flat flip-flop arrays.  For large
	 * RAMs (e.g. 16 384-entry arrays from Clash's `blockRamU`) this produces
	 * hundreds of thousands of FFs, after which `abc` hangs indefinitely
	 * trying to optimise the resulting mux trees.
	 *
	 * Keeping memories as abstract `$mem` cells in the JSON netlist lets the
	 * top-level FPGA synthesis command (e.g. `synth_ecp5`) infer proper BRAMs,
	 * which is both faster and more area-efficient than FF expansion.
	 */
	private generateOOCScript(
		component: ComponentInfo,
		depNetlists: string[],
		netlistPath: string,
		diagramJsonPath: string,
		_options: YosysOptions
	): string {
		let script = `# OOC Synthesis: ${component.name}\n\n`;

		for (const netlist of depNetlists) {
			script += `read_json ${netlist}\n`;
		}
		for (const vFile of component.verilogFiles) {
			script += `read_verilog ${vFile}\n`;
		}

		script += `\nhierarchy -check -top ${component.name}\n\n`;

		// Run only the passes needed to produce a valid JSON netlist without
		// expanding memories or running ABC optimisation.  We do NOT use
		// `synth -run begin:coarse` because Yosys's label semantics mean
		// proc ends up not running, leaving RTLIL::Process objects that
		// write_json refuses.  Instead we call each pass explicitly:
		//
		//  proc          – convert always-blocks to netlist cells (required
		//                  before write_json can succeed)
		//  flatten       – inline submodule hierarchy so the JSON is self-
		//                  contained
		//  opt -purge    – remove dead logic
		//  memory -nomap – collect memory reads/writes into $mem cells but
		//                  do NOT map to flip-flops (memory_map hangs
		//                  indefinitely on large RAMs like blockRamU 16 384)
		//  opt           – final cleanup
		//
		// The $mem cells are handled correctly by the top-level FPGA synthesis
		// command (synth_ecp5, synth_ice40, etc.) which maps them to BRAMs.
		// FPGA-specific cell definitions must not appear in intermediate JSON
		// netlists that are re-imported by the parent synthesis pass.
		script += `proc\nflatten\nopt -purge\nmemory -nomap\nopt\n\n`;

		// Statistics (at $mem / pre-technology-map level)
		script += `stat -width\n\n`;

		// Write the synthesis-chain netlist (used by the top-level synthesis)
		script += `write_json ${netlistPath}\n\n`;

		// Prepare a cleaned-up copy for DigitalJS visualisation.
		// $specify cells are not understood by DigitalJS; remove them first.
		script += `# Prepare for DigitalJS\n`;
		script += `delete */t:$specify2 */t:$specify3\n`;
		script += `opt_clean\n`;
		script += `clean\n`;
		script += `write_json ${diagramJsonPath}\n`;

		return script;
	}

	/**
	 * Run a Yosys script and collect output.
	 *
	 * @param timeoutMs - Optional wall-clock timeout in milliseconds.  If
	 *   Yosys does not exit within this time the process is killed and the
	 *   call resolves with code === null and a descriptive error message.
	 *   Defaults to 600 000 ms (10 minutes) as a safety net against hangs
	 *   caused by abc running on unexpectedly large circuits.
	 */
	private runYosysScript(
		scriptPath: string,
		cwd: string,
		verbose: boolean,
		abortSignal?: AbortSignal,
		timeoutMs = 600_000
	): Promise<{
		code: number | null;
		stdout: string;
		stderr: string;
		warnings: YosysWarning[];
		errors: YosysError[];
	}> {
		return new Promise((resolve) => {
			const logger = getLogger();
			const finishLog = logger?.command('yosys', ['-s', scriptPath], cwd);
			const yosys = spawn('yosys', ['-s', scriptPath], {
				cwd,
				env: process.env
			});

			let stdout = '';
			let stderr = '';
			let resolved = false;
			const warnings: YosysWarning[] = [];
			const errors: YosysError[] = [];

			// Declare timer handle early so finish() can clear it regardless
			// of declaration order (all calls to finish() are async).
			let timeoutHandle: ReturnType<typeof setTimeout>;

			// If an abort signal fires, kill the child process.
			const onAbort = () => { yosys.kill('SIGTERM'); };

			const finish = (code: number | null, extraErrors: YosysError[] = []) => {
				if (resolved) { return; }
				resolved = true;
				clearTimeout(timeoutHandle);
				abortSignal?.removeEventListener('abort', onAbort);
				finishLog?.then(fn => fn(code));
				resolve({
					code,
					stdout,
					stderr,
					warnings,
					errors: [...errors, ...extraErrors]
				});
			};

			// Wall-clock timeout — kill the process if it runs too long.
			timeoutHandle = setTimeout(() => {
				const msg = `Yosys timed out after ${timeoutMs / 1000}s — killing process`;
				this.outputChannel.appendLine(`\nWARNING: ${msg}`);
				yosys.kill('SIGTERM');
				finish(null, [{ message: msg }]);
			}, timeoutMs);

			if (abortSignal) {
				if (abortSignal.aborted) {
					yosys.kill('SIGTERM');
				} else {
					abortSignal.addEventListener('abort', onAbort, { once: true });
				}
			}

			yosys.stdout.on('data', (data) => {
				const text = data.toString();
				stdout += text;
				if (verbose) { this.outputChannel.append(text); }
				if (/warning:/i.test(text)) {
					warnings.push({ message: text.trim() });
				}
			});

			yosys.stderr.on('data', (data) => {
				const text = data.toString();
				stderr += text;
				if (verbose) { this.outputChannel.append(text); }
				if (text.toLowerCase().includes('error')) {
					errors.push({ message: text.trim() });
				}
			});

			yosys.on('error', (error) => {
				finish(null, [{ message: error.message }]);
			});

			yosys.on('close', (code) => {
				finish(code);
			});
		});
	}

	/**
	 * Check if Yosys is available
	 */
	static async checkAvailability(
		outputChannel: vscode.OutputChannel
	): Promise<boolean> {
		return new Promise((resolve) => {
			const check = spawn('yosys', ['--version'], {
				timeout: 5000
			});

			let found = false;

			check.stdout.on('data', (data) => {
				if (data.toString().includes('Yosys')) {
					found = true;
				}
			});

			check.on('close', (code) => {
				if (!found && code !== 0) {
					outputChannel.appendLine(
						'WARNING: Yosys not found in PATH'
					);
					outputChannel.appendLine(
						'Run from within `nix develop` shell or install Yosys'
					);
				}
				resolve(found || code === 0);
			});

			check.on('error', () => {
				outputChannel.appendLine('WARNING: Could not check for Yosys');
				resolve(false);
			});
		});
	}
}

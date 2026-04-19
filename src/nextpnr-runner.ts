import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { promises as fs } from 'fs';
import {
	NextpnrOptions,
	NextpnrResult,
	NextpnrWarning,
	NextpnrError,
	TimingInfo,
	UtilizationInfo,
	PNR_FAMILIES
} from './nextpnr-types';
import { getLogger } from './file-logger';

/**
 * Handles nextpnr place-and-route execution
 */
export class NextpnrRunner {
	private outputChannel: vscode.OutputChannel;

	constructor(outputChannel: vscode.OutputChannel) {
		this.outputChannel = outputChannel;
	}

	/**
	 * Run nextpnr place-and-route
	 */
	async placeAndRoute(options: NextpnrOptions): Promise<NextpnrResult> {
		this.outputChannel.appendLine('\n=== Place and Route with nextpnr ===');
		this.outputChannel.appendLine(`Family: ${options.family}`);
		this.outputChannel.appendLine(`Top Module: ${options.topModule}`);
		this.outputChannel.appendLine(`JSON: ${options.jsonPath}`);

		// Ensure output directory exists
		await fs.mkdir(options.outputDir, { recursive: true });

		// Determine output paths
		const textcfgPath = path.join(options.outputDir, `${options.topModule}.config`);
		const bitstreamPath = path.join(options.outputDir, `${options.topModule}.bit`);

		// Build nextpnr command
		const args = NextpnrRunner.buildNextpnrArgs(options, textcfgPath);
		const executable = NextpnrRunner.getExecutable(options.family);

		this.outputChannel.appendLine(`\nRunning: ${executable} ${args.join(' ')}`);
		this.outputChannel.appendLine('');

		// Run nextpnr
		const nextpnrResult = await this.runNextpnr(executable, args, options);

		if (!nextpnrResult.success) {
			return nextpnrResult;
		}

		// For ECP5, run ecppack to generate bitstream
		if (options.family === 'ecp5') {
			this.outputChannel.appendLine('\n=== Generating Bitstream with ecppack ===');
			const ecppackResult = await this.runEcppack(textcfgPath, bitstreamPath);

			if (ecppackResult.success) {
				nextpnrResult.bitstreamPath = bitstreamPath;
				this.outputChannel.appendLine(`✓ Bitstream generated: ${bitstreamPath}`);
			} else {
				this.outputChannel.appendLine(`✗ Bitstream generation failed`);
				nextpnrResult.warnings.push({
					message: 'ecppack failed to generate bitstream'
				});
			}
		}

		return nextpnrResult;
	}

	/**
	 * Get nextpnr executable name for the specified family
	 */
	/**
	 * Get the nextpnr executable name for a given FPGA family.
	 */
	static getExecutable(family: string): string {
		switch (family) {
			case 'ecp5':
				return 'nextpnr-ecp5';
			case 'ice40':
				return 'nextpnr-ice40';
			case 'gowin':
				return 'nextpnr-himbaechel';
			case 'nexus':
				return 'nextpnr-nexus';
			case 'machxo2':
				return 'nextpnr-machxo2';
			default:
				return 'nextpnr-generic';
		}
	}

	/** Known package names per nextpnr family to probe. */
	private static readonly CANDIDATE_PACKAGES: Record<string, string[]> = {
		'nextpnr-ecp5': [
			'CABGA256', 'CABGA381', 'CABGA554', 'CABGA756',
			'CSFBGA285', 'CSFBGA381', 'CSFBGA554',
		],
		'nextpnr-ice40': [
			'sg48', 'cm36', 'cm49', 'cm81', 'cm121', 'cm225',
			'qn84', 'cb81', 'cb121', 'cb132', 'vq100', 'tq144',
			'ct256', 'bg121',
		],
		'nextpnr-himbaechel': [],  // gowin packages depend heavily on part; skip probing
	};

	/** Cache: "binary:device" → valid packages (survives for the session). */
	private static packageCache = new Map<string, string[]>();

	/**
	 * Discover which packages a nextpnr binary accepts for the given device
	 * by probing each candidate package.
	 *
	 * @param device    Device value (e.g. '25k', 'hx8k', 'GW1N-9')
	 * @param binary    nextpnr binary name (default: 'nextpnr-ecp5')
	 * @param deviceFlag  How to pass the device: 'prefix' → `--<device>`, 'device' → `--device <device>`
	 *
	 * Results are cached per binary+device so the probe only runs once per session.
	 */
	static async getValidPackages(
		device: string,
		binary = 'nextpnr-ecp5',
		deviceFlag: 'prefix' | 'device' = 'prefix'
	): Promise<string[]> {
		const cacheKey = `${binary}:${device}`;
		const cached = NextpnrRunner.packageCache.get(cacheKey);
		if (cached) { return cached; }

		const candidates = NextpnrRunner.CANDIDATE_PACKAGES[binary] ?? [];
		if (candidates.length === 0) {
			NextpnrRunner.packageCache.set(cacheKey, []);
			return [];
		}

		// Write a minimal valid JSON netlist so nextpnr can parse it.
		// Using /dev/null causes a JSON parse error that masks real
		// "Unsupported package" errors.
		const probeJson = path.join(
			os.tmpdir(),
			`nextpnr-probe-${process.pid}.json`
		);
		await fs.writeFile(probeJson, '{"modules":{}}');

		const deviceArgs = deviceFlag === 'prefix'
			? [`--${device}`]
			: ['--device', device];

		try {
			const probes = candidates.map(pkg =>
				new Promise<{ pkg: string; ok: boolean }>(resolve => {
					const proc = spawn(binary, [
						...deviceArgs, '--package', pkg, '--json', probeJson,
					], { timeout: 5000 });

					let combined = '';
					proc.stdout.on('data', (d) => { combined += d.toString(); });
					proc.stderr.on('data', (d) => { combined += d.toString(); });
					proc.on('error', () => resolve({ pkg, ok: false }));
					proc.on('close', () => {
						// The empty netlist always causes a non-zero exit
						// ("no top module"), so we can't rely on the exit code.
						// A package is valid if nextpnr didn't reject it.
						const rejected = /unsupported package/i.test(combined);
						resolve({ pkg, ok: !rejected });
					});
				})
			);
			const results = await Promise.all(probes);
			const valid: string[] = [];
			for (const { pkg, ok } of results) {
				if (ok) { valid.push(pkg); }
			}

			NextpnrRunner.packageCache.set(cacheKey, valid);
			return valid;
		} finally {
			try { await fs.unlink(probeJson); } catch { /* ignore */ }
		}
	}

	/**
	 * Build nextpnr command-line arguments
	 */
	static buildNextpnrArgs(options: NextpnrOptions, textcfgPath: string): string[] {
		const args: string[] = [];

		// Input JSON
		args.push('--json', options.jsonPath);

		// Output flag varies by family
		switch (options.family) {
			case 'ice40':  args.push('--asc', textcfgPath); break;
			case 'gowin':  args.push('--write', textcfgPath); break;
			default:       args.push('--textcfg', textcfgPath); break;
		}

		// ECP5-specific options (legacy path)
		if (options.family === 'ecp5' && options.ecp5) {
			args.push('--' + options.ecp5.device);
			args.push('--package', options.ecp5.package);

			if (options.ecp5.speedGrade) {
				args.push('--speed', options.ecp5.speedGrade);
			}
		}

		// Generic device / package (used for ice40, gowin, and new-style ecp5)
		if (options.device && !options.ecp5) {
			const familyInfo = PNR_FAMILIES.get(options.family);
			if (familyInfo?.deviceFlag === 'prefix') {
				// e.g. --hx8k, --25k
				args.push('--' + options.device);
			} else {
				// e.g. --device GW1N-9
				args.push('--device', options.device);
			}
		}
		if (options.packageName && !options.ecp5) {
			args.push('--package', options.packageName);
		}

		// Extra --vopt (e.g. family=GW1N-9C for Gowin himbaechel)
		if (options.vopt) {
			for (const v of options.vopt) {
				args.push('--vopt', v);
			}
		}

		// Constraints file
		if (options.constraintsFile) {
			switch (options.family) {
				case 'ecp5': args.push('--lpf', options.constraintsFile); break;
				case 'gowin': args.push('--cst', options.constraintsFile); break;
				default: args.push('--pcf', options.constraintsFile); break;
			}
		}

		// Frequency constraint
		if (options.frequency) {
			args.push('--freq', options.frequency.toString());
		}

		// Seed for reproducibility
		if (options.seed !== undefined) {
			args.push('--seed', options.seed.toString());
		}

		// Timing report
		if (options.timing) {
			args.push('--timing-allow-fail');
		}

		// Additional arguments
		if (options.extraArgs) {
			args.push(...options.extraArgs);
		}

		return args;
	}

	/**
	 * Execute nextpnr
	 */
	private async runNextpnr(
		executable: string,
		args: string[],
		options: NextpnrOptions
	): Promise<NextpnrResult> {
		return new Promise((resolve) => {
			let stdout = '';
			let stderr = '';
			const warnings: NextpnrWarning[] = [];
			const errors: NextpnrError[] = [];

			const logger = getLogger();
			const finishLog = logger?.command(executable, args);
			const nextpnr = spawn(executable, args);

			nextpnr.stdout.on('data', (data) => {
				const text = data.toString();
				stdout += text;
				this.outputChannel.append(text);
			});

			nextpnr.stderr.on('data', (data) => {
				const text = data.toString();
				stderr += text;
				this.outputChannel.append(text);

				// Parse warnings and errors
				if (text.toLowerCase().includes('warning')) {
					warnings.push({ message: text.trim() });
				}
				if (text.toLowerCase().includes('error')) {
					errors.push({ message: text.trim() });
				}
			});

			nextpnr.on('error', (error) => {
				this.outputChannel.appendLine(`\nERROR: Failed to spawn ${executable}: ${error.message}`);
				this.outputChannel.appendLine('Make sure nextpnr is installed and in your PATH');
				resolve({
					success: false,
					output: stdout + stderr,
					warnings,
					errors: [{ message: error.message }]
				});
			});

			nextpnr.on('close', async (code) => {
				finishLog?.then(fn => fn(code));
				this.outputChannel.appendLine('');
				this.outputChannel.appendLine(`nextpnr exited with code ${code}`);

				// Save complete log to file
				const logPath = path.join(options.outputDir, 'nextpnr.log');
				const fullOutput = stdout + stderr;
				try {
					await fs.writeFile(logPath, fullOutput, 'utf8');
					this.outputChannel.appendLine(`Log saved: ${logPath}`);
				} catch (err) {
					this.outputChannel.appendLine(`Warning: Could not save log file: ${err}`);
				}

				if (code === 0) {
					this.outputChannel.appendLine('✓ Place and route successful');

					// Parse output for timing and utilization
					const timing = this.parseTiming(stdout);
					const utilization = this.parseUtilization(stdout);

					// Display timing analysis in output channel
					if (timing) {
						this.outputChannel.appendLine('');
						this.outputChannel.appendLine('Timing Analysis:');
						this.outputChannel.appendLine('-'.repeat(60));
						if (timing.prePlacementFrequency !== undefined) {
							this.outputChannel.appendLine(`  Pre-Routing Est.:  ${timing.prePlacementFrequency.toFixed(2)} MHz (after placement)`);
						}
						if (timing.maxFrequency !== undefined) {
							this.outputChannel.appendLine(`  Max Frequency:     ${timing.maxFrequency.toFixed(2)} MHz (after routing)`);
						}
						if (timing.criticalPathDelay !== undefined) {
							this.outputChannel.appendLine(`  Critical Path:     ${timing.criticalPathDelay.toFixed(2)} ns`);
						}
						if (timing.setupSlack !== undefined) {
							this.outputChannel.appendLine(`  Setup Slack:       ${timing.setupSlack.toFixed(2)} ns`);
						}
						if (timing.holdSlack !== undefined) {
							this.outputChannel.appendLine(`  Hold Slack:        ${timing.holdSlack.toFixed(2)} ns`);
						}
						this.outputChannel.appendLine(`  Constraints:       ${timing.constraintsMet ? '✓ MET' : '✗ FAILED'}`);
					}

					// Display utilization in output channel
					if (utilization) {
						this.outputChannel.appendLine('');
						this.outputChannel.appendLine('Resource Utilization:');
						this.outputChannel.appendLine('-'.repeat(60));
						if (utilization.luts) {
							const pct = ((utilization.luts.used / utilization.luts.total) * 100).toFixed(1);
							this.outputChannel.appendLine(`  LUTs:      ${utilization.luts.used.toString().padStart(5)}/${utilization.luts.total.toString().padEnd(5)} (${pct}%)`);
						}
						if (utilization.registers) {
							const pct = ((utilization.registers.used / utilization.registers.total) * 100).toFixed(1);
							this.outputChannel.appendLine(`  Registers: ${utilization.registers.used.toString().padStart(5)}/${utilization.registers.total.toString().padEnd(5)} (${pct}%)`);
						}
						if (utilization.bram) {
							const pct = ((utilization.bram.used / utilization.bram.total) * 100).toFixed(1);
							this.outputChannel.appendLine(`  BRAM:      ${utilization.bram.used.toString().padStart(5)}/${utilization.bram.total.toString().padEnd(5)} (${pct}%)`);
						}
						if (utilization.dsp) {
							const pct = ((utilization.dsp.used / utilization.dsp.total) * 100).toFixed(1);
							this.outputChannel.appendLine(`  DSP:       ${utilization.dsp.used.toString().padStart(5)}/${utilization.dsp.total.toString().padEnd(5)} (${pct}%)`);
						}
						if (utilization.io) {
							const pct = ((utilization.io.used / utilization.io.total) * 100).toFixed(1);
							this.outputChannel.appendLine(`  IO:        ${utilization.io.used.toString().padStart(5)}/${utilization.io.total.toString().padEnd(5)} (${pct}%)`);
						}
					}

					// Save timing and utilization reports
					this.outputChannel.appendLine('');
					try {
						if (timing) {
							const timingReport = this.formatTimingReport(timing);
							const timingPath = path.join(options.outputDir, 'timing.txt');
							await fs.writeFile(timingPath, timingReport, 'utf8');
							this.outputChannel.appendLine(`Timing report saved: ${timingPath}`);
						}
						if (utilization) {
							const utilReport = this.formatUtilizationReport(utilization);
							const utilPath = path.join(options.outputDir, 'utilization.txt');
							await fs.writeFile(utilPath, utilReport, 'utf8');
							this.outputChannel.appendLine(`Utilization report saved: ${utilPath}`);
						}
						// Create combined summary report
						if (timing || utilization) {
							const summaryReport = this.formatSummaryReport(timing, utilization, options.topModule);
							const summaryPath = path.join(options.outputDir, 'summary.txt');
							await fs.writeFile(summaryPath, summaryReport, 'utf8');
							this.outputChannel.appendLine(`Summary report saved: ${summaryPath}`);
						}
					} catch (err) {
						this.outputChannel.appendLine(`Warning: Could not save reports: ${err}`);
					}

					const textcfgPath = path.join(options.outputDir, `${options.topModule}.config`);

					resolve({
						success: true,
						textcfgPath,
						output: fullOutput,
						timing,
						utilization,
						warnings,
						errors
					});
				} else {
					this.outputChannel.appendLine(`✗ Place and route failed with code ${code}`);
					resolve({
						success: false,
						output: fullOutput,
						warnings,
						errors
					});
				}
			});
		});
	}

	/**
	 * Run ecppack to generate bitstream from textcfg
	 */
	private async runEcppack(textcfgPath: string, bitstreamPath: string): Promise<{ success: boolean }> {
		return new Promise((resolve) => {
			const args = [textcfgPath, bitstreamPath];
			const logger = getLogger();
			const finishLog = logger?.command('ecppack', args);
			const ecppack = spawn('ecppack', args);

			let output = '';

			ecppack.stdout.on('data', (data) => {
				const text = data.toString();
				output += text;
				this.outputChannel.append(text);
			});

			ecppack.stderr.on('data', (data) => {
				const text = data.toString();
				output += text;
				this.outputChannel.append(text);
			});

			ecppack.on('error', (error) => {
				this.outputChannel.appendLine(`\nERROR: Failed to spawn ecppack: ${error.message}`);
				resolve({ success: false });
			});

			ecppack.on('close', async (code) => {
				finishLog?.then(fn => fn(code));
				// Save ecppack log
				const logPath = path.join(path.dirname(bitstreamPath), 'ecppack.log');
				try {
					await fs.writeFile(logPath, output, 'utf8');
					this.outputChannel.appendLine(`\necppack log saved: ${logPath}`);
				} catch (err) {
					this.outputChannel.appendLine(`Warning: Could not save ecppack log: ${err}`);
				}
				
				resolve({ success: code === 0 });
			});
		});
	}

	/**
	 * Parse timing information from nextpnr output
	 */
	private parseTiming(output: string): TimingInfo | undefined {
		const timing: TimingInfo = {
			constraintsMet: true
		};

		// Parse max frequencies
		// nextpnr reports frequency twice:
		//   1. After placement (higher, optimistic)
		//   2. After routing (lower, actual achievable frequency)
		// We want the LAST occurrence (post-routing)
		const freqRegex = /Max frequency for clock.*?:\s*([\d.]+)\s*MHz/gi;
		const freqMatches = [...output.matchAll(freqRegex)];
		
		if (freqMatches.length > 0) {
			if (freqMatches.length === 1) {
				// Only one frequency reported (simple design or no routing)
				timing.maxFrequency = parseFloat(freqMatches[0][1]);
			} else {
				// Multiple frequencies: first is pre-routing estimate, last is post-routing actual
				timing.prePlacementFrequency = parseFloat(freqMatches[0][1]);
				timing.maxFrequency = parseFloat(freqMatches[freqMatches.length - 1][1]);
			}
		}

		// Parse critical path delay
		// Look for "X.XX ns logic, Y.YY ns routing" pattern which gives total delay
		const logicRoutingMatch = output.match(/([\d.]+)\s*ns logic,\s*([\d.]+)\s*ns routing/i);
		if (logicRoutingMatch) {
			const logicDelay = parseFloat(logicRoutingMatch[1]);
			const routingDelay = parseFloat(logicRoutingMatch[2]);
			timing.criticalPathDelay = logicDelay + routingDelay;
		} else {
			// Fallback: "Critical path delay: 12.34 ns"
			const delayMatch = output.match(/Critical path.*?delay:\s*([\d.]+)\s*ns/i);
			if (delayMatch) {
				timing.criticalPathDelay = parseFloat(delayMatch[1]);
			}
		}

		// Parse slack
		const setupSlackMatch = output.match(/Setup slack.*?:\s*([-\d.]+)\s*ns/i);
		if (setupSlackMatch) {
			timing.setupSlack = parseFloat(setupSlackMatch[1]);
			if (timing.setupSlack < 0) {
				timing.constraintsMet = false;
			}
		}

		const holdSlackMatch = output.match(/Hold slack.*?:\s*([-\d.]+)\s*ns/i);
		if (holdSlackMatch) {
			timing.holdSlack = parseFloat(holdSlackMatch[1]);
			if (timing.holdSlack < 0) {
				timing.constraintsMet = false;
			}
		}

		// Check for timing failure messages
		if (output.includes('FAIL') || output.includes('not met')) {
			timing.constraintsMet = false;
		}

		return timing;
	}

	/**
	 * Parse utilization information from nextpnr output
	 */
	private parseUtilization(output: string): UtilizationInfo | undefined {
		const util: UtilizationInfo = {};

		// Parse LUT usage (ECP5 format): "Total LUT4s:         8/24288     0%"
		const lutMatch = output.match(/Total LUT4s?:\s*(\d+)\/(\d+)/i);
		if (lutMatch) {
			util.luts = {
				used: parseInt(lutMatch[1]),
				total: parseInt(lutMatch[2])
			};
		} else {
			// Try older format: "LUT:  1234/12000"
			const legacyLutMatch = output.match(/LUT:\s*(\d+)\/(\d+)/i);
			if (legacyLutMatch) {
				util.luts = {
					used: parseInt(legacyLutMatch[1]),
					total: parseInt(legacyLutMatch[2])
				};
			}
		}

		// Parse register usage (ECP5 format): "TRELLIS_FF:       8/  24288     0%"
		const ffMatch = output.match(/TRELLIS_FF:\s*(\d+)\s*\/\s*(\d+)/i);
		if (ffMatch) {
			util.registers = {
				used: parseInt(ffMatch[1]),
				total: parseInt(ffMatch[2])
			};
		} else {
			// Try "Total DFFs:         8/24288     0%"
			const dffMatch = output.match(/Total DFFs?:\s*(\d+)\/(\d+)/i);
			if (dffMatch) {
				util.registers = {
					used: parseInt(dffMatch[1]),
					total: parseInt(dffMatch[2])
				};
			} else {
				// Fallback to legacy formats
				const legacyRegMatch = output.match(/(?:DFF|REG):\s*(\d+)\/(\d+)/i);
				if (legacyRegMatch) {
					util.registers = {
						used: parseInt(legacyRegMatch[1]),
						total: parseInt(legacyRegMatch[2])
					};
				}
			}
		}

		// Parse BRAM usage (ECP5 format): "DP16KD:       0/     56     0%"
		const dp16kdMatch = output.match(/DP16KD:\s*(\d+)\s*\/\s*(\d+)/i);
		if (dp16kdMatch) {
			util.bram = {
				used: parseInt(dp16kdMatch[1]),
				total: parseInt(dp16kdMatch[2])
			};
		} else {
			// Try legacy formats: "BRAM:  5/56" or "EBR:  5/56"
			const bramMatch = output.match(/(?:BRAM|EBR):\s*(\d+)\/(\d+)/i);
			if (bramMatch) {
				util.bram = {
					used: parseInt(bramMatch[1]),
					total: parseInt(bramMatch[2])
				};
			}
		}

		// Parse DSP usage: "DSP:  0/28"
		const dspMatch = output.match(/DSP:\s*(\d+)\/(\d+)/i);
		if (dspMatch) {
			util.dsp = {
				used: parseInt(dspMatch[1]),
				total: parseInt(dspMatch[2])
			};
		}

		// Parse IO usage (ECP5 format): "TRELLIS_IO:      19/    197     9%"
		const trellisIoMatch = output.match(/TRELLIS_IO:\s*(\d+)\s*\/\s*(\d+)/i);
		if (trellisIoMatch) {
			util.io = {
				used: parseInt(trellisIoMatch[1]),
				total: parseInt(trellisIoMatch[2])
			};
		} else {
			// Try legacy format: "IO:  8/256"
			const ioMatch = output.match(/IO:\s*(\d+)\/(\d+)/i);
			if (ioMatch) {
				util.io = {
					used: parseInt(ioMatch[1]),
					total: parseInt(ioMatch[2])
				};
			}
		}

		return Object.keys(util).length > 0 ? util : undefined;
	}

	/**
	 * Format timing information for report file
	 */
	private formatTimingReport(timing: TimingInfo): string {
		let report = 'Timing Analysis Report\n';
		report += '='.repeat(60) + '\n';
		report += `Generated: ${new Date().toISOString()}\n\n`;

		if (timing.prePlacementFrequency !== undefined) {
			report += `Pre-Routing Est. Freq: ${timing.prePlacementFrequency.toFixed(2)} MHz\n`;
		}
		if (timing.maxFrequency !== undefined) {
			report += `Maximum Frequency:     ${timing.maxFrequency.toFixed(2)} MHz\n`;
		}

		if (timing.criticalPathDelay !== undefined) {
			report += `Critical Path Delay:   ${timing.criticalPathDelay.toFixed(3)} ns\n`;
		}

		if (timing.setupSlack !== undefined) {
			const status = timing.setupSlack >= 0 ? 'PASS' : 'FAIL';
			report += `Setup Slack:           ${timing.setupSlack.toFixed(3)} ns [${status}]\n`;
		}

		if (timing.holdSlack !== undefined) {
			const status = timing.holdSlack >= 0 ? 'PASS' : 'FAIL';
			report += `Hold Slack:            ${timing.holdSlack.toFixed(3)} ns [${status}]\n`;
		}

		report += '\n';
		report += `Overall Status:        ${timing.constraintsMet ? '✓ CONSTRAINTS MET' : '✗ CONSTRAINTS FAILED'}\n`;

		return report;
	}

	/**
	 * Format utilization information for report file
	 */
	private formatUtilizationReport(util: UtilizationInfo): string {
		let report = 'Resource Utilization Report\n';
		report += '='.repeat(60) + '\n';
		report += `Generated: ${new Date().toISOString()}\n\n`;

		const formatResource = (name: string, used: number, total: number): string => {
			const percent = ((used / total) * 100).toFixed(2);
			const bar = this.createBar(used, total, 40);
			return `${name.padEnd(15)} ${used.toString().padStart(6)} / ${total.toString().padEnd(6)} (${percent.padStart(6)}%)  ${bar}\n`;
		};

		if (util.luts) {
			report += formatResource('LUTs', util.luts.used, util.luts.total);
		}

		if (util.registers) {
			report += formatResource('Registers', util.registers.used, util.registers.total);
		}

		if (util.bram) {
			report += formatResource('BRAM/EBR', util.bram.used, util.bram.total);
		}

		if (util.dsp) {
			report += formatResource('DSP', util.dsp.used, util.dsp.total);
		}

		if (util.io) {
			report += formatResource('IO', util.io.used, util.io.total);
		}

		return report;
	}

	/**
	 * Format combined summary report with timing and utilization
	 */
	private formatSummaryReport(
		timing: TimingInfo | undefined, 
		utilization: UtilizationInfo | undefined,
		topModule: string
	): string {
		let report = 'nextpnr Place & Route Summary\n';
		report += '='.repeat(70) + '\n';
		report += `Module:    ${topModule}\n`;
		report += `Generated: ${new Date().toISOString()}\n`;
		report += '='.repeat(70) + '\n\n';

		// Timing Section
		if (timing) {
			report += 'TIMING ANALYSIS\n';
			report += '-'.repeat(70) + '\n';
			
			if (timing.prePlacementFrequency !== undefined) {
				report += `  Pre-Routing Estimate:  ${timing.prePlacementFrequency.toFixed(2)} MHz (after placement)\n`;
			}
			if (timing.maxFrequency !== undefined) {
				report += `  Maximum Frequency:     ${timing.maxFrequency.toFixed(2)} MHz (after routing)\n`;
				if (timing.prePlacementFrequency !== undefined) {
					const overhead = timing.prePlacementFrequency - timing.maxFrequency;
					const overheadPct = (overhead / timing.prePlacementFrequency * 100).toFixed(1);
					report += `  Routing Overhead:      ${overhead.toFixed(2)} MHz (${overheadPct}%)\n`;
				}
			}
			if (timing.criticalPathDelay !== undefined) {
				report += `  Critical Path Delay:   ${timing.criticalPathDelay.toFixed(3)} ns\n`;
			}
			if (timing.setupSlack !== undefined) {
				const status = timing.setupSlack >= 0 ? 'PASS' : 'FAIL';
				report += `  Setup Slack:           ${timing.setupSlack.toFixed(3)} ns [${status}]\n`;
			}
			if (timing.holdSlack !== undefined) {
				const status = timing.holdSlack >= 0 ? 'PASS' : 'FAIL';
				report += `  Hold Slack:            ${timing.holdSlack.toFixed(3)} ns [${status}]\n`;
			}
			report += `  Timing Constraints:    ${timing.constraintsMet ? '✓ MET' : '✗ FAILED'}\n`;
			report += '\n';
		}

		// Utilization Section
		if (utilization) {
			report += 'RESOURCE UTILIZATION\n';
			report += '-'.repeat(70) + '\n';
			
			const formatLine = (name: string, used: number, total: number): string => {
				const percent = ((used / total) * 100).toFixed(1);
				return `  ${name.padEnd(15)} ${used.toString().padStart(6)} / ${total.toString().padEnd(8)} (${percent.padStart(5)}%)\n`;
			};

			if (utilization.luts) {
				report += formatLine('LUTs:', utilization.luts.used, utilization.luts.total);
			}
			if (utilization.registers) {
				report += formatLine('Registers:', utilization.registers.used, utilization.registers.total);
			}
			if (utilization.bram) {
				report += formatLine('BRAM/EBR:', utilization.bram.used, utilization.bram.total);
			}
			if (utilization.dsp) {
				report += formatLine('DSP Blocks:', utilization.dsp.used, utilization.dsp.total);
			}
			if (utilization.io) {
				report += formatLine('IO Pins:', utilization.io.used, utilization.io.total);
			}
			report += '\n';
		}

		report += '='.repeat(70) + '\n';
		report += 'For detailed analysis, see timing.txt and utilization.txt\n';
		report += '='.repeat(70) + '\n';

		return report;
	}

	/**
	 * Create a text-based bar chart
	 */
	private createBar(used: number, total: number, width: number): string {
		const percent = used / total;
		const filled = Math.round(percent * width);
		const empty = width - filled;
		return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
	}
}

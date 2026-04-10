import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import { promises as fs } from 'fs';
import {
	YosysOptions,
	YosysSynthesisResult,
	SynthesisStatistics,
	YosysWarning,
	YosysError
} from './yosys-types';

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
					const stats = this.parseStatistics(stdout);

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
		switch (targetFamily) {
			case 'ice40':
				return `synth_ice40 -top ${topModule}`;
			case 'ecp5':
				return `synth_ecp5 -top ${topModule}`;
			case 'xilinx':
				return `synth_xilinx -top ${topModule}`;
			default:
				return null; // generic synthesis (no single command)
		}
	}

	/**
	 * Generate Yosys synthesis script
	 */
	private async generateScript(options: YosysOptions): Promise<string> {
		const outputBaseName = path.basename(options.topModule);
		const synthesizedVerilog = path.join(
			options.outputDir,
			`${outputBaseName}_synth.v`
		);
		const statsFile = path.join(options.outputDir, 'synthesis_stats.txt');

		// Determine which Verilog files to use
		let verilogFiles: string[];
		if (Array.isArray(options.verilogPath)) {
			// Use provided file list (from manifest with dependencies)
			verilogFiles = options.verilogPath;
			this.outputChannel.appendLine(`Using ${verilogFiles.length} Verilog files from manifest (includes dependencies, deduplicated)`);
		} else {
			// Fallback: scan directory for all .v files
			const verilogDir = path.dirname(options.verilogPath);
			const allFiles = await fs.readdir(verilogDir);
			verilogFiles = allFiles
				.filter(f => f.endsWith('.v') && !f.includes('_shim'))
				.map(f => path.join(verilogDir, f));
			this.outputChannel.appendLine(`Scanning directory: found ${verilogFiles.length} Verilog files`);
		}

		// Build Yosys script based on target
		let script = `# Yosys Synthesis Script
# Generated by clash-vscode-yosys extension

# Read design files
`;

		// Read all Verilog files
		for (const vFile of verilogFiles) {
			script += `read_verilog ${vFile}\n`;
		}

		script += `
# Elaborate design
hierarchy -check -top ${options.topModule}

`;

		// Target-specific synthesis
		if (options.targetFamily === 'ice40') {
			script += `# Synthesize for iCE40 FPGA
synth_ice40 -top ${options.topModule}

`;
		} else if (options.targetFamily === 'ecp5') {
			script += `# Synthesize for ECP5 FPGA
synth_ecp5 -top ${options.topModule}

`;
		} else if (options.targetFamily === 'xilinx') {
			script += `# Synthesize for Xilinx FPGA
synth_xilinx -top ${options.topModule}

`;
		} else {
			// Generic synthesis
			script += `# High-level synthesis
proc
opt
fsm
opt
memory
opt

# Technology mapping (generic)
techmap
opt

`;
		}

		// Generate statistics
		script += `# Generate statistics
stat -width
`;

		if (options.libertyFile) {
			script += `stat -liberty ${options.libertyFile}
`;
		}

		script += `tee -o ${statsFile} stat

`;

		// Write outputs
		script += `# Write synthesized Verilog
write_verilog -noattr ${synthesizedVerilog}

`;

		// Always write JSON for DigitalJS visualization
		const jsonPath = path.join(options.outputDir, `${outputBaseName}.json`);
		script += `# Prepare design for DigitalJS (remove unsupported cells)
delete */t:$specify2 */t:$specify3
opt_clean
clean

# Write JSON for DigitalJS
write_json ${jsonPath}

`;

		// Write script to file
		const scriptPath = path.join(options.outputDir, 'synth.ys');
		await fs.writeFile(scriptPath, script);

		return scriptPath;
	}

	/**
	 * Parse synthesis statistics from Yosys output
	 */
	private parseStatistics(output: string): SynthesisStatistics {
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

		// Parse cell types
		const cellTypes = new Map<string, number>();
		const cellTypeRegex = /\$(\w+)\s+(\d+)/g;
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

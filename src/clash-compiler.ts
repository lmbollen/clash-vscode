import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import { promises as fs } from 'fs';
import { ClashManifestParser } from './clash-manifest-parser';
import { ParsedClashManifest } from './clash-manifest-types';

/**
 * Result of Clash compilation
 */
export interface ClashCompilationResult {
	success: boolean;
	verilogPath?: string;
	/** All Verilog files including dependencies (from manifest) */
	allVerilogFiles?: string[];
	/** Parsed manifest with metadata */
	manifest?: ParsedClashManifest;
	errors: string[];
	warnings: string[];
	output: string;
}

/**
 * Options for Clash compilation
 */
export interface ClashCompilationOptions {
	workspaceRoot: string;
	outputDir: string;
	moduleName: string;
	hdlDir?: string;
	/** Root of the synthesis cabal project (.clash/synth-project).
	 *  When set, cabal is invoked with this as cwd so the wrapper module
	 *  and all user-package dependencies are resolved through cabal. */
	synthProjectRoot?: string;
	/** The user's cabal project directory (where cabal.project lives).
	 *  When set, the compiler passes --project-dir and --project-file so
	 *  that relative paths in the imported cabal.project resolve correctly. */
	cabalProjectDir?: string;
}

/**
 * Handles Clash compilation from Haskell to Verilog
 */
export class ClashCompiler {
	private manifestParser: ClashManifestParser;

	/** The fixed command and arguments used to invoke the Clash compiler
	 *  via the synthesis cabal project. */
	private static readonly CLASH_COMMAND = 'cabal';
	private static readonly CLASH_BASE_ARGS = ['run', 'clash-synth:clash', '--'];

	constructor(private outputChannel: vscode.OutputChannel) {
		this.manifestParser = new ClashManifestParser();
	}

	/**
	 * Validate that the Clash command works by running it with --version
	 * @param workspaceRoot Optional workspace root to run validation in (important for direnv)
	 */
	async validateCommand(workspaceRoot?: string): Promise<{ success: boolean; message: string; output?: string }> {
		const command = ClashCompiler.CLASH_COMMAND;
		const args = [...ClashCompiler.CLASH_BASE_ARGS, '--version'];
		
		return new Promise((resolve) => {
			// Run in workspace directory if provided (important for direnv/nix-shell)
			const spawnOptions: any = {
				timeout: 10000
			};
			if (workspaceRoot) {
				spawnOptions.cwd = workspaceRoot;
			}
			
			const process = spawn(command, args, spawnOptions);
			
			let stdout = '';
			let stderr = '';
			
			process.stdout.on('data', (data) => {
				stdout += data.toString();
			});
			
			process.stderr.on('data', (data) => {
				stderr += data.toString();
			});
			
			process.on('close', (code) => {
				const output = stdout + stderr;
				// Consider it successful if:
				// 1. Exit code is 0, OR
				// 2. Output contains version/clash info (even if exit code is non-zero)
				//    This handles cases where --version prints to stderr and returns non-zero
				const hasVersionOutput = output.toLowerCase().includes('clash') || 
				                         output.toLowerCase().includes('version') ||
				                         output.includes('GHC');
				
				if (code === 0 || hasVersionOutput) {
					resolve({
						success: true,
						message: `Clash command validated: ${command} ${args.join(' ')}`,
						output: output.trim()
					});
				} else {
					resolve({
						success: false,
						message: `Clash command validation failed (exit code ${code}). Make sure cabal and clash-ghc are available.`,
						output: output.trim()
					});
				}
			});
			
			process.on('error', (error) => {
				resolve({
					success: false,
					message: `Failed to spawn: ${error.message}`,
					output: error.message
				});
			});
		});
	}

	/**
	 * Compile a Clash module to Verilog.
	 *
	 * When options.synthProjectRoot is set, we run cabal inside the
	 * synthesis cabal project which depends on the user's package.
	 * This ensures all transitive dependencies are resolved correctly.
	 * Otherwise we fall back to the old -i flag approach.
	 */
	async compileToVerilog(
		wrapperPath: string,
		options: ClashCompilationOptions
	): Promise<ClashCompilationResult> {
		this.outputChannel.appendLine('');
		this.outputChannel.appendLine('='.repeat(60));
		this.outputChannel.appendLine('Clash Compilation');
		this.outputChannel.appendLine('='.repeat(60));
		this.outputChannel.appendLine(`Module: ${options.moduleName}`);
		this.outputChannel.appendLine(`Workspace: ${options.workspaceRoot}`);
		this.outputChannel.appendLine('');

		// Determine HDL output directory
		const hdlDir = options.hdlDir || path.join(options.outputDir, 'verilog');
		
		// Get Clash command
		const command = ClashCompiler.CLASH_COMMAND;
		const baseArgs = [...ClashCompiler.CLASH_BASE_ARGS];
		
		// Determine cwd and extra args depending on whether we have a
		// synthesis cabal project.
		let cwd: string;
		const cabalFlags: string[] = [];  // cabal-level flags (before subcommand)
		const extraArgs: string[] = [];   // GHC/Clash flags (after --)
		
		if (options.synthProjectRoot) {
			if (options.cabalProjectDir) {
				// Run with --project-dir pointing at the user's project root
				// so that packages: paths in their cabal.project resolve
				// correctly.  --project-file selects our synth project file.
				cwd = options.cabalProjectDir;
				const projectFile = path.join(options.synthProjectRoot, 'cabal.project');
				cabalFlags.push(`--project-dir=${options.cabalProjectDir}`);
				cabalFlags.push(`--project-file=${projectFile}`);
				this.outputChannel.appendLine(`Using synth project: ${options.synthProjectRoot}`);
				this.outputChannel.appendLine(`Project dir: ${options.cabalProjectDir}`);
			} else {
				// No user cabal.project — run inside the synth project directly
				cwd = options.synthProjectRoot;
				this.outputChannel.appendLine(`Using synth project: ${cwd}`);
			}
		} else {
			// Legacy fallback: add wrapper dir to GHC search path
			cwd = options.workspaceRoot;
			const wrapperDir = path.dirname(wrapperPath);
			extraArgs.push(`-i${wrapperDir}`);
		}
		
		// Build Clash command arguments — use module name, not file path
		// cabalFlags go before subcommand; extraArgs go after --
		const args = [
			...cabalFlags,
			...baseArgs,
			...extraArgs,
			options.moduleName,
			'--verilog',
			'-fclash-hdldir', hdlDir
		];

		this.outputChannel.appendLine(`Running: ${command} ${args.join(' ')}`);
		this.outputChannel.appendLine('');

		return new Promise((resolve) => {
			const clash = spawn(command, args, {
				cwd,
				env: process.env
			});

			let stdout = '';
			let stderr = '';
			const errors: string[] = [];
			const warnings: string[] = [];

			clash.stdout.on('data', (data) => {
				const text = data.toString();
				stdout += text;
				this.outputChannel.append(text);
			});

			clash.stderr.on('data', (data) => {
				const text = data.toString();
				stderr += text;
				this.outputChannel.append(text);
				
				// Parse for errors and warnings
				if (text.toLowerCase().includes('error')) {
					errors.push(text.trim());
				}
				if (text.toLowerCase().includes('warning')) {
					warnings.push(text.trim());
				}
			});

			clash.on('error', (error) => {
				this.outputChannel.appendLine(`\nERROR: Failed to spawn Clash command: ${error.message}`);
				this.outputChannel.appendLine(`Command: ${command} ${args.join(' ')}`);
				resolve({
					success: false,
					errors: [error.message],
					warnings: [],
					output: stdout + stderr
				});
			});

			clash.on('close', async (code) => {
				this.outputChannel.appendLine('');
				this.outputChannel.appendLine(`Clash exited with code ${code}`);
				
				if (code === 0) {
					this.outputChannel.appendLine('✓ Compilation successful');
					
					// Find generated Verilog file
					const verilogPath = await this.findGeneratedVerilog(
						hdlDir,
						options.moduleName
					);
					
					if (verilogPath) {
						this.outputChannel.appendLine(`✓ Generated Verilog: ${verilogPath}`);
						
						// Try to find and parse the manifest
						let manifest: ParsedClashManifest | undefined;
						let allVerilogFiles: string[] | undefined;
						
						try {
							const verilogDir = path.dirname(verilogPath);
							const manifestPath = await this.manifestParser.findManifest(verilogDir);
							
							if (manifestPath) {
								this.outputChannel.appendLine(`✓ Found manifest: ${manifestPath}`);
								manifest = await this.manifestParser.parseManifest(manifestPath);
								
								// Collect all Verilog files including dependencies
								allVerilogFiles = await this.manifestParser.collectAllVerilogFiles(manifestPath);
								
								this.outputChannel.appendLine(`✓ Collected ${allVerilogFiles.length} Verilog file(s):`);
								allVerilogFiles.forEach(f => {
									this.outputChannel.appendLine(`  - ${path.basename(f)}`);
								});
								
								// Display useful manifest info
								if (manifest.targetFrequencyMHz) {
									this.outputChannel.appendLine(`✓ Target frequency: ${manifest.targetFrequencyMHz.toFixed(2)} MHz (from ${manifest.primaryDomain} domain)`);
								}
								
								const { clocks, resets } = this.manifestParser.getClockResetPorts(manifest);
								if (clocks.length > 0) {
									this.outputChannel.appendLine(`✓ Clock signals: ${clocks.join(', ')}`);
								}
								if (resets.length > 0) {
									this.outputChannel.appendLine(`✓ Reset signals: ${resets.join(', ')}`);
								}
							} else {
								this.outputChannel.appendLine('⚠ No manifest found, will use basic file discovery');
							}
						} catch (err) {
							this.outputChannel.appendLine(`⚠ Failed to parse manifest: ${err}`);
							// Continue anyway, manifest is optional
						}
						
						resolve({
							success: true,
							verilogPath,
							allVerilogFiles,
							manifest,
							errors: [],
							warnings,
							output: stdout + stderr
						});
					} else {
						this.outputChannel.appendLine('✗ Could not find generated Verilog file');
						resolve({
							success: false,
							errors: ['Generated Verilog file not found'],
							warnings,
							output: stdout + stderr
						});
					}
				} else {
					this.outputChannel.appendLine(`✗ Compilation failed with code ${code}`);
					resolve({
						success: false,
						errors: errors.length > 0 ? errors : ['Compilation failed'],
						warnings,
						output: stdout + stderr
					});
				}
			});
		});
	}

	/**
	 * Find the generated Verilog file in the HDL directory
	 */
	private async findGeneratedVerilog(
		hdlDir: string,
		moduleName: string
	): Promise<string | undefined> {
		try {
			// Clash generates: hdlDir/ModuleName.topEntity/{t_name}.v
			// where t_name comes from the Synthesize annotation
			const moduleDir = path.join(hdlDir, `${moduleName}.topEntity`);
			
			// List all files in the directory
			const files = await fs.readdir(moduleDir);
			
			// Find the main Verilog file (exclude _types.v, _shim.cpp, etc.)
			const verilogFiles = files.filter(f => 
				f.endsWith('.v') && 
				!f.endsWith('_types.v') &&
				!f.includes('testbench')
			);
			
			if (verilogFiles.length > 0) {
				// Return the first (and usually only) main Verilog file
				return path.join(moduleDir, verilogFiles[0]);
			}
			
			return undefined;
		} catch {
			// Try legacy/alternate locations as fallback
			try {
				// Old format: hdlDir/ModuleName/topEntity.v
				const legacyPath = path.join(hdlDir, moduleName, 'topEntity.v');
				await fs.access(legacyPath);
				return legacyPath;
			} catch {
				// Direct file: hdlDir/ModuleName.v
				try {
					const directPath = path.join(hdlDir, `${moduleName}.v`);
					await fs.access(directPath);
					return directPath;
				} catch {
					return undefined;
				}
			}
		}
	}

	/**
	 * Parse Clash error messages and create diagnostics
	 */
	parseDiagnostics(
		output: string,
		wrapperPath: string
	): vscode.Diagnostic[] {
		const diagnostics: vscode.Diagnostic[] = [];
		
		// Match Clash error format:
		// path/file.hs:line:col: error:
		const errorRegex = /([^:]+):(\d+):(\d+):\s*(error|warning):\s*(.+?)(?=\n[^\s]|\n*$)/gs;
		
		let match;
		while ((match = errorRegex.exec(output)) !== null) {
			const [, filePath, lineStr, colStr, severity, message] = match;
			
			// Only create diagnostics for the wrapper file
			if (filePath.includes(path.basename(wrapperPath))) {
				const line = parseInt(lineStr, 10) - 1; // VS Code uses 0-based
				const col = parseInt(colStr, 10) - 1;
				
				const diagnostic = new vscode.Diagnostic(
					new vscode.Range(line, col, line, col + 10),
					message.trim(),
					severity === 'error' 
						? vscode.DiagnosticSeverity.Error 
						: vscode.DiagnosticSeverity.Warning
				);
				
				diagnostic.source = 'Clash';
				diagnostics.push(diagnostic);
			}
		}
		
		return diagnostics;
	}
}

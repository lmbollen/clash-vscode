import * as vscode from 'vscode';
import * as path from 'path';
import { HLSClient } from './hls-client';
import { FunctionDetector } from './function-detector';
import { CodeGenerator, GenerationConfig } from './code-generator';
import { ClashCompiler } from './clash-compiler';
import { YosysRunner } from './yosys-runner';
import { NextpnrRunner } from './nextpnr-runner';
import { DiagramViewer } from './diagram-viewer';
import { FunctionInfo } from './types';
import { ParsedClashManifest } from './clash-manifest-types';
import { ToolchainChecker } from './toolchain';
import { initializeLogger, getLogger } from './file-logger';

// Output channel for logging
let outputChannel: vscode.OutputChannel;
let hlsClient: HLSClient;
let functionDetector: FunctionDetector;
let codeGenerator: CodeGenerator;
let clashCompiler: ClashCompiler;
let yosysRunner: YosysRunner;
let nextpnrRunner: NextpnrRunner;
let toolchain: ToolchainChecker;

export function activate(context: vscode.ExtensionContext) {
	// Create output channel for logging
	outputChannel = vscode.window.createOutputChannel('Clash Synthesis');
	context.subscriptions.push(outputChannel);

	// Initialize file logger for crash debugging
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders && workspaceFolders.length > 0) {
		const logger = initializeLogger(workspaceFolders[0].uri.fsPath);
		logger.info('Extension activating...');
		logger.info(`Workspace: ${workspaceFolders[0].uri.fsPath}`);
	}

	// Initialize HLS client and function detector
	hlsClient = new HLSClient(outputChannel);
	functionDetector = new FunctionDetector(hlsClient, outputChannel);
	codeGenerator = new CodeGenerator(outputChannel);
	clashCompiler = new ClashCompiler(outputChannel);
	yosysRunner = new YosysRunner(outputChannel);
	nextpnrRunner = new NextpnrRunner(outputChannel);
	toolchain = new ToolchainChecker(outputChannel);

	// Register commands
	registerCommands(context);

	outputChannel.appendLine('Clash Verilog Yosys Extension activated');
	outputChannel.appendLine('Make sure Haskell Language Server is running for full functionality');
	
	// Validate toolchain on activation (after a brief delay for direnv)
	if (workspaceFolders && workspaceFolders.length > 0) {
		const cwd = workspaceFolders[0].uri.fsPath;
		// Delay validation to give direnv time to activate
		setTimeout(async () => {
			await toolchain.checkAll(cwd);
			outputChannel.appendLine('');
			outputChannel.appendLine(toolchain.formatSummary());
		}, 2000);
	}
	
	const logger = getLogger();
	if (logger) {
		logger.info('Extension activated successfully');
		logger.info(`Debug log: ${logger.getLogPath()}`);
		vscode.window.showInformationMessage(
			`Clash extension loaded. Debug log: ${logger.getLogPath()}`,
			'OK'
		);
	}
}

function registerCommands(context: vscode.ExtensionContext) {
	// Detect Functions command
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.detectFunctions', async () => {
			await detectFunctionsCommand();
		})
	);

	// Synthesize Function command
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.synthesizeFunction', async () => {
			await synthesizeFunctionCommand();
		})
	);

	// Synthesize and Place & Route command
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.synthesizeAndPnR', async () => {
			await synthesizeAndPnRCommand();
		})
	);

	// Check toolchain availability
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.checkToolchain', async () => {
			const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			toolchain.clearCache();
			await toolchain.checkAll(cwd);
			outputChannel.show(true);
			outputChannel.appendLine('');
			outputChannel.appendLine(toolchain.formatSummary());
		})
	);
}

/**
 * Command: Detect Functions
 * Scans the current document or workspace for Haskell functions
 */
async function detectFunctionsCommand() {
	const logger = getLogger();
	
	try {
		if (logger) {
			await logger.operation('detectFunctionsCommand', 'Starting');
		}
		
		outputChannel.show(true);
		outputChannel.appendLine('='.repeat(60));
		outputChannel.appendLine('Detecting Functions...');
		outputChannel.appendLine('='.repeat(60));

		let functions: FunctionInfo[];

		// Check if there's an active editor with a Haskell file
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor && hlsClient.isHaskellDocument(activeEditor.document)) {
			// Detect in current document
			outputChannel.appendLine(`Scanning current document: ${activeEditor.document.fileName}`);
			if (logger) {
				await logger.debug(`Scanning document: ${activeEditor.document.fileName}`);
			}
			functions = await functionDetector.detectFunctions(activeEditor.document);
		} else {
			// Detect in all open documents
			outputChannel.appendLine('Scanning all open Haskell documents...');
			if (logger) {
				await logger.debug('Scanning all open documents');
			}
			functions = await functionDetector.detectFunctionsInWorkspace();
		}

		if (logger) {
			await logger.info(`Detected ${functions.length} functions`);
		}

		if (functions.length === 0) {
			vscode.window.showWarningMessage(
				'No functions detected. Make sure HLS is running and the file is properly indexed.'
			);
			outputChannel.appendLine('No functions found');
			if (logger) {
				await logger.warn('No functions found');
			}
			return;
		}

		// Show function picker
		if (logger) {
			await logger.debug(`Showing picker with ${functions.length} functions`);
		}
		
		const selected = await functionDetector.showFunctionPicker(functions);
		
		if (logger) {
			if (selected) {
				await logger.info(`User selected: ${selected.name}`);
			} else {
				await logger.debug('User cancelled picker');
			}
		}
		
		if (selected) {
			if (logger) {
				await logger.debug(`Analyzing function: ${selected.name}`);
			}
			
			outputChannel.appendLine('');
			outputChannel.appendLine('Selected Function Analysis:');
			outputChannel.appendLine('-'.repeat(60));
			outputChannel.appendLine(functionDetector.getAnalysis(selected));
			
			if (logger) {
				await logger.debug(`Is monomorphic: ${selected.isMonomorphic}`);
			}
			
			// If it's monomorphic, offer to synthesize
			if (selected.isMonomorphic) {
				if (logger) {
					await logger.debug('Showing synthesize confirmation dialog');
				}
				
				const action = await vscode.window.showInformationMessage(
					`${selected.name} is synthesizable. Would you like to synthesize it now?`,
					'Synthesize',
					'Cancel'
				);
				
				if (logger) {
					await logger.info(`User action: ${action || 'cancelled'}`);
				}
				
				if (action === 'Synthesize') {
					if (logger) {
						await logger.operation('Calling synthesizeFunction', `From detectFunctionsCommand`);
					}
					await synthesizeFunction(selected);
				}
			} else {
				if (logger) {
					await logger.info('Function is polymorphic - showing info message');
				}
				
				vscode.window.showInformationMessage(
					`${selected.name} is polymorphic and cannot be directly synthesized. ` +
					'Create a monomorphic wrapper function to synthesize it.'
				);
			}
		}
		
		if (logger) {
			await logger.operation('detectFunctionsCommand', 'Completed');
		}

	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`Error detecting functions: ${message}`);
		outputChannel.appendLine(`ERROR: ${message}`);
		
		const logger = getLogger();
		if (logger) {
			await logger.error('detectFunctionsCommand failed', error);
		}
	}
}

/**
 * Command: Synthesize Function
 * Prompts user to select a function and synthesizes it
 */
async function synthesizeFunctionCommand() {
	outputChannel.show(true);
	outputChannel.appendLine('='.repeat(60));
	outputChannel.appendLine('Synthesize Function');
	outputChannel.appendLine('='.repeat(60));

	try {
		// First detect functions
		let functions: FunctionInfo[];
		
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor && hlsClient.isHaskellDocument(activeEditor.document)) {
			functions = await functionDetector.detectFunctions(activeEditor.document);
		} else {
			functions = await functionDetector.detectFunctionsInWorkspace();
		}

		if (functions.length === 0) {
			vscode.window.showWarningMessage('No functions detected.');
			return;
		}

		// Filter to only synthesizable functions
		const synthesizable = functionDetector.filterSynthesizable(functions);
		
		if (synthesizable.length === 0) {
			vscode.window.showWarningMessage(
				'No monomorphic (synthesizable) functions found. All functions are polymorphic.'
			);
			outputChannel.appendLine('No synthesizable functions found');
			return;
		}

		// Show picker with only synthesizable functions
		const selected = await functionDetector.showFunctionPicker(synthesizable);
		
		if (selected) {
			await synthesizeFunction(selected);
		}

	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`Error: ${message}`);
		outputChannel.appendLine(`ERROR: ${message}`);
	}
}

/**
 * Synthesize a function to Verilog using Clash
 */
async function synthesizeFunction(func: FunctionInfo) {
	const logger = getLogger();
	
	if (logger) {
		await logger.operation('synthesizeFunction', `Function: ${func.name}`);
		await logger.debug(`Type: ${func.typeSignature}`);
		await logger.debug(`Module: ${func.moduleName}`);
	}
	
	outputChannel.appendLine('');
	outputChannel.appendLine('='.repeat(60));
	outputChannel.appendLine(`Synthesizing: ${func.name}`);
	outputChannel.appendLine('='.repeat(60));
	outputChannel.appendLine(`Module: ${func.moduleName}`);
	outputChannel.appendLine(`Type: ${func.typeSignature}`);
	outputChannel.appendLine('');
	
	// Validate function info
	if (!func.name || !func.typeSignature || !func.moduleName) {
		const error = 'Invalid function info: missing required fields';
		vscode.window.showErrorMessage(error);
		outputChannel.appendLine(`ERROR: ${error}`);
		if (logger) {
			await logger.error(error);
		}
		return;
	}
	
	try {
		if (logger) {
			await logger.debug('Getting workspace root...');
		}
		
		// Get workspace root
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error('No workspace folder open');
		}
		
		const workspaceRoot = workspaceFolders[0].uri.fsPath;
		
		if (logger) {
			await logger.debug(`Workspace root: ${workspaceRoot}`);
		}
		
		// Get configuration
		const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
		const autoCleanup = config.get<boolean>('autoCleanup', false);
		
		if (logger) {
			await logger.debug(`Auto cleanup: ${autoCleanup}`);
			await logger.operation('generateWrapper', 'Starting code generation');
		}
		
		// Generate wrapper module with new directory structure
		const projectDirs = CodeGenerator.getProjectDirectories(workspaceRoot, func);
		const genConfig: GenerationConfig = {
			outputDir: projectDirs.haskell,
			keepFiles: !autoCleanup,
			modulePrefix: 'ClashSynth_'
		};
		
		const result = await codeGenerator.generateWrapper(func, genConfig, workspaceRoot);
		
		// Ensure the synthesis cabal project is up to date so that
		// 'cabal run clash' inside it can resolve all dependencies.
		// Walk up from the source file to find its cabal project (if any).
		const synthInfo = await codeGenerator.ensureSynthProject(workspaceRoot, func.filePath);
		
		if (logger) {
			await logger.info(`Generated: ${result.filePath}`);
		}
		
		outputChannel.appendLine('');
		outputChannel.appendLine('✓ Code generation successful!');
		outputChannel.appendLine(`Generated module: ${result.moduleName}`);
		outputChannel.appendLine(`File: ${result.filePath}`);
		outputChannel.appendLine('');
		
		// Ask user if they want to open the generated file
		const action = await vscode.window.showInformationMessage(
			`Generated wrapper module: ${result.moduleName}.hs`,
			'Open File',
			'Compile with Clash',
			'Cancel'
		);
		
		if (action === 'Open File') {
			if (logger) {
				await logger.operation('openFile', `File: ${result.filePath}`);
			}
			
			try {
				// Use URI to avoid path resolution issues
				const uri = vscode.Uri.file(result.filePath);
				
				if (logger) {
					await logger.debug(`Opening URI: ${uri.toString()}`);
				}
				
				const document = await vscode.workspace.openTextDocument(uri);
				
				if (logger) {
					await logger.debug('Document loaded, showing in editor...');
				}
				
				await vscode.window.showTextDocument(document, {
					preview: false,
					preserveFocus: false
				});
				
				if (logger) {
					await logger.info('File opened successfully');
				}
			} catch (openError) {
				const msg = openError instanceof Error ? openError.message : String(openError);
				vscode.window.showErrorMessage(`Failed to open file: ${msg}`);
				outputChannel.appendLine(`ERROR opening file: ${msg}`);
				
				if (logger) {
					await logger.error('Failed to open file', openError);
				}
			}
		} else if (action === 'Compile with Clash') {
			if (logger) {
				await logger.operation('compileWithClash', `Module: ${result.moduleName}`);
			}
			
			outputChannel.appendLine('Starting Clash compilation...');
			outputChannel.show(true);
			
			// Show progress notification
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Compiling ${result.moduleName} with Clash`,
				cancellable: false
			}, async (progress) => {
				progress.report({ message: 'Running cabal run clash...' });
				
				try {
					const compileResult = await clashCompiler.compileToVerilog(
						result.filePath,
						{
							workspaceRoot,
							outputDir: projectDirs.root,
							moduleName: result.moduleName,
							hdlDir: projectDirs.verilog,
							synthProjectRoot: synthInfo.synthRoot,
							cabalProjectDir: synthInfo.cabalProjectDir ?? undefined
						}
					);
					
					if (logger) {
						await logger.info(`Compilation ${compileResult.success ? 'succeeded' : 'failed'}`);
					}
					
					if (compileResult.success && compileResult.verilogPath) {
						outputChannel.appendLine('');
						outputChannel.appendLine('='.repeat(60));
						outputChannel.appendLine('✓ Clash Compilation Successful!');
						outputChannel.appendLine('='.repeat(60));
						outputChannel.appendLine(`Verilog: ${compileResult.verilogPath}`);
						
						// Show warnings if any
						if (compileResult.warnings.length > 0) {
							outputChannel.appendLine('');
							outputChannel.appendLine('Warnings:');
							compileResult.warnings.forEach(w => outputChannel.appendLine(`  ${w}`));
						}
						
						// Ask what to do next
						const nextAction = await vscode.window.showInformationMessage(
							'Clash compilation successful!',
							'Open Verilog',
							'Synthesize with Yosys',
							'Done'
						);
						
						if (nextAction === 'Open Verilog') {
							const verilogUri = vscode.Uri.file(compileResult.verilogPath);
							const verilogDoc = await vscode.workspace.openTextDocument(verilogUri);
							await vscode.window.showTextDocument(verilogDoc);
						} else if (nextAction === 'Synthesize with Yosys') {
							// Run Yosys synthesis
							await synthesizeWithYosys(
								compileResult.verilogPath,
								result.moduleName,
								workspaceRoot,
								projectDirs.yosys,
								compileResult.manifest
							);
						}
					} else {
						outputChannel.appendLine('');
						outputChannel.appendLine('='.repeat(60));
						outputChannel.appendLine('✗ Clash Compilation Failed');
						outputChannel.appendLine('='.repeat(60));
						
						if (compileResult.errors.length > 0) {
							outputChannel.appendLine('Errors:');
							compileResult.errors.forEach(e => outputChannel.appendLine(`  ${e}`));
						}
						
						vscode.window.showErrorMessage(
							'Clash compilation failed. Check output channel for details.',
							'Show Output'
						).then(choice => {
							if (choice === 'Show Output') {
								outputChannel.show(true);
							}
						});
					}
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (logger) {
						await logger.error('Clash compilation error', error);
					}
					vscode.window.showErrorMessage(`Compilation error: ${msg}`);
					outputChannel.appendLine(`ERROR: ${msg}`);
				}
			});
		}
		
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`Synthesis failed: ${message}`);
		outputChannel.appendLine(`ERROR: ${message}`);
		if (error instanceof Error && error.stack) {
			outputChannel.appendLine(error.stack);
		}
		
		const logger = getLogger();
		if (logger) {
			await logger.error('Synthesis failed', error);
		}
	}
}

/**
 * Synthesize Verilog with Yosys
 */
async function synthesizeWithYosys(
	verilogPath: string,
	moduleName: string,
	workspaceRoot: string,
	yosysOutputDir: string,
	manifest?: ParsedClashManifest
) {
	const logger = getLogger();
	
	// Check that yosys is available
	const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
	const yosysCmd = config.get<string>('yosysCommand', 'yosys');
	if (!(await toolchain.require('yosys', yosysCmd, '-V', workspaceRoot))) {
		return;
	}
	
	if (logger) {
		await logger.operation('synthesizeWithYosys', `Module: ${moduleName}`);
	}
	
	outputChannel.show(true);
	
	// Show progress notification
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `Synthesizing ${moduleName} with Yosys`,
		cancellable: false
	}, async (progress) => {
		progress.report({ message: 'Running yosys synthesis...' });
		
		try {
			// Yosys output directory is passed directly
			
			// Determine top module name
			// Prefer manifest top_component.name, fall back to filename
			let topModule: string;
			if (manifest && manifest.top_component && manifest.top_component.name) {
				topModule = manifest.top_component.name;
				outputChannel.appendLine(`Using top module from manifest: ${topModule}`);
			} else {
				topModule = path.basename(verilogPath, '.v');
				outputChannel.appendLine(`Using top module from filename: ${topModule}`);
			}
			
			// Run Yosys synthesis
			const synthResult = await yosysRunner.synthesize({
				workspaceRoot,
				outputDir: yosysOutputDir,
				topModule,
				verilogPath,
				targetFamily: 'generic' // Generic synthesis for now
			});
			
			if (logger) {
				await logger.info(`Yosys synthesis ${synthResult.success ? 'succeeded' : 'failed'}`);
			}
			
			if (synthResult.success) {
				outputChannel.appendLine('');
				outputChannel.appendLine('='.repeat(60));
				outputChannel.appendLine('✓ Yosys Synthesis Successful!');
				outputChannel.appendLine('='.repeat(60));
				
				// Display statistics
				if (synthResult.statistics) {
					const stats = synthResult.statistics;
					outputChannel.appendLine('');
					outputChannel.appendLine('Synthesis Statistics:');
					outputChannel.appendLine('-'.repeat(40));
					
					if (stats.cellCount !== undefined) {
						outputChannel.appendLine(`  Cells: ${stats.cellCount}`);
					}
					if (stats.wireCount !== undefined) {
						outputChannel.appendLine(`  Wires: ${stats.wireCount}`);
					}
					if (stats.chipArea !== undefined) {
						outputChannel.appendLine(`  Area: ${stats.chipArea}`);
					}
					
					if (stats.cellTypes && stats.cellTypes.size > 0) {
						outputChannel.appendLine('');
						outputChannel.appendLine('  Cell Types:');
						stats.cellTypes.forEach((count, type) => {
							outputChannel.appendLine(`    ${type}: ${count}`);
						});
					}
				}
				
				if (synthResult.synthesizedVerilogPath) {
					outputChannel.appendLine('');
					outputChannel.appendLine(`Synthesized Verilog: ${synthResult.synthesizedVerilogPath}`);
				}
				
				if (synthResult.jsonPath) {
					outputChannel.appendLine(`JSON output: ${synthResult.jsonPath}`);
				}
				
				// Show warnings if any
				if (synthResult.warnings.length > 0) {
					outputChannel.appendLine('');
					outputChannel.appendLine(`Warnings (${synthResult.warnings.length}):`);
					synthResult.warnings.forEach(w => 
						outputChannel.appendLine(`  ${w.message}`)
					);
				}
				
				// Ask what to do next
				const actions = ['View Interactive Circuit', 'Open Synthesized Verilog', 'View Statistics', 'Done'];
				
				const nextAction = await vscode.window.showInformationMessage(
					`Synthesis complete! Cells: ${synthResult.statistics?.cellCount || 'N/A'}, Wires: ${synthResult.statistics?.wireCount || 'N/A'}`,
					...actions
				);
				
				if (nextAction === 'View Interactive Circuit') {
					// Pass the directory containing Verilog files
					const verilogDir = path.dirname(verilogPath);
					await DiagramViewer.showDiagram(
						verilogDir,
						topModule,
						outputChannel
					);
				} else if (nextAction === 'Open Synthesized Verilog' && synthResult.synthesizedVerilogPath) {
					const uri = vscode.Uri.file(synthResult.synthesizedVerilogPath);
					const doc = await vscode.workspace.openTextDocument(uri);
					await vscode.window.showTextDocument(doc);
				} else if (nextAction === 'View Statistics' && synthResult.statistics) {
					// Show statistics in a more detailed way
					const statsText = synthResult.statistics.rawStats || 'No detailed statistics available';
					const doc = await vscode.workspace.openTextDocument({
						content: statsText,
						language: 'plaintext'
					});
					await vscode.window.showTextDocument(doc, { preview: true });
				}
			} else {
				outputChannel.appendLine('');
				outputChannel.appendLine('='.repeat(60));
				outputChannel.appendLine('✗ Yosys Synthesis Failed');
				outputChannel.appendLine('='.repeat(60));
				
				if (synthResult.errors.length > 0) {
					outputChannel.appendLine('Errors:');
					synthResult.errors.forEach(e => outputChannel.appendLine(`  ${e.message}`));
				}
				
				vscode.window.showErrorMessage(
					'Yosys synthesis failed. Check output channel for details.',
					'Show Output'
				).then(choice => {
					if (choice === 'Show Output') {
						outputChannel.show(true);
					}
				});
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (logger) {
				await logger.error('Yosys synthesis error', error);
			}
			vscode.window.showErrorMessage(`Synthesis error: ${msg}`);
			outputChannel.appendLine(`ERROR: ${msg}`);
		}
	});
}

/**
 * Command: Synthesize and Place & Route
 * Full FPGA workflow: detect function, generate wrapper, compile to Verilog, 
 * synthesize with Yosys, and place & route with nextpnr
 */
async function synthesizeAndPnRCommand() {
	const logger = getLogger();
	
	try {
		if (logger) {
			await logger.operation('synthesizeAndPnRCommand', 'Starting');
		}
		
		// Check required tools up front (cabal is checked implicitly via the synth project)
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const cfg = vscode.workspace.getConfiguration('clash-vscode-yosys');
		const yosysCmd = cfg.get<string>('yosysCommand', 'yosys');
		
		if (!(await toolchain.require('yosys', yosysCmd, '-V', workspaceRoot))) { return; }
		if (!(await toolchain.require('nextpnr-ecp5', 'nextpnr-ecp5', '--version', workspaceRoot))) { return; }
		
		outputChannel.show(true);
		outputChannel.appendLine('='.repeat(60));
		outputChannel.appendLine('Full FPGA Synthesis & Place-and-Route');
		outputChannel.appendLine('='.repeat(60));

		// Get workspace folder
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0 || !workspaceRoot) {
			vscode.window.showErrorMessage('No workspace folder open');
			return;
		}

		// After the guard, workspaceRoot is definitely a string
		const wsRoot = workspaceRoot;

		// Step 1: Detect functions
		outputChannel.appendLine('\n=== Step 1: Detecting Functions ===');
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor || !hlsClient.isHaskellDocument(activeEditor.document)) {
			vscode.window.showErrorMessage('Please open a Haskell file first');
			return;
		}

		const functions = await functionDetector.detectFunctions(activeEditor.document);
		if (functions.length === 0) {
			vscode.window.showWarningMessage('No monomorphic functions found to synthesize');
			return;
		}

		// Step 2: Let user pick a function
		const functionItems = functions.map(f => ({
			label: f.name,
			description: f.typeSignature || 'no type signature',
			detail: `at ${f.filePath}:${f.range.start.line}`,
			function: f
		}));

		const selected = await vscode.window.showQuickPick(functionItems, {
			placeHolder: 'Select function to synthesize and implement on FPGA'
		});

		if (!selected) {
			return;
		}

		const func = selected.function;
		outputChannel.appendLine(`Selected: ${func.name} :: ${func.typeSignature}`);

		// Step 3: Get ECP5 chip configuration
		const deviceOptions = [
			{ label: 'LFE5U-25F (25k LUTs)', value: '25k', description: 'Small ECP5' },
			{ label: 'LFE5U-45F (45k LUTs)', value: '45k', description: 'Medium ECP5' },
			{ label: 'LFE5U-85F (85k LUTs)', value: '85k', description: 'Large ECP5' }
		];

		const deviceChoice = await vscode.window.showQuickPick(deviceOptions, {
			placeHolder: 'Select target ECP5 device'
		});

		if (!deviceChoice) {
			return;
		}

		const packageOptions = [
			{ label: 'CABGA381', value: 'CABGA381' },
			{ label: 'CABGA554', value: 'CABGA554' },
			{ label: 'CABGA756', value: 'CABGA756' }
		];

		const packageChoice = await vscode.window.showQuickPick(packageOptions, {
			placeHolder: 'Select package type'
		});

		if (!packageChoice) {
			return;
		}

		// Full workflow
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Implementing ${func.name} on ECP5`,
			cancellable: false
		}, async (progress) => {
			// Get project directory structure
			const projectDirs = CodeGenerator.getProjectDirectories(workspaceRoot, func);
			
			// Step 4: Generate wrapper
			progress.report({ message: 'Generating Clash wrapper...', increment: 10 });
			outputChannel.appendLine('\n=== Step 2: Generating Clash Wrapper ===');
			
			const genConfig: GenerationConfig = {
				outputDir: projectDirs.haskell,
				keepFiles: true,
				modulePrefix: 'ClashSynth_'
			};
			const wrapperResult = await codeGenerator.generateWrapper(func, genConfig, wsRoot);

			outputChannel.appendLine(`✓ Generated: ${wrapperResult.filePath}`);

			// Ensure synthesis cabal project is up to date
			const pnrSynthInfo = await codeGenerator.ensureSynthProject(wsRoot, func.filePath);

			// Step 5: Compile with Clash
			progress.report({ message: 'Compiling to Verilog with Clash...', increment: 20 });
			outputChannel.appendLine('\n=== Step 3: Compiling with Clash ===');

			const compileResult = await clashCompiler.compileToVerilog(
				wrapperResult.filePath,
				{
					workspaceRoot: wsRoot,
					outputDir: projectDirs.root,
					moduleName: wrapperResult.moduleName,
					hdlDir: projectDirs.verilog,
					synthProjectRoot: pnrSynthInfo.synthRoot,
					cabalProjectDir: pnrSynthInfo.cabalProjectDir ?? undefined
				}
			);

			if (!compileResult.success) {
				throw new Error(`Clash compilation failed`);
			}

			outputChannel.appendLine(`✓ Verilog generated: ${compileResult.verilogPath}`);

			// Step 6: Synthesize with Yosys
			progress.report({ message: 'Synthesizing with Yosys...', increment: 30 });
			outputChannel.appendLine('\n=== Step 4: Synthesizing with Yosys ===');

			// Determine top module name
			// Prefer manifest top_component.name, fall back to filename
			let topModule: string;
			if (compileResult.manifest && compileResult.manifest.top_component && compileResult.manifest.top_component.name) {
				topModule = compileResult.manifest.top_component.name;
				outputChannel.appendLine(`Using top module from manifest: ${topModule}`);
			} else {
				topModule = path.basename(compileResult.verilogPath!, '.v');
				outputChannel.appendLine(`Using top module from filename: ${topModule}`);
			}

			// Use all Verilog files from manifest if available (includes dependencies)
			// Otherwise fall back to single file
			const verilogInput = compileResult.allVerilogFiles || compileResult.verilogPath!;

			const synthResult = await yosysRunner.synthesize({
				workspaceRoot: wsRoot,
				outputDir: projectDirs.yosys,
				topModule,
				verilogPath: verilogInput,
				targetFamily: 'ecp5'
			});

			if (!synthResult.success) {
				throw new Error('Yosys synthesis failed');
			}

			outputChannel.appendLine('✓ Synthesis successful');

			// Step 7: Place & Route with nextpnr
			progress.report({ message: 'Place and Route with nextpnr...', increment: 60 });
			outputChannel.appendLine('\n=== Step 5: Place & Route with nextpnr ===');

			if (!synthResult.jsonPath) {
				throw new Error('No JSON output from Yosys');
			}

			const pnrResult = await nextpnrRunner.placeAndRoute({
				family: 'ecp5',
				jsonPath: synthResult.jsonPath,
				outputDir: projectDirs.nextpnr,
				topModule,
				ecp5: {
					device: deviceChoice.value as any,
					package: packageChoice.value as any,
					speedGrade: '6'
				}
			});

			if (!pnrResult.success) {
				throw new Error('Place and route failed');
			}

			// Display results
			progress.report({ message: 'Complete!', increment: 100 });
			outputChannel.appendLine('');
			outputChannel.appendLine('='.repeat(60));
			outputChannel.appendLine('✓ FPGA Implementation Complete!');
			outputChannel.appendLine('='.repeat(60));
			outputChannel.appendLine('');
			outputChannel.appendLine('Output Files:');
			outputChannel.appendLine(`  Verilog:   ${compileResult.verilogPath}`);
			outputChannel.appendLine(`  Synthesis: ${synthResult.synthesizedVerilogPath}`);
			outputChannel.appendLine(`  Config:    ${pnrResult.textcfgPath}`);
			if (pnrResult.bitstreamPath) {
				outputChannel.appendLine(`  Bitstream: ${pnrResult.bitstreamPath}`);
			}

			// Display timing
			if (pnrResult.timing) {
				const t = pnrResult.timing;
				outputChannel.appendLine('');
				outputChannel.appendLine('Timing Analysis:');
				outputChannel.appendLine('-'.repeat(40));
				if (t.prePlacementFrequency) {
					outputChannel.appendLine(`  Pre-Routing:   ${t.prePlacementFrequency.toFixed(2)} MHz (estimate)`);
				}
				if (t.maxFrequency) {
					outputChannel.appendLine(`  Max Frequency: ${t.maxFrequency.toFixed(2)} MHz (actual)`);
				}
				if (t.criticalPathDelay) {
					outputChannel.appendLine(`  Critical Path: ${t.criticalPathDelay.toFixed(2)} ns`);
				}
				outputChannel.appendLine(`  Constraints: ${t.constraintsMet ? '✓ MET' : '✗ FAILED'}`);
			}

			// Display utilization
			if (pnrResult.utilization) {
				const u = pnrResult.utilization;
				outputChannel.appendLine('');
				outputChannel.appendLine('Resource Utilization:');
				outputChannel.appendLine('-'.repeat(40));
				if (u.luts) {
					const pct = ((u.luts.used / u.luts.total) * 100).toFixed(1);
					outputChannel.appendLine(`  LUTs:      ${u.luts.used}/${u.luts.total} (${pct}%)`);
				}
				if (u.registers) {
					const pct = ((u.registers.used / u.registers.total) * 100).toFixed(1);
					outputChannel.appendLine(`  Registers: ${u.registers.used}/${u.registers.total} (${pct}%)`);
				}
				if (u.bram) {
					const pct = ((u.bram.used / u.bram.total) * 100).toFixed(1);
					outputChannel.appendLine(`  BRAM:      ${u.bram.used}/${u.bram.total} (${pct}%)`);
				}
				if (u.io) {
					const pct = ((u.io.used / u.io.total) * 100).toFixed(1);
					outputChannel.appendLine(`  IO:        ${u.io.used}/${u.io.total} (${pct}%)`);
				}
			}

			const action = await vscode.window.showInformationMessage(
				`✓ FPGA implementation complete! Bitstream: ${path.basename(pnrResult.bitstreamPath || '')}`,
				'View Interactive Circuit',
				'Open Bitstream Folder'
			);
			
			if (action === 'View Interactive Circuit') {
				// Use manifest files if available, otherwise fall back to directory scan
				const verilogSource = compileResult.allVerilogFiles || path.dirname(compileResult.verilogPath!);
				await DiagramViewer.showDiagram(
					verilogSource,
					topModule,
					outputChannel
				);
			} else if (action === 'Open Bitstream Folder') {
				const uri = vscode.Uri.file(projectDirs.nextpnr);
				await vscode.commands.executeCommand('revealFileInOS', uri);
			}
		});

	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (logger) {
			await logger.error('Synthesis and PnR error', error);
		}
		vscode.window.showErrorMessage(`Implementation error: ${msg}`);
		outputChannel.appendLine(`ERROR: ${msg}`);
	}
}

export function deactivate() {
	const logger = getLogger();
	if (logger) {
		logger.info('Extension deactivating...');
	}
	
	if (outputChannel) {
		outputChannel.dispose();
	}
	
	if (logger) {
		logger.info('Extension deactivated');
	}
}

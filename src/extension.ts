import * as vscode from 'vscode';
import * as path from 'path';
import { HLSClient } from './hls-client';
import { FunctionDetector } from './function-detector';
import { CodeGenerator, GenerationConfig } from './code-generator';
import { ClashCompiler, ClashCompilationResult } from './clash-compiler';
import { YosysRunner } from './yosys-runner';
import { NextpnrRunner } from './nextpnr-runner';
import { ECP5Device, ECP5Package } from './nextpnr-types';
import { FunctionInfo } from './types';
import { ClashManifestParser } from './clash-manifest-parser';
import { ToolchainChecker } from './toolchain';
import { initializeLogger, getLogger } from './file-logger';
import { ClashCodeActionProvider } from './clash-code-actions';
import { SynthesisResultsPanel } from './synthesis-results-panel';
import { SynthesisResultsTreeProvider } from './synthesis-results-tree';
import { HaskellFunctionsTreeProvider, FunctionNode } from './haskell-functions-tree';

// Output channel for logging
let outputChannel: vscode.OutputChannel;
let synthesisTreeProvider: SynthesisResultsTreeProvider;
let haskellFunctionsTreeProvider: HaskellFunctionsTreeProvider;
let haskellFunctionsTreeView: vscode.TreeView<import('./haskell-functions-tree').FunctionTreeNode>;
let extensionPath: string;
let hlsClient: HLSClient;
let functionDetector: FunctionDetector;
let codeGenerator: CodeGenerator;
let clashCompiler: ClashCompiler;
let yosysRunner: YosysRunner;
let nextpnrRunner: NextpnrRunner;
let toolchain: ToolchainChecker;

export function activate(context: vscode.ExtensionContext) {
	extensionPath = context.extensionUri.fsPath;

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

	// Register sidebar tree view for synthesis results
	synthesisTreeProvider = new SynthesisResultsTreeProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			'clash-vscode-yosys.synthesisResults',
			synthesisTreeProvider
		)
	);

	// Register sidebar tree view for Haskell functions.
	// createTreeView (instead of registerTreeDataProvider) gives us a .selection
	// property so title-bar buttons can read the currently selected function.
	haskellFunctionsTreeProvider = new HaskellFunctionsTreeProvider();
	haskellFunctionsTreeView = vscode.window.createTreeView(
		'clash-vscode-yosys.haskellFunctions',
		{ treeDataProvider: haskellFunctionsTreeProvider }
	);
	context.subscriptions.push(haskellFunctionsTreeView);

	// Refresh functions view when active editor changes to a Haskell file
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor && hlsClient.isHaskellDocument(editor.document)) {
				refreshHaskellFunctionsTree(editor.document);
			} else if (!editor || !hlsClient.isHaskellDocument(editor.document)) {
				haskellFunctionsTreeProvider.clear();
			}
		})
	);

	// Refresh functions view when a Haskell file is saved
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument(doc => {
			if (hlsClient.isHaskellDocument(doc) &&
				vscode.window.activeTextEditor?.document === doc) {
				refreshHaskellFunctionsTree(doc);
			}
		})
	);

	// Seed with the already-open file (if any)
	if (vscode.window.activeTextEditor &&
		hlsClient.isHaskellDocument(vscode.window.activeTextEditor.document)) {
		refreshHaskellFunctionsTree(vscode.window.activeTextEditor.document);
	}

	// Command: (re-)open the synthesis results panel from the sidebar
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.openResultsPanel', () => {
			SynthesisResultsPanel.reopen();
		})
	);

	// Command: refresh the Haskell functions tree manually
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.refreshHaskellFunctions', () => {
			const editor = vscode.window.activeTextEditor;
			if (editor && hlsClient.isHaskellDocument(editor.document)) {
				refreshHaskellFunctionsTree(editor.document);
			}
		})
	);

	// Command: open diagram viewer for a specific module (inline tree action)
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.viewModuleDiagram', (item) => {
			const moduleName: string | undefined = item?.result?.name;
			SynthesisResultsPanel.reopen(moduleName);
		})
	);

	// Command: navigate to a function (used by tree item clicks)
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.goToFunction', async (info) => {
			if (!info?.filePath || !info?.range) { return; }
			const uri = vscode.Uri.file(info.filePath);
			const doc = await vscode.workspace.openTextDocument(uri);
			const editor = await vscode.window.showTextDocument(doc);
			const start = new vscode.Position(
				info.range.start.line,
				info.range.start.character
			);
			editor.selection = new vscode.Selection(start, start);
			editor.revealRange(
				new vscode.Range(start, start),
				vscode.TextEditorRevealType.InCenterIfOutsideViewport
			);
		})
	);

	// Command: run the extension's test suite in an integrated terminal
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.runTests', () => {
			const terminal = vscode.window.createTerminal({
				name: 'Clash Extension Tests',
				cwd: extensionPath
			});
			terminal.sendText('npm run compile && npm test');
			terminal.show();
		})
	);

	// Register commands
	registerCommands(context);

	// Register code action provider for Haskell files
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			{ language: 'haskell', scheme: 'file' },
			new ClashCodeActionProvider(functionDetector),
			{ providedCodeActionKinds: ClashCodeActionProvider.providedCodeActionKinds }
		)
	);

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

/**
 * Detect functions in the given document and update the Haskell functions
 * sidebar tree.  Shows a loading spinner while HLS analysis is running.
 * Silently ignores errors (HLS may not be ready yet).
 */
async function refreshHaskellFunctionsTree(doc: vscode.TextDocument): Promise<void> {
	haskellFunctionsTreeProvider.setLoading(doc.fileName);
	try {
		const functions = await functionDetector.detectFunctions(doc);
		haskellFunctionsTreeProvider.refresh(functions, doc.fileName);
	} catch {
		// HLS not ready — leave the loading state shown so the user knows
		// something was attempted; they can hit Refresh once HLS is up.
		haskellFunctionsTreeProvider.refresh([], doc.fileName);
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
		vscode.commands.registerCommand('clash-vscode-yosys.synthesizeFunction', async (arg?: unknown) => {
			await synthesizeFunctionCommand(unwrapFuncArg(arg));
		})
	);

	// Synthesize and Place & Route command
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.synthesizeAndPnR', async (arg?: unknown) => {
			await synthesizeAndPnRCommand(unwrapFuncArg(arg));
		})
	);

	// Synthesize Only command (no PnR)
	context.subscriptions.push(
		vscode.commands.registerCommand('clash-vscode-yosys.synthesizeOnly', async (arg?: unknown) => {
			await synthesizeOnlyCommand(unwrapFuncArg(arg));
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
					await synthesizeOnlyCommand(selected);
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

// ── Shared pipeline helpers ──────────────────────────────────────────────────

type ProgressReporter = vscode.Progress<{ message?: string; increment?: number }>;

interface CompilationOutput {
	wrapperResult: { filePath: string; moduleName: string };
	compileResult: ClashCompilationResult;
	projectDirs: ReturnType<typeof CodeGenerator.getProjectDirectories>;
	topModule: string;
	verilogInput: string | string[];
}

interface SynthesisOutput {
	synthResult: import('./yosys-types').YosysSynthesisResult;
	moduleResults: import('./yosys-types').ModuleSynthesisResult[];
	topModule: string;
	sdcFrequencyMHz: number | undefined;
	projectDirs: CompilationOutput['projectDirs'];
}

/**
 * When view/title toolbar buttons are clicked, VS Code passes the focused tree
 * item as the first argument.  Unwrap FunctionNode → FunctionInfo; pass through
 * a real FunctionInfo unchanged; return undefined for anything else.
 */
function unwrapFuncArg(arg: unknown): FunctionInfo | undefined {
	if (arg instanceof FunctionNode) { return arg.info; }
	// A real FunctionInfo has a string `name` and a `range` object.
	if (arg && typeof (arg as FunctionInfo).name === 'string' && (arg as FunctionInfo).range) {
		return arg as FunctionInfo;
	}
	return undefined;
}

/**
 * Resolve which function to synthesize.
 *
 * Priority order:
 *   1. `providedFunc` — explicit argument (e.g. from a code-action).
 *   2. Selected item in the Haskell Functions tree view.
 *   3. QuickPick over functions detected in the active editor.
 */
async function pickFunction(providedFunc?: FunctionInfo): Promise<FunctionInfo | undefined> {
	if (providedFunc) { return providedFunc; }

	// Check the Haskell Functions tree selection first — this is what the title-bar
	// buttons should use when the user has highlighted a function in the sidebar.
	const treeSelection = haskellFunctionsTreeView?.selection[0];
	if (treeSelection instanceof FunctionNode) {
		return treeSelection.info;
	}

	const activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor || !hlsClient.isHaskellDocument(activeEditor.document)) {
		vscode.window.showErrorMessage('Please select a function in the Haskell Functions panel or open a Haskell file');
		return undefined;
	}

	const functions = await functionDetector.detectFunctions(activeEditor.document);
	if (functions.length === 0) {
		vscode.window.showWarningMessage('No functions found to synthesize');
		return undefined;
	}

	const items = functions.map(f => ({
		label: f.name,
		description: f.typeSignature || 'no type signature',
		detail: `${f.filePath}:${f.range.start.line}`,
		function: f
	}));

	const sel = await vscode.window.showQuickPick(items, { placeHolder: 'Select function to synthesize' });
	return sel?.function;
}

/**
 * Step 1 of the pipeline: generate the Clash wrapper and compile to Verilog.
 */
async function runClashCompilation(
	func: FunctionInfo,
	wsRoot: string,
	progress: ProgressReporter
): Promise<CompilationOutput> {
	const projectDirs = CodeGenerator.getProjectDirectories(wsRoot, func);
	const genConfig: GenerationConfig = { keepFiles: true, modulePrefix: 'ClashSynth_' };

	progress.report({ message: 'Generating Clash wrapper…', increment: 10 });
	outputChannel.appendLine('\n=== Step 1: Generating Clash Wrapper ===');
	const wrapperResult = await codeGenerator.generateWrapper(func, genConfig, wsRoot);
	outputChannel.appendLine(`✓ Generated: ${wrapperResult.filePath}`);

	const synthInfo = await codeGenerator.ensureSynthProject(wsRoot, func.filePath);

	progress.report({ message: 'Compiling to Verilog with Clash…', increment: 20 });
	outputChannel.appendLine('\n=== Step 2: Compiling with Clash ===');

	const compileResult = await clashCompiler.compileToVerilog(wrapperResult.filePath, {
		workspaceRoot: wsRoot,
		outputDir: projectDirs.root,
		moduleName: wrapperResult.moduleName,
		hdlDir: projectDirs.verilog,
		synthProjectRoot: synthInfo.synthRoot,
		cabalProjectDir: synthInfo.cabalProjectDir ?? undefined
	});

	if (!compileResult.success) {
		if (compileResult.errors.length > 0) {
			outputChannel.appendLine('Errors:');
			compileResult.errors.forEach(e => outputChannel.appendLine(`  ${e}`));
		}
		throw new Error('Clash compilation failed — check the output channel for details');
	}
	outputChannel.appendLine(`✓ Verilog: ${compileResult.verilogPath}`);

	const topModule = compileResult.manifest?.top_component?.name
		?? path.basename(compileResult.verilogPath!, '.v');
	const verilogInput = compileResult.allVerilogFiles ?? compileResult.verilogPath!;

	return { wrapperResult, compileResult, projectDirs, topModule, verilogInput };
}

/**
 * Step 2 of the pipeline: synthesize with Yosys.
 *
 * Always returns a non-empty `moduleResults` array — even for whole-design
 * synthesis where Yosys only produces a single top-level JSON — so the
 * diagram panel always has data to display.
 */
async function runYosynsSynthesis(
	compiled: CompilationOutput,
	wsRoot: string,
	synthesisMode: string,
	targetFamily: 'ecp5' | 'generic',
	progress: ProgressReporter
): Promise<SynthesisOutput> {
	const { compileResult, projectDirs, topModule, verilogInput } = compiled;

	progress.report({ message: 'Synthesizing with Yosys…', increment: 40 });
	outputChannel.appendLine('\n=== Step 3: Synthesizing with Yosys ===');
	outputChannel.appendLine(`Mode: ${synthesisMode}`);

	let synthResult: import('./yosys-types').YosysSynthesisResult;

	if (compileResult.manifest) {
		const manifestParser = new ClashManifestParser();
		const components = await manifestParser.buildDependencyGraph(compileResult.manifest.manifestPath);

		if (synthesisMode === 'per-module' && components.length > 1) {
			synthResult = await yosysRunner.synthesizePerModule(components, {
				workspaceRoot: wsRoot, outputDir: projectDirs.yosys,
				topModule, verilogPath: verilogInput, targetFamily
			});
		} else {
			synthResult = await yosysRunner.synthesizeParallel(components, {
				workspaceRoot: wsRoot, outputDir: projectDirs.yosys,
				topModule, verilogPath: verilogInput, targetFamily
			});
		}
	} else {
		synthResult = await yosysRunner.synthesize({
			workspaceRoot: wsRoot, outputDir: projectDirs.yosys,
			topModule, verilogPath: verilogInput, targetFamily
		});
	}

	if (!synthResult.success) {
		if (synthResult.errors.length > 0) {
			outputChannel.appendLine('Errors:');
			synthResult.errors.forEach(e => outputChannel.appendLine(`  ${e.message}`));
		}
		throw new Error('Yosys synthesis failed — check the output channel for details');
	}
	outputChannel.appendLine('✓ Synthesis complete');

	if (synthResult.statistics) {
		outputChannel.appendLine(`  Cells: ${synthResult.statistics.cellCount ?? 'N/A'}`);
		outputChannel.appendLine(`  Wires: ${synthResult.statistics.wireCount ?? 'N/A'}`);
	}

	// Parse SDC target frequency if available.
	let sdcFrequencyMHz: number | undefined;
	if (compileResult.manifest) {
		sdcFrequencyMHz = await new ClashManifestParser()
			.parseSdcFrequency(compileResult.manifest.directory);
		if (sdcFrequencyMHz) {
			outputChannel.appendLine(`  SDC target: ${sdcFrequencyMHz.toFixed(2)} MHz`);
		}
	}

	// Normalise into ModuleSynthesisResult[] so the panel always has data.
	const moduleResults: import('./yosys-types').ModuleSynthesisResult[] =
		synthResult.moduleResults ?? [{
			name: topModule,
			success: synthResult.success,
			diagramJsonPath: synthResult.jsonPath,
			elapsedMs: 0,
			statistics: synthResult.statistics,
			errors: synthResult.errors
		}];

	return { synthResult, moduleResults, topModule, sdcFrequencyMHz, projectDirs };
}

// ── Commands ─────────────────────────────────────────────────────────────────

/**
 * Command: Generate Verilog
 * Generates the Clash wrapper and compiles to Verilog, then shows the result.
 */
async function synthesizeFunctionCommand(providedFunc?: FunctionInfo) {
	const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!wsRoot) { vscode.window.showErrorMessage('No workspace folder open'); return; }

	const func = await pickFunction(providedFunc);
	if (!func) { return; }

	outputChannel.show(true);
	outputChannel.appendLine('='.repeat(60));
	outputChannel.appendLine(`Generate Verilog: ${func.name}`);
	outputChannel.appendLine('='.repeat(60));

	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Compiling ${func.name} to Verilog`,
			cancellable: false
		}, async (progress) => {
			const { compileResult } = await runClashCompilation(func, wsRoot, progress);
			progress.report({ message: 'Done', increment: 100 });

			outputChannel.appendLine('');
			outputChannel.appendLine('='.repeat(60));
			outputChannel.appendLine('✓ Verilog generated!');
			outputChannel.appendLine('='.repeat(60));
			if (compileResult.warnings.length > 0) {
				outputChannel.appendLine('Warnings:');
				compileResult.warnings.forEach(w => outputChannel.appendLine(`  ${w}`));
			}

			const action = await vscode.window.showInformationMessage(
				`Verilog generated: ${path.basename(compileResult.verilogPath ?? '')}`,
				'Open Verilog', 'Done'
			);
			if (action === 'Open Verilog' && compileResult.verilogPath) {
				const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(compileResult.verilogPath));
				await vscode.window.showTextDocument(doc);
			}
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`Verilog generation failed: ${msg}`);
		outputChannel.appendLine(`ERROR: ${msg}`);
	}
}

/**
 * Command: Synthesize (no Place & Route)
 * Calls runClashCompilation → runYosynsSynthesis, then always opens the
 * diagram panel so the user gets circuit visualisations.
 */
async function synthesizeOnlyCommand(providedFunc?: FunctionInfo) {
	const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!wsRoot) { vscode.window.showErrorMessage('No workspace folder open'); return; }

	const cfg = vscode.workspace.getConfiguration('clash-vscode-yosys');
	if (!(await toolchain.require('yosys', cfg.get<string>('yosysCommand', 'yosys'), '-V', wsRoot))) { return; }

	const func = await pickFunction(providedFunc);
	if (!func) { return; }

	outputChannel.show(true);
	outputChannel.appendLine('='.repeat(60));
	outputChannel.appendLine(`Synthesize: ${func.name}`);
	outputChannel.appendLine('='.repeat(60));

	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Synthesizing ${func.name}`,
			cancellable: false
		}, async (progress) => {
			const compiled = await runClashCompilation(func, wsRoot, progress);
			const { synthResult, moduleResults, topModule, sdcFrequencyMHz } =
				await runYosynsSynthesis(
					compiled, wsRoot,
					cfg.get<string>('synthesisMode', 'per-module'),
					'ecp5', progress
				);

			progress.report({ message: 'Done', increment: 100 });
			outputChannel.appendLine('');
			outputChannel.appendLine('='.repeat(60));
			outputChannel.appendLine('✓ Synthesis Complete!');
			outputChannel.appendLine('='.repeat(60));
			if (sdcFrequencyMHz) {
				outputChannel.appendLine(`  Target: ${sdcFrequencyMHz.toFixed(2)} MHz`);
			}
			if (moduleResults.length > 1) {
				outputChannel.appendLine('');
				outputChannel.appendLine('Per-Module Results:');
				for (const mr of moduleResults) {
					const cells = mr.statistics?.cellCount !== undefined ? `${mr.statistics.cellCount} cells` : 'no cell count';
					const wires = mr.statistics?.wireCount !== undefined ? `, ${mr.statistics.wireCount} wires` : '';
					outputChannel.appendLine(`  ${mr.success ? '✓' : '✗'} ${mr.name}: ${cells}${wires}  [${mr.elapsedMs}ms]`);
				}
			}

			// Always open the diagram panel — single-module or multi-module.
			SynthesisResultsPanel.show(moduleResults, `Synthesis Results — ${topModule}`, outputChannel);
			synthesisTreeProvider.refresh(moduleResults);

			const action = await vscode.window.showInformationMessage(
				`Synthesis complete! Cells: ${synthResult.statistics?.cellCount ?? 'N/A'}`,
				'Open Synthesized Verilog', 'Done'
			);
			if (action === 'Open Synthesized Verilog' && synthResult.synthesizedVerilogPath) {
				const doc = await vscode.workspace.openTextDocument(
					vscode.Uri.file(synthResult.synthesizedVerilogPath)
				);
				await vscode.window.showTextDocument(doc);
			}
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`Synthesis error: ${msg}`);
		outputChannel.appendLine(`ERROR: ${msg}`);
	}
}

/**
 * Command: Synthesize and Place & Route
 * Calls synthesizeOnlyCommand's pipeline, then runs nextpnr for timing.
 * PnR always uses whole-design synthesis so nextpnr gets a merged netlist.
 */
async function synthesizeAndPnRCommand(providedFunc?: FunctionInfo) {
	const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!wsRoot) { vscode.window.showErrorMessage('No workspace folder open'); return; }

	const cfg = vscode.workspace.getConfiguration('clash-vscode-yosys');
	if (!(await toolchain.require('yosys', cfg.get<string>('yosysCommand', 'yosys'), '-V', wsRoot))) { return; }
	if (!(await toolchain.require('nextpnr-ecp5', 'nextpnr-ecp5', '--version', wsRoot))) { return; }

	const func = await pickFunction(providedFunc);
	if (!func) { return; }

	const deviceOptions = [
		{ label: 'LFE5U-25F (25k LUTs)', value: '25k', description: 'Small ECP5' },
		{ label: 'LFE5U-45F (45k LUTs)', value: '45k', description: 'Medium ECP5' },
		{ label: 'LFE5U-85F (85k LUTs)', value: '85k', description: 'Large ECP5' }
	];
	const deviceChoice = await vscode.window.showQuickPick(deviceOptions, { placeHolder: 'Select target ECP5 device' });
	if (!deviceChoice) { return; }

	const packageOptions = [
		{ label: 'CABGA381', value: 'CABGA381' },
		{ label: 'CABGA554', value: 'CABGA554' },
		{ label: 'CABGA756', value: 'CABGA756' }
	];
	const packageChoice = await vscode.window.showQuickPick(packageOptions, { placeHolder: 'Select package type' });
	if (!packageChoice) { return; }

	outputChannel.show(true);
	outputChannel.appendLine('='.repeat(60));
	outputChannel.appendLine(`Synthesize + Place & Route: ${func.name}`);
	outputChannel.appendLine('='.repeat(60));

	try {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Implementing ${func.name} on ECP5`,
			cancellable: false
		}, async (progress) => {
			// Steps 1–3: same Clash + Yosys pipeline as synthesizeOnlyCommand.
			// PnR always uses whole-design synthesis (nextpnr needs a merged netlist).
			const compiled = await runClashCompilation(func, wsRoot, progress);
			const { synthResult, moduleResults, topModule, sdcFrequencyMHz, projectDirs } =
				await runYosynsSynthesis(compiled, wsRoot, 'whole-design', 'ecp5', progress);

			// Show diagrams panel — same as synthesize-only step.
			SynthesisResultsPanel.show(moduleResults, `Synthesis Results — ${topModule}`, outputChannel);
			synthesisTreeProvider.refresh(moduleResults);

			// Step 4: Place & Route
			if (!synthResult.jsonPath) {
				throw new Error('No JSON output from Yosys — cannot run PnR');
			}

			progress.report({ message: 'Place and Route with nextpnr…', increment: 60 });
			outputChannel.appendLine('\n=== Step 4: Place & Route with nextpnr ===');

			const pnrResult = await nextpnrRunner.placeAndRoute({
				family: 'ecp5',
				jsonPath: synthResult.jsonPath,
				outputDir: projectDirs.nextpnr,
				topModule,
				frequency: sdcFrequencyMHz,
				ecp5: {
					device: deviceChoice.value as ECP5Device,
					package: packageChoice.value as ECP5Package,
					speedGrade: '6'
				}
			});

			if (!pnrResult.success) {
				throw new Error('Place and route failed — check output channel for details');
			}

			progress.report({ message: 'Done', increment: 100 });
			outputChannel.appendLine('');
			outputChannel.appendLine('='.repeat(60));
			outputChannel.appendLine('✓ FPGA Implementation Complete!');
			outputChannel.appendLine('='.repeat(60));
			outputChannel.appendLine(`  Config:    ${pnrResult.textcfgPath}`);
			if (pnrResult.bitstreamPath) {
				outputChannel.appendLine(`  Bitstream: ${pnrResult.bitstreamPath}`);
			}

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

			if (pnrResult.utilization) {
				const u = pnrResult.utilization;
				outputChannel.appendLine('');
				outputChannel.appendLine('Resource Utilization:');
				outputChannel.appendLine('-'.repeat(40));
				if (u.luts) {
					outputChannel.appendLine(`  LUTs:      ${u.luts.used}/${u.luts.total} (${((u.luts.used / u.luts.total) * 100).toFixed(1)}%)`);
				}
				if (u.registers) {
					outputChannel.appendLine(`  Registers: ${u.registers.used}/${u.registers.total} (${((u.registers.used / u.registers.total) * 100).toFixed(1)}%)`);
				}
				if (u.bram) {
					outputChannel.appendLine(`  BRAM:      ${u.bram.used}/${u.bram.total} (${((u.bram.used / u.bram.total) * 100).toFixed(1)}%)`);
				}
				if (u.io) {
					outputChannel.appendLine(`  IO:        ${u.io.used}/${u.io.total} (${((u.io.used / u.io.total) * 100).toFixed(1)}%)`);
				}
			}

			const action = await vscode.window.showInformationMessage(
				`✓ FPGA implementation complete! Bitstream: ${path.basename(pnrResult.bitstreamPath || '')}`,
				'Open Bitstream Folder', 'Done'
			);
			if (action === 'Open Bitstream Folder') {
				await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(projectDirs.nextpnr));
			}
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
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

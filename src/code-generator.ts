import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { FunctionInfo } from './types';

/**
 * Configuration for code generation
 */
export interface GenerationConfig {
    /** Whether to keep generated files after synthesis */
    keepFiles: boolean;
    
    /** Prefix for generated module names */
    modulePrefix: string;
}

/**
 * Result of code generation
 */
export interface GenerationResult {
    /** Path to the generated wrapper file */
    filePath: string;
    
    /** Name of the generated module */
    moduleName: string;
    
    /** Content of the generated file */
    content: string;
    
    /** Root of the synthesis cabal project (.clash/synth-project) */
    synthProjectRoot: string;
}

/**
 * Information about the synthesis cabal project.
 */
export interface SynthProjectInfo {
    /** Root of the synth project (.clash/synth-project) */
    synthRoot: string;

    /** The user's cabal project directory (where cabal.project lives), or
     *  null if no cabal.project was found.  When set, the compiler should
     *  pass --project-dir pointing here so that relative paths in the
     *  imported cabal.project resolve correctly. */
    cabalProjectDir: string | null;
}

/**
 * Port annotation for the Synthesize pragma.
 * Simple ports use PortName; compound types like DiffClock use PortProduct.
 */
export type PortAnnotation =
    | { kind: 'name'; name: string }
    | { kind: 'product'; name: string; subPorts: string[] };

/**
 * Generates Clash wrapper modules for synthesizing functions.
 *
 * Instead of standalone .hs files, the generator maintains a small cabal
 * project at `.clash/synth-project/` that depends on the user's package.
 * This lets Clash resolve all transitive dependencies correctly.
 */
export class CodeGenerator {
    private outputChannel: vscode.OutputChannel;
    
    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Generate a wrapper module for a function.
     *
     * Writes the wrapper into the synth-project source tree
     * (`<workspace>/.clash/synth-project/src/`).
     *
     * @param func           Function to wrap
     * @param config         Generation configuration
     * @param workspaceRoot  VS Code workspace root (where `.clash/` lives)
     */
    async generateWrapper(
        func: FunctionInfo,
        config: GenerationConfig,
        workspaceRoot: string
    ): Promise<GenerationResult> {
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('='.repeat(60));
        this.outputChannel.appendLine('Code Generation');
        this.outputChannel.appendLine('='.repeat(60));
        this.outputChannel.appendLine(`Function: ${func.name}`);
        this.outputChannel.appendLine(`Type: ${func.typeSignature}`);

        // Generate module name
        const moduleName = this.generateModuleName(func.name, config.modulePrefix);
        this.outputChannel.appendLine(`Module name: ${moduleName}`);

        // Generate file content
        const content = this.generateWrapperContent(func, moduleName);

        // Write the wrapper into the synth-project source tree so cabal
        // can find it as a proper module.
        const synthProjectRoot = CodeGenerator.getSynthProjectRoot(workspaceRoot);
        const synthSrcDir = path.join(synthProjectRoot, 'src');
        await this.ensureDirectory(synthSrcDir);
        const fileName = `${moduleName}.hs`;
        const filePath = path.join(synthSrcDir, fileName);

        // Remove any stale wrappers left from previous syntheses of a different
        // function.  Leaving them around causes two problems:
        //   1. The clash-synth.cabal exposed-modules list goes stale, making
        //      cabal complain about missing source files or wrong dependencies.
        //   2. Cabal may try to compile modules whose user-package dependency
        //      no longer matches the current synthesis target.
        try {
            const existing = await fs.readdir(synthSrcDir);
            for (const f of existing) {
                if (f.endsWith('.hs') && f !== fileName) {
                    await fs.unlink(path.join(synthSrcDir, f));
                    this.outputChannel.appendLine(`Removed stale wrapper: ${f}`);
                }
            }
        } catch { /* synthSrcDir may not exist yet; ensureDirectory above handles it */ }

        const written = await this.writeIfChanged(filePath, content);
        this.outputChannel.appendLine(written ? `Generated: ${filePath}` : `Unchanged: ${filePath}`);
        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('File content preview:');
        this.outputChannel.appendLine('-'.repeat(60));
        const preview = content.length > 1000 ? content.substring(0, 1000) + '\n... (truncated)' : content;
        this.outputChannel.appendLine(preview);
        this.outputChannel.appendLine('-'.repeat(60));

        return {
            filePath,
            moduleName,
            content,
            synthProjectRoot
        };
    }

    /**
     * Ensure the synthesis cabal project exists.  The project lives at
     * `<workspace>/.clash/synth-project/`.
     *
     * @param workspaceRoot  VS Code workspace root (where `.clash/` lives)
     * @param sourceFilePath Path to the Haskell source file being synthesized.
     *   We walk up from this file to find the nearest `.cabal` project.
     *   If found, the synth project depends on it.
     *   If not, a standalone synth project is created.
     *
     * It contains:
     *  - cabal.project  → references the user project (if any) and itself
     *  - clash-synth.cabal → library that re-exports wrappers, executable
     *    "clash" that depends on clash-ghc + the user's package (if any)
     *  - src/             → generated wrapper modules land here
     */
    async ensureSynthProject(
        workspaceRoot: string,
        sourceFilePath: string,
        /** The single wrapper module name that will be synthesized.
         *  When supplied the cabal file is written with exactly this module,
         *  rather than whatever stale files happen to be on disk. */
        targetModuleName?: string
    ): Promise<SynthProjectInfo> {
        const synthRoot = CodeGenerator.getSynthProjectRoot(workspaceRoot);
        await this.ensureDirectory(synthRoot);
        await this.ensureDirectory(path.join(synthRoot, 'src'));

        // Walk up from the source file to find its cabal project (if any)
        const cabalProject = await CodeGenerator.findCabalProject(sourceFilePath);

        // Use the known target module name when available so the cabal file is
        // always correct, even before old wrappers are cleaned up.
        const wrapperModules = targetModuleName
            ? [targetModuleName]
            : await this.listWrapperModules(synthRoot);

        let cabalProjectDir: string | null = null;

        if (cabalProject) {
            this.outputChannel.appendLine(
                `Detected user package: ${cabalProject.packageName} at ${cabalProject.projectRoot}`
            );

            // Look for the user's cabal.project file (may be at or above the .cabal dir)
            const userCabalProjectFile = await CodeGenerator.findCabalProjectFile(cabalProject.projectRoot);

            let cabalProjectContent: string;
            if (userCabalProjectFile) {
                // Import the user's cabal.project for all config (constraints,
                // allow-newer, source-repository-package, etc.).
                //
                // Path resolution: `import:` paths resolve relative to this
                // file.  `packages:` / `optional-packages:` paths resolve
                // relative to --project-dir which the compiler will set to
                // cabalProjectDir.  So we express optional-packages relative
                // to that directory.
                cabalProjectDir = path.dirname(userCabalProjectFile);
                const relImport = path.relative(synthRoot, userCabalProjectFile);
                const synthRelToCabalDir = path.relative(cabalProjectDir, synthRoot);

                this.outputChannel.appendLine(`Importing user cabal.project: ${userCabalProjectFile}`);
                this.outputChannel.appendLine(`Will use --project-dir=${cabalProjectDir}`);

                cabalProjectContent = [
                    '-- Auto-generated by clash-vscode-yosys. Do not edit.',
                    '-- The compiler must pass --project-dir pointing at the',
                    '-- user project root so that packages: paths resolve correctly.',
                    `import: ${relImport}`,
                    '',
                    `optional-packages: ${synthRelToCabalDir}/*.cabal`,
                    '',
                    'write-ghc-environment-files: always',
                    ''
                ].join('\n');
            } else {
                // No cabal.project found — reference the .cabal file directly
                this.outputChannel.appendLine('No cabal.project found, referencing .cabal directly');
                cabalProjectContent = [
                    '-- Auto-generated by clash-vscode-yosys. Do not edit.',
                    'packages:',
                    '  .',
                    '',
                    `optional-packages: ${path.relative(synthRoot, cabalProject.projectRoot)}/*.cabal`,
                    '',
                    'write-ghc-environment-files: always',
                    ''
                ].join('\n');
            }
            await this.writeIfChanged(path.join(synthRoot, 'cabal.project'), cabalProjectContent);

            // Write clash-synth.cabal depending on the user's package
            const cabalFile = this.generateSynthCabalFile(cabalProject.packageName, wrapperModules);
            await this.writeIfChanged(path.join(synthRoot, 'clash-synth.cabal'), cabalFile);
        } else {
            this.outputChannel.appendLine('No cabal project found — standalone mode');

            // Determine the source directory so cabal can find the module
            const sourceDir = path.dirname(sourceFilePath);

            // Write cabal.project (no user project to reference)
            const cabalProjectContent = [
                '-- Auto-generated by clash-vscode-yosys. Do not edit.',
                'packages:',
                '  .',
                '',
                'write-ghc-environment-files: always',
                ''
            ].join('\n');
            await this.writeIfChanged(path.join(synthRoot, 'cabal.project'), cabalProjectContent);

            // Write clash-synth.cabal without user package dep but with
            // the source directory added to hs-source-dirs.
            const cabalFile = this.generateSynthCabalFile(null, wrapperModules, [sourceDir]);
            await this.writeIfChanged(path.join(synthRoot, 'clash-synth.cabal'), cabalFile);
        }

        // Write a minimal Clash.hs main for the executable
        const binDir = path.join(synthRoot, 'bin');
        await this.ensureDirectory(binDir);
        const clashMain = [
            'import Clash.Main (defaultMain)',
            'import System.Environment (getArgs)',
            'import Prelude',
            'main :: IO ()',
            'main = defaultMain =<< getArgs',
            ''
        ].join('\n');
        await this.writeIfChanged(path.join(binDir, 'Clash.hs'), clashMain);

        this.outputChannel.appendLine(`Synth project ready at: ${synthRoot}`);
        return { synthRoot, cabalProjectDir };
    }

    /**
     * Generate the clash-synth.cabal file contents.
     *
     * @param userPackageName  Package to depend on, or null for standalone mode
     * @param wrapperModules   Wrapper module names in src/
     * @param extraSourceDirs  Additional hs-source-dirs (used in standalone mode
     *   so cabal can find the user's module without a package dependency)
     */
    private generateSynthCabalFile(
        userPackageName: string | null,
        wrapperModules: string[],
        extraSourceDirs?: string[]
    ): string {
        const exposedModules = wrapperModules.length > 0
            ? wrapperModules.join('\n    ')
            : '-- (none yet)';

        const srcDirs = ['src', ...(extraSourceDirs || [])].join(', ');

        const libDeps = [
            'base',
            'clash-prelude',
            'ghc-typelits-natnormalise',
            'ghc-typelits-extra',
            'ghc-typelits-knownnat',
        ];
        if (userPackageName) {
            libDeps.push(userPackageName);
        }

        const exeDeps = [
            'base',
            'clash-ghc',
            'ghc-typelits-natnormalise',
            'ghc-typelits-extra',
            'ghc-typelits-knownnat',
        ];
        if (userPackageName) {
            exeDeps.push(userPackageName);
        }
        exeDeps.push('clash-synth');

        const formatDeps = (deps: string[]) =>
            deps.map((d, i) => (i === 0 ? `    ${d}` : `    ${d}`)).join(',\n');

        return [
            'cabal-version:  2.4',
            'name:           clash-synth',
            'version:        0.1',
            'build-type:     Simple',
            '',
            'common clash-options',
            '  default-language: Haskell2010',
            '  default-extensions:',
            '    BangPatterns',
            '    BinaryLiterals',
            '    DataKinds',
            '    DefaultSignatures',
            '    DeriveAnyClass',
            '    DeriveGeneric',
            '    DeriveLift',
            '    DerivingStrategies',
            '    FlexibleContexts',
            '    KindSignatures',
            '    NoStarIsType',
            '    PolyKinds',
            '    RankNTypes',
            '    ScopedTypeVariables',
            '    StandaloneDeriving',
            '    TemplateHaskell',
            '    QuasiQuotes',
            '    TypeApplications',
            '    TypeFamilies',
            '    TypeOperators',
            '    NoImplicitPrelude',
            '  ghc-options:',
            '    -Wall -Wcompat',
            '    -fplugin GHC.TypeLits.Extra.Solver',
            '    -fplugin GHC.TypeLits.Normalise',
            '    -fplugin GHC.TypeLits.KnownNat.Solver',
            '    -fexpose-all-unfoldings',
            '    -fno-worker-wrapper',
            '',
            'library',
            '  import: clash-options',
            `  hs-source-dirs: ${srcDirs}`,
            '  build-depends:',
            formatDeps(libDeps),
            '  exposed-modules:',
            `    ${exposedModules}`,
            '',
            'executable clash',
            '  import: clash-options',
            '  main-is: bin/Clash.hs',
            '  build-depends:',
            formatDeps(exeDeps),
            ''
        ].join('\n');
    }

    /**
     * List all wrapper module names currently in synth-project/src/.
     */
    private async listWrapperModules(synthRoot: string): Promise<string[]> {
        const srcDir = path.join(synthRoot, 'src');
        try {
            const files = await fs.readdir(srcDir);
            return files
                .filter(f => f.endsWith('.hs'))
                .map(f => f.replace(/\.hs$/, ''));
        } catch {
            return [];
        }
    }

    /**
     * Generate the content for a wrapper module
     */
    private generateWrapperContent(func: FunctionInfo, moduleName: string): string {
        const originalModule = func.moduleName || 'Unknown';
        const functionName = func.name;
        const typeSignature = func.typeSignature || 'Unknown';
        
        // Generate synthesized function name (lowercase, safe for Verilog)
        const synthName = this.generateSynthName(functionName);
        
        // Parse type signature to generate port names
        const ports = this.generatePortNames(typeSignature);

        const lines: string[] = [];
        
        // Module header
        lines.push('{-# OPTIONS_GHC -Wno-orphans #-}');
        lines.push('');
        lines.push(`module ${moduleName} where`);
        lines.push('');
        
        // Imports
        lines.push('import Clash.Prelude');
        if (originalModule !== 'Unknown') {
            lines.push(`import qualified ${originalModule}`);
        }
        lines.push('');
        
        // Comment explaining the wrapper
        lines.push(`-- | Wrapper for synthesizing ${originalModule}.${functionName}`);
        lines.push('-- This module was auto-generated by clash-vscode-yosys extension');
        lines.push(`-- Original type: ${typeSignature}`);
        lines.push('');
        
        // topEntity definition
        // lines.push(`topEntity :: ${typeSignature}`);
        if (originalModule !== 'Unknown') {
            lines.push(`topEntity = ${originalModule}.${functionName}`);
        } else {
            lines.push(`topEntity = ${functionName}`);
        }
        lines.push('');
        
        // Synthesize annotation
        lines.push('{-# ANN topEntity');
        lines.push('  (Synthesize');
        lines.push(`    { t_name = "${synthName}"`);
        lines.push(`    , t_inputs = ${this.formatPortList(ports.inputs)}`);
        lines.push(`    , t_output = PortName "${ports.output}"`);
        lines.push('    }) #-}');
        lines.push('');
        
        // OPAQUE pragmas
        lines.push('-- Make sure GHC does not apply optimizations');
        lines.push('{-# OPAQUE topEntity #-}');
        lines.push('');

        return lines.join('\n');
    }

    /**
     * A port annotation: either a simple PortName or a PortProduct
     * for compound types like DiffClock.
     */
    static formatPortAnnotation(port: PortAnnotation): string {
        if (port.kind === 'product') {
            const subs = port.subPorts.map(s => `PortName "${s}"`).join(', ');
            return `PortProduct "${port.name}" [${subs}]`;
        }
        return `PortName "${port.name}"`;
    }

    /**
     * Generate port names from type signature
     */
    private generatePortNames(typeSignature: string): { inputs: PortAnnotation[], output: string } {
        // Split by -> to get argument types
        const parts = typeSignature.split('->').map(s => s.trim());
        
        if (parts.length === 0) {
            return { inputs: [], output: 'OUT' };
        }

        // Last part is the output type
        const output = 'OUT';
        
        // Generate input port names
        const inputs: PortAnnotation[] = [];
        for (let i = 0; i < parts.length - 1; i++) {
            // Try to derive a meaningful name from the type
            const typeName = parts[i];
            const port = this.derivePortAnnotation(typeName, i);
            inputs.push(port);
        }

        return { inputs, output };
    }

    /**
     * Derive a port annotation from a type.
     * Most types get a simple PortName; compound types like DiffClock
     * require a PortProduct so Clash can split their sub-signals.
     */
    private derivePortAnnotation(typeName: string, index: number): PortAnnotation {
        // Remove parentheses and extract the base type
        const cleaned = typeName.replace(/[()]/g, '').trim();
        
        // DiffClock needs PortProduct with p/n sub-ports
        if (cleaned.includes('DiffClock')) {
            return { kind: 'product', name: 'CLK', subPorts: ['p', 'n'] };
        }

        // Common patterns
        if (cleaned.includes('Clock')) {
            return { kind: 'name', name: 'CLK' };
        }
        if (cleaned.includes('Reset')) {
            return { kind: 'name', name: 'RST' };
        }
        if (cleaned.includes('Enable')) {
            return { kind: 'name', name: 'EN' };
        }
        
        // Generic names
        const letter = String.fromCharCode(65 + index); // A, B, C, ...
        return { kind: 'name', name: `IN${letter}` };
    }

    /**
     * Format a list of port annotations for the Synthesize annotation
     */
    private formatPortList(ports: PortAnnotation[]): string {
        if (ports.length === 0) {
            return '[]';
        }
        
        const formatted = ports.map(p => CodeGenerator.formatPortAnnotation(p)).join('\n                 , ');
        return `[ ${formatted}\n                 ]`;
    }

    /**
     * Generate a safe module name
     */
    private generateModuleName(functionName: string, prefix: string): string {
        // Capitalize first letter of function name
        const capitalizedName = functionName.charAt(0).toUpperCase() + functionName.slice(1);
        return `${prefix}${capitalizedName}`;
    }

    /**
     * Generate a safe synthesized function name for Verilog
     */
    private generateSynthName(functionName: string): string {
        // Convert camelCase to snake_case and lowercase
        return functionName
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .replace(/^_/, ''); // Remove leading underscore
    }

    /**
     * Write `content` to `filePath` only when the on-disk content differs.
     * Returns true if the file was written, false if it was already up-to-date.
     * This preserves the file's mtime when nothing changed, which prevents
     * cabal from seeing the project files as dirty and triggering a rebuild.
     */
    private async writeIfChanged(filePath: string, content: string): Promise<boolean> {
        try {
            const existing = await fs.readFile(filePath, 'utf8');
            if (existing === content) {
                return false;
            }
        } catch {
            // File doesn't exist yet — fall through to write.
        }
        await fs.writeFile(filePath, content, 'utf8');
        return true;
    }

    /**
     * Ensure a directory exists, create if it doesn't
     */
    private async ensureDirectory(dirPath: string): Promise<void> {
        try {
            await fs.access(dirPath);
        } catch {
            try {
                // Directory doesn't exist, create it
                await fs.mkdir(dirPath, { recursive: true });
                this.outputChannel.appendLine(`Created directory: ${dirPath}`);
            } catch (mkdirError) {
                const msg = mkdirError instanceof Error ? mkdirError.message : String(mkdirError);
                throw new Error(`Failed to create directory ${dirPath}: ${msg}`);
            }
        }
    }

    /**
     * Get default generation config for a workspace
     */
    static getDefaultConfig(): GenerationConfig {
        return {
            keepFiles: false,
            modulePrefix: 'ClashSynth_'
        };
    }

    /**
     * Root of the synthesis cabal project.
     */
    static getSynthProjectRoot(workspaceRoot: string): string {
        return path.join(workspaceRoot, '.clash', 'synth-project');
    }

    /**
     * Detect the package name from the first .cabal file found in a directory.
     */
    static async detectCabalPackageName(dir: string): Promise<string | null> {
        try {
            const entries = await fs.readdir(dir);
            const cabalFile = entries.find(e => e.endsWith('.cabal'));
            if (!cabalFile) { return null; }

            const content = await fs.readFile(path.join(dir, cabalFile), 'utf8');
            const match = content.match(/^name:\s*(.+)/mi);
            return match ? match[1].trim() : null;
        } catch {
            return null;
        }
    }

    /**
     * Walk up from a source file to find the nearest .cabal project.
     * Returns the project root directory and package name, or null if
     * the file does not belong to any cabal project.
     */
    static async findCabalProject(sourceFilePath: string): Promise<{ projectRoot: string; packageName: string } | null> {
        let dir = path.dirname(sourceFilePath);
        const root = path.parse(dir).root;

        while (dir !== root) {
            const name = await CodeGenerator.detectCabalPackageName(dir);
            if (name) {
                return { projectRoot: dir, packageName: name };
            }
            const parent = path.dirname(dir);
            if (parent === dir) { break; }
            dir = parent;
        }
        return null;
    }

    /**
     * Walk up from a directory to find the nearest `cabal.project` file.
     * Returns the absolute path to the file, or null if none found.
     */
    static async findCabalProjectFile(startDir: string): Promise<string | null> {
        let dir = startDir;
        const root = path.parse(dir).root;

        while (dir !== root) {
            const candidate = path.join(dir, 'cabal.project');
            try {
                await fs.access(candidate);
                return candidate;
            } catch {
                // not here, keep walking
            }
            const parent = path.dirname(dir);
            if (parent === dir) { break; }
            dir = parent;
        }
        return null;
    }

    /**
     * Get project-specific directory structure for a function
     */
    static getProjectDirectories(workspaceRoot: string, func: FunctionInfo): {
        root: string;
        verilog: string;
        yosys: string;
        nextpnr: string;
    } {
        // Create fully qualified name: Module.Function
        const qualifiedName = func.moduleName
            ? `${func.moduleName}.${func.name}`
            : func.name;
        
        const projectRoot = path.join(workspaceRoot, '.clash', qualifiedName);
        
        return {
            root: projectRoot,
            verilog: path.join(projectRoot, '02-verilog'),
            yosys: path.join(projectRoot, '03-yosys'),
            nextpnr: path.join(projectRoot, '04-nextpnr')
        };
    }

    /**
     * Clean up generated files
     */
    /**
     * Clean up generated wrapper files from the synth project source tree.
     */
    async cleanup(workspaceRoot: string): Promise<void> {
        try {
            const synthSrcDir = path.join(
                CodeGenerator.getSynthProjectRoot(workspaceRoot), 'src'
            );
            const files = await fs.readdir(synthSrcDir);
            for (const file of files) {
                if (file.endsWith('.hs')) {
                    const filePath = path.join(synthSrcDir, file);
                    await fs.unlink(filePath);
                    this.outputChannel.appendLine(`Deleted: ${filePath}`);
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Cleanup warning: ${error}`);
        }
    }
}

import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs, constants as fsConstants } from 'fs';
import { spawn } from 'child_process';
import { getLogger } from './file-logger';

/**
 * Walk PATH to resolve the absolute location of a command.
 * Cross-platform: honours PATHEXT on Windows. Returns undefined if not found.
 */
async function resolveCommandPath(cmd: string): Promise<string | undefined> {
    const PATH = process.env.PATH || '';
    const exts = process.platform === 'win32'
        ? (process.env.PATHEXT || '').split(';').filter(Boolean)
        : [''];
    for (const dir of PATH.split(path.delimiter)) {
        if (!dir) { continue; }
        for (const ext of exts) {
            const candidate = path.join(dir, cmd + ext);
            try {
                await fs.access(candidate, fsConstants.X_OK);
                return candidate;
            } catch { /* not executable here, keep looking */ }
        }
    }
    return undefined;
}

/**
 * The set of external tools the extension can use, with human-readable
 * descriptions for the settings panel info tooltips.
 */
export interface ToolDefinition {
    /** Internal id used as the cache key. */
    id: string;
    /** Tool name shown to the user. */
    label: string;
    /** Default executable name (overridable via settings for some tools). */
    defaultCommand: string;
    /** Flag used to probe for availability. */
    versionFlag: string;
    /** Why the extension needs this tool — shown in the info tooltip. */
    description: string;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
    {
        id: 'cabal',
        label: 'cabal',
        defaultCommand: 'cabal',
        versionFlag: '--version',
        description:
            'Cabal builds the Clash project and invokes the Clash compiler to '
            + 'generate Verilog from your Haskell sources. Required for every '
            + 'synthesis run.',
    },
    {
        id: 'yosys',
        label: 'yosys',
        defaultCommand: 'yosys',
        versionFlag: '-V',
        description:
            'Yosys is the open-source RTL synthesis suite that elaborates the '
            + 'Verilog and produces a gate-level netlist. Required for the '
            + 'Elaborate, Synthesize, and Place & Route commands.',
    },
    {
        id: 'dot',
        label: 'dot (Graphviz)',
        defaultCommand: 'dot',
        versionFlag: '-V',
        description:
            'Graphviz `dot` renders the schematic SVG diagrams that Yosys '
            + 'emits via its `show` command. Without it, synthesis still '
            + 'succeeds but no diagram is produced.',
    },
    {
        id: 'nextpnr-ecp5',
        label: 'nextpnr-ecp5',
        defaultCommand: 'nextpnr-ecp5',
        versionFlag: '--version',
        description:
            'nextpnr-ecp5 places and routes the synthesized netlist onto the '
            + 'Lattice ECP5 fabric. Required for the Place & Route command.',
    },
];

/**
 * Represents the availability status of a single tool
 */
export interface ToolStatus {
    name: string;
    available: boolean;
    version?: string;
    error?: string;
    path?: string;
}

/**
 * Checks availability of external tools needed by the extension.
 * Results are cached per session and can be refreshed on demand.
 */
export class ToolchainChecker {
    private cache = new Map<string, ToolStatus>();
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Check if a command is available by running it with a version flag.
     * Returns a ToolStatus with availability info.
     */
    async check(
        name: string,
        command: string,
        versionFlag = '--version',
        cwd?: string
    ): Promise<ToolStatus> {
        const cached = this.cache.get(name);
        if (cached) {
            return cached;
        }

        const status = await this.probe(name, command, versionFlag, cwd);
        this.cache.set(name, status);
        return status;
    }

    /**
     * Probe a tool without caching.
     */
    private probe(
        name: string,
        command: string,
        versionFlag: string,
        cwd?: string
    ): Promise<ToolStatus> {
        return new Promise((resolve) => {
            const parts = command.split(/\s+/);
            const cmd = parts[0];
            const baseArgs = parts.slice(1);
            const args = [...baseArgs, versionFlag];

            const spawnOpts: { timeout: number; cwd?: string } = { timeout: 10_000 };
            if (cwd) {
                spawnOpts.cwd = cwd;
            }

            try {
                const logger = getLogger();
                const finishLog = logger?.command(cmd, args, spawnOpts.cwd);
                const proc = spawn(cmd, args, spawnOpts);

                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', (d) => { stdout += d.toString(); });
                proc.stderr.on('data', (d) => { stderr += d.toString(); });

                proc.on('close', async (code) => {
                    finishLog?.then(fn => fn(code));
                    const output = (stdout + stderr).trim();
                    const firstLine = output.split('\n')[0] || '';

                    if (code === 0 || output.length > 0) {
                        const resolvedPath = await resolveCommandPath(cmd);
                        resolve({
                            name,
                            available: true,
                            version: firstLine,
                            path: resolvedPath,
                        });
                    } else {
                        resolve({
                            name,
                            available: false,
                            error: `Exited with code ${code}`,
                        });
                    }
                });

                proc.on('error', (err) => {
                    resolve({
                        name,
                        available: false,
                        error: err.message,
                    });
                });
            } catch (err) {
                resolve({
                    name,
                    available: false,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        });
    }

    /**
     * Check all tools that the extension depends on.
     * Returns a map of tool name → status.
     */
    async checkAll(cwd?: string): Promise<Map<string, ToolStatus>> {
        const config = vscode.workspace.getConfiguration('clash-toolkit');
        const yosysCmd = config.get<string>('yosysCommand', 'yosys');

        const checks = TOOL_DEFINITIONS.map(def => {
            const command = def.id === 'yosys' ? yosysCmd : def.defaultCommand;
            return this.check(def.id, command, def.versionFlag, cwd);
        });

        await Promise.all(checks);
        return new Map(this.cache);
    }

    /**
     * Snapshot the current cached statuses, ordered to match TOOL_DEFINITIONS.
     * Tools that have not been probed yet are returned with `available: false`.
     */
    snapshotStatuses(): ToolStatus[] {
        return TOOL_DEFINITIONS.map(def =>
            this.cache.get(def.id) ?? {
                name: def.id,
                available: false,
                error: 'not yet probed',
            }
        );
    }

    /**
     * Clear the cache so the next check re-probes.
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Require a specific tool before proceeding.
     * Shows an error message and returns false if the tool is missing.
     */
    async require(
        name: string,
        command: string,
        versionFlag = '--version',
        cwd?: string
    ): Promise<boolean> {
        const status = await this.check(name, command, versionFlag, cwd);
        if (!status.available) {
            const settingHint = name === 'yosys'
                    ? 'clash-toolkit.yosysCommand'
                    : undefined;

            let msg = `${name} is not available: ${status.error}.`;
            if (settingHint) {
                msg += ` Configure it in Settings → "${settingHint}".`;
            } else {
                msg += ` Make sure ${name} is installed and in your PATH.`;
            }

            this.outputChannel.appendLine(`✗ ${msg}`);
            vscode.window.showErrorMessage(msg, 'Open Settings').then((choice) => {
                if (choice === 'Open Settings') {
                    vscode.commands.executeCommand(
                        'workbench.action.openSettings',
                        settingHint || 'clash-toolkit'
                    );
                }
            });
            return false;
        }
        return true;
    }

    /**
     * Format a summary of all tool statuses for the output channel.
     */
    formatSummary(): string {
        const lines: string[] = ['Toolchain Status:', '-'.repeat(40)];
        for (const [, status] of this.cache) {
            if (status.available) {
                lines.push(`  ✓ ${status.name}: ${status.version || 'available'}`);
            } else {
                lines.push(`  ✗ ${status.name}: ${status.error || 'not found'}`);
            }
        }
        return lines.join('\n');
    }
}

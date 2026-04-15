import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { getLogger } from './file-logger';

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

                proc.on('close', (code) => {
                    finishLog?.then(fn => fn(code));
                    const output = (stdout + stderr).trim();
                    const firstLine = output.split('\n')[0] || '';

                    if (code === 0 || output.length > 0) {
                        resolve({
                            name,
                            available: true,
                            version: firstLine,
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
        const config = vscode.workspace.getConfiguration('clash-vscode-yosys');
        const yosysCmd = config.get<string>('yosysCommand', 'yosys');

        const checks = [
            this.check('cabal', 'cabal', '--version', cwd),
            this.check('yosys', yosysCmd, '-V', cwd),
            this.check('nextpnr-ecp5', 'nextpnr-ecp5', '--version', cwd),
            this.check('ecppack', 'ecppack', '--help', cwd),
        ];

        await Promise.all(checks);
        return new Map(this.cache);
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
                    ? 'clash-vscode-yosys.yosysCommand'
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
                        settingHint || 'clash-vscode-yosys'
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

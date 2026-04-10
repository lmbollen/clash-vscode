import * as path from 'path';
import { promises as fs } from 'fs';

/**
 * File-based logger for debugging crashes
 * Writes synchronously to ensure logs are captured even if VS Code crashes
 */
export class FileLogger {
    private logFilePath: string;
    private enabled: boolean = true;

    constructor(workspaceRoot: string) {
        this.logFilePath = path.join(workspaceRoot, '.clash-vscode-debug.log');
        this.init();
    }

    private async init() {
        try {
            // Create/truncate log file on start
            const timestamp = new Date().toISOString();
            await fs.writeFile(this.logFilePath, `=== Clash VS Code Extension Debug Log ===\n`);
            await this.appendToFile(`Started: ${timestamp}\n\n`);
            this.enabled = true;
        } catch (error) {
            console.error('Failed to initialize file logger:', error);
            this.enabled = false;
        }
    }

    private async appendToFile(message: string): Promise<void> {
        if (!this.enabled) {
            return;
        }

        try {
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] ${message}\n`;
            
            // Use appendFile for atomic writes
            await fs.appendFile(this.logFilePath, logEntry, 'utf8');
        } catch (error) {
            console.error('Failed to write to log file:', error);
            this.enabled = false;
        }
    }

    async log(message: string): Promise<void> {
        await this.appendToFile(`[LOG] ${message}`);
    }

    async error(message: string, error?: unknown): Promise<void> {
        let errorMsg = `[ERROR] ${message}`;
        if (error instanceof Error) {
            errorMsg += `\n  Error: ${error.message}`;
            if (error.stack) {
                errorMsg += `\n  Stack: ${error.stack}`;
            }
        } else if (error) {
            errorMsg += `\n  Error: ${String(error)}`;
        }
        await this.appendToFile(errorMsg);
    }

    async info(message: string): Promise<void> {
        await this.appendToFile(`[INFO] ${message}`);
    }

    async warn(message: string): Promise<void> {
        await this.appendToFile(`[WARN] ${message}`);
    }

    async debug(message: string): Promise<void> {
        await this.appendToFile(`[DEBUG] ${message}`);
    }

    async operation(name: string, details?: string): Promise<void> {
        let msg = `[OPERATION] ${name}`;
        if (details) {
            msg += ` - ${details}`;
        }
        await this.appendToFile(msg);
    }

    getLogPath(): string {
        return this.logFilePath;
    }

    /**
     * Create a scoped logger that automatically cleans up
     */
    async scope<T>(name: string, fn: () => Promise<T>): Promise<T> {
        await this.operation(`START: ${name}`);
        try {
            const result = await fn();
            await this.operation(`SUCCESS: ${name}`);
            return result;
        } catch (error) {
            await this.error(`FAILED: ${name}`, error);
            throw error;
        }
    }
}

/**
 * Global logger instance
 */
let globalLogger: FileLogger | null = null;

export function initializeLogger(workspaceRoot: string): FileLogger {
    globalLogger = new FileLogger(workspaceRoot);
    return globalLogger;
}

export function getLogger(): FileLogger | null {
    return globalLogger;
}

import { promises as fsp } from 'fs';

// ── Key helpers ───────────────────────────────────────────────────────────────

export function compilationCacheKey(func: { filePath: string; name: string }): string {
	return `${func.filePath}:${func.name}`;
}

export function synthesisCacheKey(func: { filePath: string; name: string }, mode: string): string {
	return `${func.filePath}:${func.name}:${mode}`;
}

// ── Minimal structural types used only for cache validation ──────────────────

export interface CachedCompilation {
	verilogInput: string | string[];
	[key: string]: unknown;
}

export interface CachedSynthesis {
	synthResult: { jsonPath?: string };
	[key: string]: unknown;
}

// ── Cache class ───────────────────────────────────────────────────────────────

/**
 * Two-level pipeline cache: compilation results and synthesis results.
 *
 * Each entry is validated against the filesystem before being returned —
 * if the output file has been deleted the entry is evicted and undefined is
 * returned so the caller re-runs the step.
 *
 * Entries are invalidated wholesale when a source file is saved, so stale
 * results never survive an edit.
 */
export class PipelineCache {
	private _compilationCache = new Map<string, CachedCompilation>();
	private _synthesisCache   = new Map<string, CachedSynthesis>();

	// ── Compilation ────────────────────────────────────────────────────────

	setCompilation(func: { filePath: string; name: string }, result: CachedCompilation): void {
		this._compilationCache.set(compilationCacheKey(func), result);
	}

	async getCompilation(func: { filePath: string; name: string }): Promise<CachedCompilation | undefined> {
		const key    = compilationCacheKey(func);
		const cached = this._compilationCache.get(key);
		if (!cached) { return undefined; }

		const verilogFile = Array.isArray(cached.verilogInput)
			? cached.verilogInput[0]
			: cached.verilogInput as string;

		try {
			await fsp.access(verilogFile);
			return cached;
		} catch {
			this._compilationCache.delete(key);
			return undefined;
		}
	}

	// ── Synthesis ──────────────────────────────────────────────────────────

	setSynthesis(
		func: { filePath: string; name: string },
		mode: string,
		result: CachedSynthesis
	): void {
		this._synthesisCache.set(synthesisCacheKey(func, mode), result);
	}

	async getSynthesis(
		func: { filePath: string; name: string },
		mode: string
	): Promise<CachedSynthesis | undefined> {
		const key    = synthesisCacheKey(func, mode);
		const cached = this._synthesisCache.get(key);
		if (!cached) { return undefined; }

		const jsonFile = cached.synthResult.jsonPath;
		if (!jsonFile) { this._synthesisCache.delete(key); return undefined; }

		try {
			await fsp.access(jsonFile);
			return cached;
		} catch {
			this._synthesisCache.delete(key);
			return undefined;
		}
	}

	// ── Invalidation ───────────────────────────────────────────────────────

	/** Remove every cached result whose source file matches `filePath`. */
	invalidateFile(filePath: string): void {
		const prefix = filePath + ':';
		for (const key of this._compilationCache.keys()) {
			if (key.startsWith(prefix)) { this._compilationCache.delete(key); }
		}
		for (const key of this._synthesisCache.keys()) {
			if (key.startsWith(prefix)) { this._synthesisCache.delete(key); }
		}
	}

	/** Remove compilation and all synthesis entries for a single function. */
	invalidateFunction(func: { filePath: string; name: string }): void {
		const prefix = compilationCacheKey(func);
		this._compilationCache.delete(prefix);
		for (const key of this._synthesisCache.keys()) {
			if (key.startsWith(prefix)) { this._synthesisCache.delete(key); }
		}
	}

	// ── Introspection (for tests) ──────────────────────────────────────────

	get compilationSize(): number { return this._compilationCache.size; }
	get synthesisSize():   number { return this._synthesisCache.size; }
}

import * as path from 'path';
import { promises as fs } from 'fs';
import { ClashManifest, ParsedClashManifest, ClashDomain, ComponentInfo } from './clash-manifest-types';

/**
 * Parser and analyzer for Clash manifest files
 */
export class ClashManifestParser {
	/**
	 * Read and parse a clash-manifest.json file
	 */
	async parseManifest(manifestPath: string): Promise<ParsedClashManifest> {
		// Read the manifest file
		const content = await fs.readFile(manifestPath, 'utf8');
		const manifest: ClashManifest = JSON.parse(content);

		// Extract directory
		const directory = path.dirname(manifestPath);

		// Extract Verilog files
		const verilogFiles = manifest.files
			.filter(f => f.name.endsWith('.v'))
			.map(f => path.join(directory, f.name));

		// Determine primary clock domain and frequency
		const { primaryDomain, targetFrequencyMHz } = this.analyzeDomains(manifest.domains);

		return {
			...manifest,
			manifestPath,
			directory,
			verilogFiles,
			primaryDomain,
			targetFrequencyMHz
		};
	}

	/**
	 * Find clash-manifest.json in a directory
	 */
	async findManifest(directory: string): Promise<string | undefined> {
		const manifestPath = path.join(directory, 'clash-manifest.json');
		try {
			await fs.access(manifestPath);
			return manifestPath;
		} catch {
			return undefined;
		}
	}

	/**
	 * Recursively collect all Verilog files including dependencies
	 */
	async collectAllVerilogFiles(
		manifestPath: string,
		visited: Set<string> = new Set()
	): Promise<string[]> {
		// Avoid infinite loops
		const normalizedPath = path.resolve(manifestPath);
		if (visited.has(normalizedPath)) {
			return [];
		}
		visited.add(normalizedPath);

		// Parse this manifest
		const manifest = await this.parseManifest(manifestPath);
		const allFiles = [...manifest.verilogFiles];

		// Recursively process dependencies
		for (const dep of manifest.dependencies.transitive) {
			// Dependencies are typically paths relative to the HDL output directory
			// We need to find the manifest for each dependency
			const depManifestPath = await this.findDependencyManifest(
				manifest.directory,
				dep
			);

			if (depManifestPath) {
				const depFiles = await this.collectAllVerilogFiles(depManifestPath, visited);
				allFiles.push(...depFiles);
			}
		}

		// Deduplicate files by resolving to absolute paths
		// This prevents the same file from being added multiple times
		const uniqueFiles = Array.from(new Set(allFiles.map(f => path.resolve(f))));
		return uniqueFiles;
	}

	/**
	 * Build a dependency graph of all components reachable from a manifest.
	 * Returns components in dependency order (leaves first, top last).
	 *
	 * Each component's `dependencies` contains only **direct** dependencies,
	 * not transitive ones — even though the Clash manifest lists all deps
	 * as transitive.  This is important for OOC synthesis: when loading
	 * pre-synthesized JSON netlists, each JSON already contains its own
	 * transitive deps.  Loading a transitive dep separately would cause
	 * a "Re-definition of module" error in Yosys.
	 */
	async buildDependencyGraph(manifestPath: string): Promise<ComponentInfo[]> {
		const visited = new Set<string>();
		const components: ComponentInfo[] = [];
		await this.collectComponents(manifestPath, visited, components);

		// If we ended up with a single component whose manifest lists
		// multiple internal sub-modules (common in large Clash designs),
		// expand it into per-Verilog-module ComponentInfo entries so that
		// they can be synthesized in parallel.
		if (components.length === 1) {
			const manifest = await this.parseManifest(manifestPath);
			if (manifest.components.length > 1) {
				return this.expandInternalComponents(manifest);
			}
		}

		// Build a lookup for quick access
		const byName = new Map(components.map(c => [c.name, c]));

		// For each component, remove deps that are transitively reachable
		// through another dep (i.e. keep only the direct/minimal deps).
		for (const comp of components) {
			comp.dependencies = this.removeTransitiveDeps(comp.dependencies, byName);
		}

		return components;
	}

	/**
	 * Expand a single manifest that contains multiple internal components
	 * into separate ComponentInfo entries.
	 *
	 * Clash sometimes generates all sub-modules as separate .v files within
	 * a single manifest directory (no separate manifest per sub-module).
	 * In that case `dependencies.transitive` is empty but `components[]`
	 * lists all Verilog module names.
	 *
	 * We scan the Verilog files for module instantiations to build the
	 * dependency graph, then return components in topological order.
	 */
	private async expandInternalComponents(
		manifest: ParsedClashManifest
	): Promise<ComponentInfo[]> {
		const dir = manifest.directory;
		const componentNames = new Set(manifest.components);

		// Map each component name to its Verilog file.
		// Manifest files list name as e.g. "foo.v"; component name is "foo".
		const verilogByComponent = new Map<string, string>();
		const extraVerilogFiles: string[] = []; // .v files not matching any component
		const seenExtras = new Set<string>();
		for (const vFile of manifest.verilogFiles) {
			const base = path.basename(vFile, '.v');
			if (componentNames.has(base)) {
				verilogByComponent.set(base, vFile);
			} else if (!seenExtras.has(vFile)) {
				seenExtras.add(vFile);
				extraVerilogFiles.push(vFile);
			}
		}

		// For extra Verilog files (e.g. SpinalHDL-generated), extract the
		// actual module names they define so we can match by instantiation
		// rather than filename.  The filename may differ from the module
		// name significantly (e.g. "vex_risc_top_Riscv32imc0VexRiscv_HASH.v"
		// defines module "Riscv32imc0VexRiscv").
		const extraFileModules = new Map<string, string[]>(); // file → module names
		for (const extra of extraVerilogFiles) {
			const content = await fs.readFile(extra, 'utf8');
			const modules: string[] = [];
			const moduleRe = /^\s*module\s+(\w+)/gm;
			let m;
			while ((m = moduleRe.exec(content)) !== null) {
				modules.push(m[1]);
			}
			extraFileModules.set(extra, modules);
		}

		// Scan each Verilog file for instantiations of other components
		// in this manifest.  Use word-boundary matching to avoid false
		// positives (e.g. "wbStorage" matching inside "wbStorage_0").
		// Also track which extra Verilog files are referenced by each component.
		const deps = new Map<string, string[]>();
		const extraFilesFor = new Map<string, string[]>();
		for (const name of manifest.components) {
			const vFile = verilogByComponent.get(name);
			if (!vFile) {
				deps.set(name, []);
				extraFilesFor.set(name, []);
				continue;
			}
			const content = await fs.readFile(vFile, 'utf8');
			const moduleDeps: string[] = [];
			for (const other of manifest.components) {
				if (other !== name) {
					// Use word-boundary regex to avoid substring false positives
					const re = new RegExp('\\b' + other.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
					if (re.test(content)) {
						moduleDeps.push(other);
					}
				}
			}
			deps.set(name, moduleDeps);

			// Attach extra (non-component) Verilog files whose *module names*
			// appear in this component's Verilog (not by filename, which may
			// differ from the actual Verilog module name).
			const extras: string[] = [];
			for (const extra of extraVerilogFiles) {
				const moduleNames = extraFileModules.get(extra) || [];
				const referenced = moduleNames.some(modName => {
					const re = new RegExp('\\b' + modName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
					return re.test(content);
				});
				if (referenced) {
					extras.push(extra);
				}
			}
			extraFilesFor.set(name, extras);
		}

		// Topological sort (Kahn's algorithm) — leaves first, top last
		const inDegree = new Map<string, number>();
		for (const name of manifest.components) {
			inDegree.set(name, 0);
		}
		for (const [, d] of deps) {
			for (const dep of d) {
				inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
			}
		}

		// Note: inDegree here counts how many modules *depend on* a module
		// (reverse edges).  We want leaves first (modules nobody depends on
		// in the reverse sense — i.e. modules that have no deps themselves).
		// Easier: use a simple iterative approach like buildSynthesisWaves.
		const result: ComponentInfo[] = [];
		const completed = new Set<string>();
		const remaining = new Set(manifest.components);

		while (remaining.size > 0) {
			const ready: string[] = [];
			for (const name of remaining) {
				const d = deps.get(name) || [];
				if (d.every(dep => completed.has(dep))) {
					ready.push(name);
				}
			}

			if (ready.length === 0) {
				// Circular — add everything remaining
				for (const name of remaining) { ready.push(name); }
			}

			for (const name of ready) {
				remaining.delete(name);
				completed.add(name);

				// Collect Verilog files: the component's own file plus any
				// non-component .v files it references (e.g. SpinalHDL-generated
				// Verilog not listed in components[])
				const ownFile = verilogByComponent.get(name);
				const extras = extraFilesFor.get(name) || [];
				const vFiles = [...extras, ...(ownFile ? [ownFile] : [])];

				result.push({
					name,
					verilogFiles: vFiles,
					dependencies: deps.get(name) || [],
					directory: dir
				});
			}
		}

		return result;
	}

	/**
	 * Given a list of dep names, remove any that are transitively reachable
	 * through another dep in the list.
	 */
	private removeTransitiveDeps(
		deps: string[],
		byName: Map<string, ComponentInfo>
	): string[] {
		if (deps.length <= 1) { return deps; }

		// Collect all names transitively reachable from each dep
		const transitiveOf = new Map<string, Set<string>>();
		const getTransitive = (name: string): Set<string> => {
			if (transitiveOf.has(name)) { return transitiveOf.get(name)!; }
			const result = new Set<string>();
			transitiveOf.set(name, result); // cache early to handle cycles
			const comp = byName.get(name);
			if (comp) {
				for (const d of comp.dependencies) {
					result.add(d);
					for (const t of getTransitive(d)) {
						result.add(t);
					}
				}
			}
			return result;
		};

		// A dep is redundant if it's transitively included by another dep
		const allTransitive = new Set<string>();
		for (const d of deps) {
			for (const t of getTransitive(d)) {
				allTransitive.add(t);
			}
		}

		return deps.filter(d => !allTransitive.has(d));
	}

	/**
	 * Recursively collect components in post-order (dependencies before dependents).
	 * Returns the top_component.name of the manifest at `manifestPath`.
	 */
	private async collectComponents(
		manifestPath: string,
		visited: Set<string>,
		components: ComponentInfo[]
	): Promise<string | null> {
		const normalizedPath = path.resolve(manifestPath);
		if (visited.has(normalizedPath)) {
			const existing = components.find(c =>
				path.resolve(c.directory, 'clash-manifest.json') === normalizedPath
			);
			return existing?.name ?? null;
		}
		visited.add(normalizedPath);

		const manifest = await this.parseManifest(manifestPath);
		const depComponentNames: string[] = [];

		for (const dep of manifest.dependencies.transitive) {
			const depManifestPath = await this.findDependencyManifest(manifest.directory, dep);
			if (depManifestPath) {
				const depName = await this.collectComponents(depManifestPath, visited, components);
				if (depName) {
					depComponentNames.push(depName);
				}
			}
		}

		const name = manifest.top_component.name;
		components.push({
			name,
			verilogFiles: manifest.verilogFiles,
			dependencies: depComponentNames,
			directory: manifest.directory
		});
		return name;
	}

	/**
	 * Find manifest file for a dependency
	 * 
	 * Dependencies in the manifest are module names like "Other.Module.topEntity"
	 * We need to search for the corresponding manifest file
	 */
	private async findDependencyManifest(
		baseDirectory: string,
		dependencyName: string
	): Promise<string | undefined> {
		// Try common locations relative to base directory
		const searchPaths = [
			// Same parent directory (sibling module)
			path.join(path.dirname(baseDirectory), dependencyName, 'clash-manifest.json'),
			// In components subdirectory
			path.join(baseDirectory, '..', 'components', dependencyName, 'clash-manifest.json'),
			// Direct subdirectory
			path.join(baseDirectory, dependencyName, 'clash-manifest.json')
		];

		for (const searchPath of searchPaths) {
			try {
				await fs.access(searchPath);
				return searchPath;
			} catch {
				continue;
			}
		}

		return undefined;
	}

	/**
	 * Analyze clock domains to determine primary domain and target frequency
	 */
	private analyzeDomains(domains: Record<string, ClashDomain>): {
		primaryDomain?: string;
		targetFrequencyMHz?: number;
	} {
		if (Object.keys(domains).length === 0) {
			return {};
		}

		// Heuristic: Use "System" domain if available, otherwise first domain
		let primaryDomain = Object.keys(domains)[0];
		if ('System' in domains) {
			primaryDomain = 'System';
		}

		// Convert period from picoseconds to MHz
		// period is in ps, so frequency = 1 / (period * 1e-12) Hz = 1e12 / period Hz = 1e6 / period MHz
		const domain = domains[primaryDomain];
		const targetFrequencyMHz = 1_000_000 / domain.period; // period in ps -> MHz

		return {
			primaryDomain,
			targetFrequencyMHz
		};
	}

	/**
	 * Get clock and reset port names from manifest
	 */
	getClockResetPorts(manifest: ParsedClashManifest): {
		clocks: string[];
		resets: string[];
	} {
		const clocks: string[] = [];
		const resets: string[] = [];

		for (const port of manifest.top_component.ports_flat) {
			if (port.is_clock) {
				clocks.push(port.name);
			} else if (port.name.toUpperCase().includes('RST') || port.name.toUpperCase().includes('RESET')) {
				resets.push(port.name);
			}
		}

		return { clocks, resets };
	}

	/**
	 * Parse an SDC file for the target clock frequency.
	 * SDC files from Clash look like:
	 *   create_clock -name {CLK} -period 20.000 -waveform {0.000 10.000} [get_ports {CLK}]
	 * Returns frequency in MHz, or undefined if no clock constraint is found.
	 */
	async parseSdcFrequency(manifestDir: string): Promise<number | undefined> {
		// Find .sdc files in the manifest directory
		const entries = await fs.readdir(manifestDir);
		const sdcFiles = entries.filter(f => f.endsWith('.sdc'));

		for (const sdcFile of sdcFiles) {
			const content = await fs.readFile(path.join(manifestDir, sdcFile), 'utf8');
			const match = content.match(/create_clock\s+.*-period\s+([\d.]+)/);
			if (match) {
				const periodNs = parseFloat(match[1]);
				if (periodNs > 0) {
					return 1000 / periodNs; // ns -> MHz
				}
			}
		}

		return undefined;
	}

	/**
	 * Generate timing constraint information from manifest
	 */
	generateTimingConstraints(manifest: ParsedClashManifest): string {
		const constraints: string[] = [];
		
		constraints.push('# Timing Constraints Generated from Clash Manifest');
		constraints.push(`# Design: ${manifest.top_component.name}`);
		constraints.push('');

		// Clock constraints for each domain
		for (const [domainName, domain] of Object.entries(manifest.domains)) {
			const periodNs = domain.period / 1000; // ps to ns
			const freqMHz = 1000 / periodNs;

			constraints.push(`# Domain: ${domainName}`);
			constraints.push(`# Period: ${periodNs.toFixed(3)} ns (${freqMHz.toFixed(2)} MHz)`);

			// Find clock ports for this domain
			const clockPorts = manifest.top_component.ports_flat.filter(
				p => p.is_clock && p.domain === domainName
			);

			for (const clockPort of clockPorts) {
				constraints.push(`create_clock -period ${periodNs.toFixed(3)} [get_ports ${clockPort.name}]`);
			}

			constraints.push('');
		}

		return constraints.join('\n');
	}
}

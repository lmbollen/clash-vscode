import * as path from 'path';
import { promises as fs } from 'fs';
import { ClashManifest, ParsedClashManifest, ClashDomain } from './clash-manifest-types';

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

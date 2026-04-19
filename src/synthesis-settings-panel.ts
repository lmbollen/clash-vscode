import * as vscode from 'vscode';
import {
	SYNTHESIS_TARGETS,
	TARGET_IDS,
	getDefaultScript,
	computeScriptDiff,
	DiffLine,
} from './synthesis-targets';

/**
 * Webview panel for extension settings.
 *
 * Opened via the gear icon in the sidebar.  Contains a "Synthesis" section
 * with a target dropdown, an editable script textarea, and an inline diff
 * view when the script has been modified from its default.
 */
export class SynthesisSettingsPanel {
	private static currentPanel?: vscode.WebviewPanel;
	private static messageListener?: vscode.Disposable;
	private static configListener?: vscode.Disposable;

	/**
	 * Open (or reveal) the settings panel.
	 */
	static show(): void {
		const column = vscode.ViewColumn.One;

		if (SynthesisSettingsPanel.currentPanel) {
			SynthesisSettingsPanel.currentPanel.reveal(column);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'clashSettings',
			'Clash Synthesis Settings',
			column,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [],
			}
		);

		SynthesisSettingsPanel.currentPanel = panel;

		panel.onDidDispose(() => {
			SynthesisSettingsPanel.currentPanel = undefined;
			SynthesisSettingsPanel.messageListener?.dispose();
			SynthesisSettingsPanel.messageListener = undefined;
			SynthesisSettingsPanel.configListener?.dispose();
			SynthesisSettingsPanel.configListener = undefined;
		});

		// Listen to webview messages
		SynthesisSettingsPanel.messageListener = panel.webview.onDidReceiveMessage(
			async (message) => {
				const cfg = vscode.workspace.getConfiguration('clash-vscode-yosys');
				switch (message.type) {
					case 'changeTarget': {
						await cfg.update('synthesisTarget', message.targetId, vscode.ConfigurationTarget.Workspace);
						// sendState will be triggered by the config change listener
						break;
					}
					case 'saveScript': {
						const targetId = message.targetId as string;
						const script = message.script as string;
						const defaultScript = getDefaultScript(targetId);
						// If identical to default, clear the override
						if (script.trim() === defaultScript.trim()) {
							await cfg.update(`synthesisScript.${targetId}`, undefined, vscode.ConfigurationTarget.Workspace);
						} else {
							await cfg.update(`synthesisScript.${targetId}`, script, vscode.ConfigurationTarget.Workspace);
						}
						break;
					}
					case 'resetScript': {
						const targetId = message.targetId as string;
						await cfg.update(`synthesisScript.${targetId}`, undefined, vscode.ConfigurationTarget.Workspace);
						break;
					}
					case 'changeSynthesisMode': {
						await cfg.update('synthesisMode', message.mode, vscode.ConfigurationTarget.Workspace);
						break;
					}
					case 'ready': {
						SynthesisSettingsPanel.sendState(panel);
						break;
					}
				}
			}
		);

		// Re-send state when configuration changes (e.g. after save/reset)
		SynthesisSettingsPanel.configListener = vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('clash-vscode-yosys') && SynthesisSettingsPanel.currentPanel) {
				SynthesisSettingsPanel.sendState(SynthesisSettingsPanel.currentPanel);
			}
		});

		panel.webview.html = SynthesisSettingsPanel.buildHtml();
	}

	// -----------------------------------------------------------------------
	// State
	// -----------------------------------------------------------------------

	private static sendState(panel: vscode.WebviewPanel): void {
		const cfg = vscode.workspace.getConfiguration('clash-vscode-yosys');
		const targetId = cfg.get<string>('synthesisTarget', 'generic');
		const synthesisMode = cfg.get<string>('synthesisMode', 'per-module');
		const defaultScript = getDefaultScript(targetId);
		const customScript = cfg.get<string>(`synthesisScript.${targetId}`, '') || '';
		const diff: DiffLine[] = customScript
			? computeScriptDiff(defaultScript, customScript)
			: [];
		const targets = TARGET_IDS.map(id => ({
			id,
			label: SYNTHESIS_TARGETS.get(id)!.label,
		}));
		panel.webview.postMessage({
			type: 'state',
			targetId,
			synthesisMode,
			targets,
			defaultScript,
			customScript,
			diff,
		});
	}

	// -----------------------------------------------------------------------
	// HTML
	// -----------------------------------------------------------------------

	private static buildHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src 'unsafe-inline';
           script-src 'unsafe-inline';">
<title>Clash Synthesis Settings</title>
<style>
  :root {
    --pad: 16px;
    --radius: 4px;
    --gap: 10px;
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: var(--pad);
    overflow-y: auto;
    max-width: 800px;
  }

  h1 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 20px 0;
    border-bottom: 1px solid var(--vscode-editorWidget-border, #444);
    padding-bottom: 8px;
  }

  h2 {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    margin: 24px 0 12px 0;
  }
  h2:first-of-type { margin-top: 0; }

  /* ── Form controls ── */
  .field {
    margin-bottom: 14px;
  }
  .field label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .field .description {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 6px;
  }

  select {
    padding: 4px 8px;
    border: 1px solid var(--vscode-dropdown-border, #555);
    border-radius: var(--radius);
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    font-family: var(--vscode-font-family);
    font-size: 12px;
    min-width: 250px;
  }

  textarea {
    width: 100%;
    min-height: 280px;
    padding: 8px;
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: var(--radius);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    line-height: 1.6;
    resize: vertical;
    tab-size: 2;
  }
  textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    border-color: var(--vscode-focusBorder);
  }

  .btn {
    padding: 4px 12px;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

  .btn-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
  }

  .badge {
    display: inline-block;
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 8px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    vertical-align: middle;
    margin-left: 6px;
  }
  .badge.hidden { display: none; }

  .saved-msg {
    font-size: 11px;
    color: var(--vscode-testing-iconPassed, #4ec950);
    opacity: 0;
    transition: opacity 0.2s;
  }
  .saved-msg.show { opacity: 1; }

  /* ── Diff section ── */
  .diff-section {
    margin-top: 12px;
  }
  .diff-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
    padding: 4px 0;
  }
  .diff-header .chevron {
    font-size: 10px;
    transition: transform 0.15s;
  }
  .diff-header .chevron.open { transform: rotate(90deg); }

  .diff-body {
    display: none;
    border: 1px solid var(--vscode-editorWidget-border, #444);
    border-radius: var(--radius);
    background: var(--vscode-editor-background);
    padding: 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    line-height: 1.6;
    white-space: pre;
    overflow-x: auto;
    max-height: 300px;
    overflow-y: auto;
  }
  .diff-body.visible { display: block; }

  .diff-added {
    background: var(--vscode-diffEditor-insertedTextBackground, rgba(0,180,0,0.15));
  }
  .diff-removed {
    background: var(--vscode-diffEditor-removedTextBackground, rgba(220,0,0,0.15));
    text-decoration: line-through;
    opacity: 0.7;
  }

  .placeholder-help {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 6px;
    line-height: 1.5;
  }
  .placeholder-help code {
    background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
    padding: 1px 4px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
  }
</style>
</head>
<body>

<h1>Clash Synthesis Settings</h1>

<!-- ═══════════════════════════════════════════════════════════════════════ -->
<h2>Synthesis</h2>

<div class="field">
  <label for="target-select">Target</label>
  <div class="description">FPGA family used for Yosys synthesis.</div>
  <select id="target-select"></select>
</div>

<div class="field">
  <label for="synthesis-mode">Synthesis Mode</label>
  <div class="description">How multi-component designs are synthesized.</div>
  <select id="synthesis-mode">
    <option value="per-module">Per-module (individual diagrams)</option>
    <option value="whole-design">Whole-design (single netlist)</option>
  </select>
</div>

<div class="field">
  <label>
    Synthesis Script
    <span class="badge hidden" id="modified-badge">modified</span>
  </label>
  <div class="description">
    Yosys script for the selected target. Edit below to customise. Use placeholders for dynamic values.
  </div>
  <textarea id="script-editor" spellcheck="false"></textarea>
  <div class="placeholder-help">
    Placeholders:
    <code>{files}</code> input Verilog files &middot;
    <code>{topModule}</code> top module name &middot;
    <code>{outputDir}</code> output directory &middot;
    <code>{outputBaseName}</code> base filename
  </div>
  <div class="btn-row">
    <button class="btn" id="save-btn" onclick="saveScript()">Save</button>
    <button class="btn btn-secondary" id="reset-btn" onclick="resetScript()">Reset to Default</button>
    <span class="saved-msg" id="saved-msg">Saved</span>
  </div>
</div>

<!-- ── Diff view (shows when script differs from default) ── -->
<div class="diff-section" id="diff-section" style="display:none">
  <div class="diff-header" onclick="toggleDiff()">
    <span class="chevron" id="diff-chevron">&#9654;</span>
    <span>Changes from default</span>
  </div>
  <div class="diff-body" id="diff-body"></div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════ -->

<script>
const vscode = acquireVsCodeApi();

let currentTargetId = '';
let currentDefault = '';
let savedTimer = null;

// ── Target change ───────────────────────────────────────────────────────

document.getElementById('target-select').addEventListener('change', function() {
  vscode.postMessage({ type: 'changeTarget', targetId: this.value });
});

document.getElementById('synthesis-mode').addEventListener('change', function() {
  vscode.postMessage({ type: 'changeSynthesisMode', mode: this.value });
});

// ── Script editing ──────────────────────────────────────────────────────

const editor = document.getElementById('script-editor');

editor.addEventListener('input', function() {
  updateModifiedState();
});

// Allow Tab key to insert spaces in the textarea
editor.addEventListener('keydown', function(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = this.selectionStart;
    const end = this.selectionEnd;
    this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
    this.selectionStart = this.selectionEnd = start + 2;
    updateModifiedState();
  }
});

function updateModifiedState() {
  const isModified = editor.value.trim() !== currentDefault.trim();
  document.getElementById('modified-badge').classList.toggle('hidden', !isModified);

  // Live diff update
  if (isModified) {
    renderDiffFromTexts(currentDefault, editor.value);
    document.getElementById('diff-section').style.display = '';
  } else {
    document.getElementById('diff-section').style.display = 'none';
  }
}

function saveScript() {
  vscode.postMessage({
    type: 'saveScript',
    targetId: currentTargetId,
    script: editor.value,
  });

  // Flash "Saved" message
  const msg = document.getElementById('saved-msg');
  msg.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => msg.classList.remove('show'), 2000);
}

function resetScript() {
  vscode.postMessage({ type: 'resetScript', targetId: currentTargetId });
}

// ── Diff rendering ──────────────────────────────────────────────────────

function toggleDiff() {
  const body = document.getElementById('diff-body');
  const chevron = document.getElementById('diff-chevron');
  const visible = body.classList.toggle('visible');
  chevron.classList.toggle('open', visible);
}

function renderDiff(diff) {
  const body = document.getElementById('diff-body');
  body.innerHTML = '';
  for (const line of diff) {
    const div = document.createElement('div');
    if (line.kind === 'added') {
      div.className = 'diff-added';
      div.textContent = '+ ' + line.text;
    } else if (line.kind === 'removed') {
      div.className = 'diff-removed';
      div.textContent = '- ' + line.text;
    } else {
      div.textContent = '  ' + line.text;
    }
    body.appendChild(div);
  }
}

// Lightweight client-side diff for live updates while typing.
// The full LCS diff is sent from the extension when state loads.
function renderDiffFromTexts(defaultText, userText) {
  const a = defaultText.split('\\n');
  const b = userText.split('\\n');
  // Simple line-by-line comparison (not LCS, but fast for live typing)
  const maxLen = Math.max(a.length, b.length);
  const body = document.getElementById('diff-body');
  body.innerHTML = '';
  for (let i = 0; i < maxLen; i++) {
    const div = document.createElement('div');
    if (i >= a.length) {
      div.className = 'diff-added';
      div.textContent = '+ ' + b[i];
    } else if (i >= b.length) {
      div.className = 'diff-removed';
      div.textContent = '- ' + a[i];
    } else if (a[i] !== b[i]) {
      const rem = document.createElement('div');
      rem.className = 'diff-removed';
      rem.textContent = '- ' + a[i];
      body.appendChild(rem);
      div.className = 'diff-added';
      div.textContent = '+ ' + b[i];
    } else {
      div.textContent = '  ' + a[i];
    }
    body.appendChild(div);
  }
}

// ── State from extension host ───────────────────────────────────────────

window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.type === 'state') {
    renderState(msg);
  }
});

function renderState(msg) {
  // Populate target dropdown
  const sel = document.getElementById('target-select');
  if (sel.options.length === 0 || currentTargetId !== msg.targetId) {
    sel.innerHTML = '';
    for (const t of msg.targets) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      sel.appendChild(opt);
    }
  }
  sel.value = msg.targetId;
  currentTargetId = msg.targetId;

  // Synthesis mode
  document.getElementById('synthesis-mode').value = msg.synthesisMode;

  // Script editor: show custom script if set, otherwise default
  currentDefault = msg.defaultScript;
  const hasCustom = msg.customScript && msg.customScript.length > 0;
  editor.value = hasCustom ? msg.customScript : msg.defaultScript;

  // Modified badge
  document.getElementById('modified-badge').classList.toggle('hidden', !hasCustom);

  // Diff section
  if (hasCustom && msg.diff && msg.diff.length > 0) {
    document.getElementById('diff-section').style.display = '';
    renderDiff(msg.diff);
  } else {
    document.getElementById('diff-section').style.display = 'none';
  }
}

// Request initial state
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
	}
}

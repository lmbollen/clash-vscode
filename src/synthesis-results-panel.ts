import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { yosys2digitaljs } from 'yosys2digitaljs/core';
import { ModuleSynthesisResult } from './yosys-types';

/**
 * Persistent webview panel that shows per-module synthesis results and
 * provides inline DigitalJS circuit diagrams.
 *
 * Opened automatically after synthesis completes.  Stays open until
 * explicitly closed so the user can switch between modules and diagrams
 * at any time without being blocked by expiring notifications.
 */
export class SynthesisResultsPanel {
	private static currentPanel?: vscode.WebviewPanel;
	private static messageListener?: vscode.Disposable;

	// ── Persisted state so the panel can be reopened from the sidebar ──────
	private static _lastResults: ModuleSynthesisResult[] = [];
	private static _lastTitle: string = 'Synthesis Results';
	private static _lastOutputChannel?: vscode.OutputChannel;

	/** True once synthesis has produced results that can be shown. */
	static get hasResults(): boolean {
		return SynthesisResultsPanel._lastResults.length > 0;
	}

	/** The most recently stored module results. */
	static get lastResults(): ModuleSynthesisResult[] {
		return SynthesisResultsPanel._lastResults;
	}

	/**
	 * Persist synthesis results so they can be shown later via reopen().
	 * Does NOT open or reveal the panel.
	 */
	static store(
		moduleResults: ModuleSynthesisResult[],
		title: string,
		outputChannel: vscode.OutputChannel
	): void {
		SynthesisResultsPanel._lastResults = moduleResults;
		SynthesisResultsPanel._lastTitle = title;
		SynthesisResultsPanel._lastOutputChannel = outputChannel;
	}

	/**
	 * Re-open (or focus) the panel using the last stored synthesis results.
	 * Called from the sidebar "Open Panel" button.
	 */
	static reopen(initialModule?: string): void {
		if (!SynthesisResultsPanel.hasResults || !SynthesisResultsPanel._lastOutputChannel) {
			vscode.window.showInformationMessage(
				'No synthesis results available yet. Run synthesis first.'
			);
			return;
		}
		SynthesisResultsPanel.show(
			SynthesisResultsPanel._lastResults,
			SynthesisResultsPanel._lastTitle,
			SynthesisResultsPanel._lastOutputChannel,
			initialModule
		);
	}

	/**
	 * Open (or refresh) the results panel with new synthesis data.
	 * Pass `initialModule` to auto-open that module's diagram on load.
	 */
	static show(
		moduleResults: ModuleSynthesisResult[],
		title: string,
		outputChannel: vscode.OutputChannel,
		initialModule?: string
	): void {
		// Persist for later reopen via sidebar.
		SynthesisResultsPanel._lastResults = moduleResults;
		SynthesisResultsPanel._lastTitle = title;
		SynthesisResultsPanel._lastOutputChannel = outputChannel;
		const column = vscode.ViewColumn.Two;

		if (SynthesisResultsPanel.currentPanel) {
			SynthesisResultsPanel.currentPanel.reveal(column);
		} else {
			SynthesisResultsPanel.currentPanel = vscode.window.createWebviewPanel(
				'clashSynthesisResults',
				title,
				column,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots: []
				}
			);

			SynthesisResultsPanel.currentPanel.onDidDispose(() => {
				SynthesisResultsPanel.currentPanel = undefined;
				SynthesisResultsPanel.messageListener = undefined;
			});
		}

		SynthesisResultsPanel.currentPanel.title = title;

		// Dispose the old listener before registering a new one so that
		// re-runs don't accumulate stale handlers.
		SynthesisResultsPanel.messageListener?.dispose();

		const panel = SynthesisResultsPanel.currentPanel;

		SynthesisResultsPanel.messageListener = panel.webview.onDidReceiveMessage(
			async (message) => {
				if (message.type === 'showDiagram') {
					await SynthesisResultsPanel.sendCircuit(
						panel,
						message.moduleName,
						message.diagramJsonPath,
						outputChannel
					);
				}
			}
		);

		panel.webview.html = SynthesisResultsPanel.buildHtml(moduleResults, initialModule);
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Load a Yosys diagram JSON, convert to DigitalJS format, and post the
	 * circuit data to the webview.
	 */
	private static async sendCircuit(
		panel: vscode.WebviewPanel,
		moduleName: string,
		diagramJsonPath: string,
		outputChannel: vscode.OutputChannel
	): Promise<void> {
		try {
			const raw = await fs.readFile(diagramJsonPath, 'utf8');
			const yosysOutput = JSON.parse(raw);
			SynthesisResultsPanel.stripUnsupportedCells(yosysOutput);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const circuit = yosys2digitaljs(yosysOutput as any);
			panel.webview.postMessage({ type: 'circuitData', moduleName, circuit });
			outputChannel.appendLine(
				`Diagram loaded: ${moduleName} ` +
				`(${Object.keys((circuit as { devices?: Record<string, unknown> }).devices ?? {}).length} devices)`
			);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			outputChannel.appendLine(`ERROR loading diagram for ${moduleName}: ${msg}`);
			panel.webview.postMessage({ type: 'circuitError', moduleName, error: msg });
		}
	}

	/**
	 * Sanitise a Yosys JSON netlist so that yosys2digitaljs / DigitalJS can
	 * render it without crashing.  Two classes of unsupported constructs are
	 * handled:
	 *
	 * 1. Timing / specify cells ($specify2, $specify3, $specp, $print).
	 *    These are added by synth_ecp5 / synth_ice40 when mapping memories to
	 *    BRAM primitives that carry Verilog `specify` timing blocks.  They are
	 *    meaningless for circuit visualisation and are deleted.
	 *
	 * 2. `inout` port directions.  FPGA BRAM primitives (e.g. ECP5's DP16KD)
	 *    expose bidirectional data ports.  yosys2digitaljs rejects any port
	 *    whose direction is not "input" or "output".  We rewrite them as
	 *    "output" so the primitive renders as a readable black-box.
	 *
	 * Both fixes are defence-in-depth: the Yosys synthesis scripts already
	 * attempt to delete specify cells, but FPGA tech-mapping can re-introduce
	 * them after that step.
	 */
	private static stripUnsupportedCells(yosysJson: Record<string, unknown>): void {
		const unsupportedPrefixes = ['$specify', '$print'];

		const modules = yosysJson['modules'];
		if (!modules || typeof modules !== 'object') { return; }

		for (const mod of Object.values(modules as Record<string, unknown>)) {
			if (!mod || typeof mod !== 'object') { continue; }
			const modObj = mod as Record<string, unknown>;

			// 1. Remove timing cells.
			const cells = modObj['cells'];
			if (cells && typeof cells === 'object') {
				const cellMap = cells as Record<string, unknown>;
				for (const [name, cell] of Object.entries(cellMap)) {
					if (!cell || typeof cell !== 'object') { continue; }
					const type = (cell as Record<string, unknown>)['type'];
					if (typeof type === 'string' &&
						unsupportedPrefixes.some(p => type.startsWith(p))) {
						delete cellMap[name];
					}
				}
			}

			// 2. Rewrite inout port directions to output.
			//    DigitalJS only accepts "input" and "output".
			const ports = modObj['ports'];
			if (ports && typeof ports === 'object') {
				for (const port of Object.values(ports as Record<string, unknown>)) {
					if (!port || typeof port !== 'object') { continue; }
					const portObj = port as Record<string, unknown>;
					if (portObj['direction'] === 'inout') {
						portObj['direction'] = 'output';
					}
				}
			}
		}
	}

	/**
	 * Serialise module results for embedding in the webview.
	 * Maps and other non-JSON-serialisable fields are normalised here.
	 */
	private static serialise(results: ModuleSynthesisResult[]) {
		return results.map(r => ({
			name: r.name,
			diagramJsonPath: r.diagramJsonPath ?? null,
		}));
	}

	// -----------------------------------------------------------------------
	// HTML generation
	// -----------------------------------------------------------------------

	private static buildHtml(moduleResults: ModuleSynthesisResult[], initialModule?: string): string {
		const data = SynthesisResultsPanel.serialise(moduleResults);
		const dataJson = JSON.stringify(data);
		const initialModuleJson = JSON.stringify(initialModule ?? null);

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src 'unsafe-inline';
           script-src 'unsafe-inline' https://cdn.jsdelivr.net;
           img-src 'self' data: blob:;
           font-src data: https://cdn.jsdelivr.net;">
<title>Synthesis Results</title>
<style>
  :root {
    --pad: 12px;
    --radius: 4px;
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: var(--pad);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .btn {
    padding: 3px 10px;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn-sm {
    padding: 2px 8px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-sm:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* ── Diagram section ── */
  .diagram-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .diagram-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    flex-shrink: 0;
  }
  .diagram-title { font-weight: 600; font-size: 12px; }
  #diagram-placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    border: 1px dashed var(--vscode-editorWidget-border, #555);
    border-radius: var(--radius);
  }
  #paper-container {
    flex: 1;
    display: none;
    background: #fff;
    border-radius: var(--radius);
    overflow: hidden;
    position: relative;
  }
  #paper { position: absolute; inset: 0; }
  #paper svg { overflow: visible !important; }
  .loading-msg {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
  .error-msg {
    flex: 1;
    padding: 12px;
    background: var(--vscode-inputValidation-errorBackground);
    color: var(--vscode-errorForeground);
    border-radius: var(--radius);
    font-size: 12px;
  }
  .controls { display: flex; gap: 6px; align-items: center; }
  .separator { color: var(--vscode-descriptionForeground); }

</style>
</head>
<body>

<!-- ── Diagram viewer ── -->
<div class="diagram-section">
  <div class="diagram-header">
    <span class="diagram-title" id="diagram-title">Circuit Diagram</span>
    <div class="controls">
      <button class="btn btn-sm" onclick="zoomIn()">+ Zoom</button>
      <button class="btn btn-sm" onclick="zoomOut()">− Zoom</button>
      <button class="btn btn-sm" onclick="zoomFit()">Fit</button>
    </div>
  </div>
  <div id="diagram-placeholder">Open a diagram from the Synthesis Results panel</div>
  <div class="loading-msg" id="loading-msg" style="display:none">Loading diagram…</div>
  <div class="error-msg"   id="error-msg"   style="display:none"></div>
  <div id="paper-container"><div id="paper"></div></div>
</div>

<!--
  DigitalJS dist/main.js is a self-contained webpack bundle that includes
  jQuery, jQuery-UI, @joint/core 4.x, elkjs, and backbone.
  Loading those separately creates conflicting globals — don't do it.
-->
<script src="https://cdn.jsdelivr.net/npm/digitaljs@0.14.2/dist/main.js"></script>

<script>
const vscode = acquireVsCodeApi();
const moduleData = ${dataJson};
const initialModule = ${initialModuleJson};

// Auto-open diagram for the module that was clicked in the sidebar.
if (initialModule !== null) {
  const idx = moduleData.findIndex(m => m.name === initialModule);
  if (idx >= 0) { requestDiagram(idx); }
}

// ── Diagram loading ──────────────────────────────────────────────────────

let currentCircuit = null;
let currentPaper = null;
let _realFitToContent = null; // preserved before we override paper.fitToContent
let initialFitDone = false;   // true once the first auto-fit has run
let fitTimer = null;          // debounce timer for initial auto-fit
let isPanning = false, panStartX = 0, panStartY = 0, panStartTx = 0, panStartTy = 0;

const ZOOM_FACTOR = 1.12;
const MIN_SCALE = 0.05, MAX_SCALE = 10;

function requestDiagram(idx) {
  const m = moduleData[idx];
  if (!m.diagramJsonPath) { return; }

  document.getElementById('diagram-title').textContent = 'Circuit: ' + m.name;

  // Show loading state
  document.getElementById('diagram-placeholder').style.display = 'none';
  document.getElementById('paper-container').style.display = 'none';
  document.getElementById('error-msg').style.display = 'none';
  document.getElementById('loading-msg').style.display = 'flex';

  vscode.postMessage({ type: 'showDiagram', moduleName: m.name, diagramJsonPath: m.diagramJsonPath });
}

// Receive messages from the extension host
window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.type === 'circuitData') {
    renderCircuit(msg.circuit);
  } else if (msg.type === 'circuitError') {
    document.getElementById('loading-msg').style.display = 'none';
    document.getElementById('error-msg').style.display = 'flex';
    document.getElementById('error-msg').textContent = 'Failed to load diagram: ' + msg.error;
  }
});

// ── DigitalJS rendering ──────────────────────────────────────────────────

function renderCircuit(circuitData) {
  document.getElementById('loading-msg').style.display = 'none';

  // Tear down previous circuit and reset auto-fit state.
  clearTimeout(fitTimer);
  initialFitDone = false;
  _realFitToContent = null;
  if (currentCircuit) {
    try { currentCircuit.stop(); } catch {}
    currentCircuit = null;
    currentPaper = null;
    document.getElementById('paper').innerHTML = '';
  }

  try {
    currentCircuit = new digitaljs.Circuit(circuitData);
    // displayOn() accepts a plain DOM element (no jQuery required)
    currentPaper = currentCircuit.displayOn(document.getElementById('paper'));

    if (currentPaper) {
      // ── Block DigitalJS's permanent fitToContent ──────────────────────
      //
      // DigitalJS._makePaper() installs a permanent listener:
      //   this.listenTo(paper, 'render:done', () => paper.fitToContent(...))
      //
      // ELK layout is async; it finishes after the user may have already
      // panned/zoomed, and its completion triggers render:done → fitToContent
      // which resets the view to top-left.
      //
      // Fix: replace paper.fitToContent with a no-op.  The permanent listener
      // then has no effect.  We keep _realFitToContent for the zoomFit button
      // and for the one-time debounced initial auto-fit below.
      _realFitToContent = currentPaper.fitToContent.bind(currentPaper);
      currentPaper.fitToContent = () => {};

      const container = document.getElementById('paper-container');
      currentPaper.setDimensions(container.clientWidth, container.clientHeight);

      // Do ONE initial fit after ELK layout has settled.
      // Debounce: each render:done resets the timer; 300 ms of quiet = stable.
      currentPaper.on('render:done', () => {
        if (initialFitDone) { return; }
        clearTimeout(fitTimer);
        fitTimer = setTimeout(() => {
          if (!initialFitDone && _realFitToContent) {
            _realFitToContent({ padding: 30, allowNewOrigin: 'any' });
            initialFitDone = true;
          }
        }, 300);
      });

      attachPaperEvents(currentPaper.el);
    }

    document.getElementById('paper-container').style.display = 'block';
  } catch (err) {
    document.getElementById('error-msg').style.display = 'flex';
    document.getElementById('error-msg').textContent = 'Render error: ' + err.message;
  }
}

// ── Pan / zoom ───────────────────────────────────────────────────────────
//
// JointJS 4.x matrix: screen_pos = scale * world_pos + translate
//   paper.scale()     → { sx, sy }   scale factors
//   paper.translate() → { tx, ty }   screen-space pixel offsets
//
// Zoom toward screen point (cx, cy):
//   world  = (cursor − translate) / scale
//   new_tx = cursor − newScale × world     (keeps world point under cursor)
//
// Pan: translate delta is a raw screen-pixel delta — do NOT divide by scale.

function zoomAtPoint(newScale, cx, cy) {
  if (!currentPaper) { return; }
  newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
  const { sx: oldScale }   = currentPaper.scale();
  const { tx: oldTx, ty: oldTy } = currentPaper.translate();
  const worldX = (cx - oldTx) / oldScale;
  const worldY = (cy - oldTy) / oldScale;
  // paper.scale() / paper.translate() write directly to the SVG matrix.
  // Do NOT call freeze/resetCells/unfreeze — that triggers render:done which
  // fires DigitalJS's permanent fitToContent listener and overrides the zoom.
  currentPaper.scale(newScale);
  currentPaper.translate(cx - newScale * worldX, cy - newScale * worldY);
}

function zoomFit() {
  if (!_realFitToContent) { return; }
  try {
    _realFitToContent({ padding: 30, allowNewOrigin: 'any' });
  } catch {}
}

function zoomIn() {
  if (!currentPaper) { return; }
  const { sx } = currentPaper.scale();
  const c = document.getElementById('paper-container');
  zoomAtPoint(sx * ZOOM_FACTOR, c.clientWidth / 2, c.clientHeight / 2);
}
function zoomOut() {
  if (!currentPaper) { return; }
  const { sx } = currentPaper.scale();
  const c = document.getElementById('paper-container');
  zoomAtPoint(sx / ZOOM_FACTOR, c.clientWidth / 2, c.clientHeight / 2);
}

function attachPaperEvents(el) {
  el.addEventListener('wheel', e => {
    e.preventDefault();
    // User is interacting — cancel any pending auto-fit.
    initialFitDone = true;
    clearTimeout(fitTimer);
    const rect = el.getBoundingClientRect();
    const { sx: s } = currentPaper.scale();
    zoomAtPoint(
      s * (e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR),
      e.clientX - rect.left,
      e.clientY - rect.top
    );
  }, { passive: false });

  el.addEventListener('pointerdown', e => {
    if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
      // User is panning — cancel any pending auto-fit.
      initialFitDone = true;
      clearTimeout(fitTimer);
      isPanning = true;
      panStartX = e.clientX; panStartY = e.clientY;
      ({ tx: panStartTx, ty: panStartTy } = currentPaper.translate());
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });
  el.addEventListener('pointermove', e => {
    if (!isPanning) { return; }
    // Screen-space translate: delta is raw pixels, no scale division.
    currentPaper.translate(
      panStartTx + (e.clientX - panStartX),
      panStartTy + (e.clientY - panStartY)
    );
  });
  el.addEventListener('pointerup', e => {
    if (isPanning) { isPanning = false; el.releasePointerCapture(e.pointerId); }
  });
}

window.addEventListener('resize', () => {
  if (currentPaper) {
    const c = document.getElementById('paper-container');
    currentPaper.setDimensions(c.clientWidth, c.clientHeight);
  }
});

document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) { return; }
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
  else if (e.key === '-') { e.preventDefault(); zoomOut(); }
  else if (e.key === '0') { e.preventDefault(); zoomFit(); }
});
</script>
</body>
</html>`;
	}
}

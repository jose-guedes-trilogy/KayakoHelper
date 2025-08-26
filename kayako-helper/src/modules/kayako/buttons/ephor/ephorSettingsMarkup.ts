/* Kayako Helper – ephorSettingsMarkup.ts (v2.6.2 – keep modal width stable when opening log) */

export const EPHOR_SETTINGS_MARKUP = /* HTML */ `
  <style>
    /* ---------- shared variables ---------- */
    #kh-ephor-settings-modal { 
        --kh-input-border: hsl(213deg 15% 84%);
        --kh-input-shadow: inset 0 0 4px 0 hsla(0,0%,0%,0.0325), inset 0 0 2px 0 hsla(0,0%,0%,0.0805), inset 0 0 1px 0 hsla(0,0%,0%,0.089);
        --kh-input-bg: #fff;
        /* Make UI labels/text non-selectable by default; inputs stay selectable */
        -webkit-user-select: none; user-select: none;
    }
    /* Allow selecting inside inputs and textareas */
    #kh-ephor-settings-modal input,
    #kh-ephor-settings-modal textarea,
    #kh-ephor-settings-modal select,
    #kh-ephor-settings-modal pre { -webkit-user-select: text; user-select: text; }
    .kh-btn {
        padding: 4px 12px;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        font: inherit;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .kh-btn:hover {
        background: #f5f7ff;
        border-color: #99a;
    }
    
    .kh-btn:active {
        transform: translateY(1px);
    }
    
    /* click feedback */
    .kh-btn-primary {
        background: #2e73e9;
        color: #fff;
        border-color: #2e73e9;
    }
    
    .kh-btn-primary:hover {
        background: #255ecd;
        color: #fff;
    }
    
    .kh-btn-primary:active {
        transform: translateY(1px);
    }
    
    /* click feedback */
    
    /* ---------- tab / stage buttons ---------- */
    .kh-bar-btn {
        border: none;
        background: none;
        cursor: pointer;
        padding: 4px 12px;
        border-radius: 4px;
    }
    
    .kh-bar-btn:active {
        transform: translateY(1px);
    }
    
    /* click feedback */
    .kh-bar-btn.active {
        background: hsl(217 100% 98% / 1);
        color: #2e2e2e;
        border: 1px solid hsl(217deg 23.71% 80%);
    }
    
    /* ---------- list labels ---------- */
    #kh-ephor-ai-list label {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        cursor: pointer;
        border-radius: 3px;
    }
    
    /* ---------- alternating rows for lists ---------- */
    #kh-ephor-project-list > *:nth-child(odd),
    #kh-ephor-channel-list > *:nth-child(odd),
    #kh-ephor-ai-list > *:nth-child(odd) {
        background: hsl(213 20% 98% / 1);
    }
    #kh-ephor-project-list > *:nth-child(even),
    #kh-ephor-channel-list > *:nth-child(even),
    #kh-ephor-ai-list > *:nth-child(even) {
        background: hsl(213 15% 94% / 1);
    }
    /* unified row hover */
    #kh-ephor-project-list > *:hover,
    #kh-ephor-channel-list > *:hover, #kh-ephor-ai-list label:hover {
        background: hsl(216deg 68% 93%);
    }
    
    /* ---------- stage bar ---------- */
    #kh-ephor-stage-bar {
    
    padding: 2px 12px 2px 2px;
    }
    #kh-ephor-stage-bar button,
    #kh-ephor-stage-bar>span {
        padding: 0 10px;
        border-radius: 4px;
        cursor: pointer;
        
        &:first-child {
            padding-left: 0;
        }
    }
    
    #kh-ephor-stage-bar .active {
        background: hsl(216 20% 98% / 1);
        color: #333;
        border: 1px solid #cfd3d9;
    }
    /* stage tab buttons: hover styles for active and inactive */
    #kh-ephor-stage-bar .kh-bar-btn:not(.active) { border: 1px solid transparent; transition: background .12s ease, border-color .12s ease, color .12s ease; }
    #kh-ephor-stage-bar .kh-bar-btn:hover { background:hsl(217 40% 98% / 1); color:#1a2b4f; border-color:#adc1e3; }
    #kh-ephor-stage-bar .kh-bar-btn.active:hover { background: #e4edfd; border-color:#88a5da; }
    
    #kh-ephor-stage-bar .kh-stage {
        position: relative;
        display: inline-flex;
        align-items: center;
    }
    
    #kh-ephor-stage-bar .kh-del {
        font-weight: 600;
        display: none;
        position: absolute;
        top: -2px;
        right: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        border: 1px solid #adc1e3;
        color: #1a2b4f;
        line-height: 1.2;
        font-size: 12px;
        text-align: center;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(0,0,0,.06);
        transition: background .12s ease, color .12s ease, transform .05s ease, border-color .12s ease;
    }
    #kh-ephor-stage-bar .kh-del:hover { background:#f5f7ff; color:#0f2a66; border-color:#88a5da; }
    #kh-ephor-stage-bar .kh-del:active { transform: translateY(1px); background:#e8f0ff; }
    #kh-ephor-stage-bar .kh-del:focus { outline: none; box-shadow: 0 0 0 2px rgba(46,115,233,.25); }
    
    #kh-ephor-stage-bar .kh-stage:hover .kh-del {
        display: block;
    }

    /* ---------- ensure AI list exact height ---------- */
    #kh-ephor-ai-list { height:200px !important; min-height:200px !important; box-sizing:border-box; }

    /* ---------- top tabs (Settings / Outputs) ---------- */
    #kh-ephor-tab-settings, #kh-ephor-tab-outputs {
        border: 1px solid transparent;
        transition: background .12s ease, border-color .12s ease, color .12s ease;
    }
    #kh-ephor-tab-settings:hover, #kh-ephor-tab-outputs:hover {
        background: #f5f7ff; color:#1a2b4f; border-color:#adc1e3;
    }
    #kh-ephor-tab-settings.active, #kh-ephor-tab-outputs.active {
        background: hsl(210 60% 98% / 1);
        color: #373737;
        border-color: hsl(217.86deg 53.85% 73.02%);
        font-weight: 600;
    }
    
    /* ---------- inputs ---------- */
    input[type="text"],
    input[type="search"],
    select,
    textarea {
        border: 1px solid var(--kh-input-border);
        border-radius: 4px;
        background: var(--kh-input-bg);
        box-shadow: var(--kh-input-shadow);
    }
    input[type="text"]:focus,
    input[type="search"]:focus,
    textarea:focus {
        outline: none;
        border-color: #89b5ff !important;
        box-shadow: 0 0 0 2px rgba(46,115,233,.15) !important;
    }

    /* native select adjustments and custom chevron */
    .kh-select-wrap select { appearance: none; -webkit-appearance: none; -moz-appearance: none; }
    .kh-select-wrap::after {
        content: "▾";
        position: absolute;
        right: 9px; /* chevron moved ~3px left */
        color: #223;
        pointer-events: none;
        font-size: 12px;
    }
    
    input[type="radio"] {
        position: relative;
        top: 2px;
        margin-right: 1px;
    }
    
    /* align radios with labels */
    /* ⬇ move Verbose checkbox down 2 px */
    #kh-ephor-log-verbose {
        position: relative;
        top: 2px;
    }
    /* prevent layout shift when toggling instruction scope label */
    #kh-ephor-instr-label { display:inline-block; min-width:220px; }
    
    /* ---------- placeholder buttons ---------- */
    .kh-ph-btn {
        padding: 2px 8px;
        font-size: 12px;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
    }
    
    .kh-ph-btn[disabled] {
        opacity: .35;
        pointer-events: none;
    }
    
    .kh-ph-btn:hover:not([disabled]) { background:#f3f7ff; border-color:#adc1e3; color:#1a2b4f; }
    .kh-ph-btn:active { background:#e0eaff; border-color:#88a5da; transform: translateY(1px); }
    
    /* ---------- output tabs ---------- */
    #kh-model-tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 6px;
    }
    
    /*#kh-model-tabs button {*/
    /*    border: none;*/
    /*    background: none;*/
    /*    padding: 4px 10px;*/
    /*    border-radius: 4px;*/
    /*    cursor: pointer;*/
    /*}*/
    
    /*#kh-model-tabs button.active {*/
    /*    background: #2e73e9;*/
    /*    color: #fff;*/
    /*}*/
    
    #kh-model-content textarea {
        width: 100%;
        height: 300px;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 6px;
        font-family: monospace;
        resize: vertical;
    }
    
    /* ---------- misc ---------- */
    #kh-ephor-progress {
        font-weight: 600;
        margin-right: 6px;
    }
    
    /* ---------- split placeholder buttons ---------- */
    .kh-split-btn-wrapper {
        display: inline-flex;
        position: relative;
    }
    
    .kh-split-main {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        border-right: none;
    }
    
    .kh-split-drop {
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        width: 22px;
        padding: 2px;
        text-align: center;
        font-size: 12px;
    }
    
    .kh-ph-menu {
        position: absolute;
        top: 100%;
        right: 0;
        display: none;
        background: #fff;
        border: 1px solid #ccc;
        border-radius: 4px;
        z-index: 10002;
        min-width: 120px;
    }
    
    .kh-ph-menu div {
        padding: 4px 8px;
        cursor: pointer;
        white-space: nowrap;
    }
    
    .kh-ph-menu div:hover {
        background: #f3f3f3;
    }
    
    /* ---------- split rows (label left, content right) ---------- */
    .kh-split-row {
        display: flex;
        margin-left: -16px;
    }
    
    .kh-split-left {
        font-size: 1.075em;
        width: 80px;
        background: #fff;
        padding: 8px 12px;
        text-align: center;    
    }
  
    
    /* ---------- segmented row helpers (alternating white/grey) ---------- */
    .kh-seg-label {
        background: #fff;
        padding: 8px 12px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        font-size: 1.075em;
        justify-content: center;
    }

    /* Restore fixed width for labels in segmented rows (default) */
    .kh-split-row > .kh-seg-label {
        width: 96px;
        min-width: 96px;
        flex: 0 0 96px;
        text-align: center;
    }

    /* Only the top settings row uses padded labels instead of fixed width */
    #kh-top-settings-row > .kh-seg-label { width:auto; min-width:auto; flex:0 0 auto; padding-left:32px; padding-right:32px; }
    
    .kh-seg {
        background: hsl(213 20% 97% / 1);
        border: 1px solid var(--kh-input-border);
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        gap: 12px;
        padding: 4px 12px;
        
        box-shadow: var(--kh-input-shadow);
    }
    
    /* stage bar disabled (single-stage mode) */
    .kh-stagebar-disabled{opacity:.45;pointer-events:none;}

    /* ---------- custom dropdown (Sort) ---------- */
    .kh-dropdown{position:relative;display:inline-flex;align-items:center;}
    .kh-dd-btn{display:inline-flex;align-items:center;gap:6px;padding:2px 6px;background: #f9f9f9;border: 1px solid hsl(217.78deg 25.82% 77.71%);border-radius:4px;cursor:pointer;}
    .kh-dd-menu{position:absolute;top:100%;right:0;display:none;background:#fff;border:1px solid #adc1e3;border-radius:4px;z-index:10003;min-width:120px;box-shadow:0 4px 12px rgba(0,0,0,.06);}    
    .kh-dd-menu div{padding:6px 10px;cursor:pointer;white-space:nowrap;}
    .kh-dd-menu div:hover{background:#f3f7ff;}

    /* hide native select but keep for events/state */
    .kh-visually-hidden{position:absolute !important;opacity:0 !important;pointer-events:none !important;width:0 !important;height:0 !important;}

    /* ---------- placeholder pill ---------- */
    .kh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 8px;background:#f5f7ff;border:1px solid #adc1e3;color:#1a2b4f;font-size:12px;}
    .kh-pill::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#2e73e9;}

    /* ---------- inline dialog ---------- */
    .kh-dialog-overlay{position:absolute;inset:0;background:rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;z-index:10004;}
    .kh-dialog{background:#fff;border:1px solid #adc1e3;border-radius:8px;min-width:420px;max-width:80%;box-shadow:0 8px 24px rgba(0,0,0,.12);} 
    .kh-dialog header{padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;}
    .kh-dialog main{padding:12px;}
    .kh-dialog footer{padding:10px 12px;border-top:1px solid #eee;display:flex;gap:8px;justify-content:flex-end;}

    /* ---------- header title centered ---------- */
    .kh-ephor-header{position:relative;}
    .kh-ephor-header h2{position:absolute;left:50%;transform:translateX(-50%);}

    /* ---------- rounded scrollbars (WebKit) ---------- */
    #kh-ephor-settings-modal{contain:content;}
    #kh-ephor-project-list::-webkit-scrollbar,
    #kh-ephor-channel-list::-webkit-scrollbar,
    #kh-ephor-ai-list::-webkit-scrollbar,
    #kh-ephor-log-container::-webkit-scrollbar,
    textarea::-webkit-scrollbar,
    .kh-dialog main::-webkit-scrollbar{width:12px;height:12px;}
    
    #kh-ephor-project-list::-webkit-scrollbar-thumb,
    #kh-ephor-channel-list::-webkit-scrollbar-thumb,
    #kh-ephor-ai-list::-webkit-scrollbar-thumb,
    textarea::-webkit-scrollbar-thumb,
    .kh-dialog main::-webkit-scrollbar-thumb{background:#c7cedb;border-radius:10px;border:3px solid #fff;}
    #kh-ephor-log-container::-webkit-scrollbar-thumb{background:#bfc6d6;border-radius:10px;border:3px solid #f0f0f0;}
    
    #kh-ephor-project-list::-webkit-scrollbar-track,
    #kh-ephor-channel-list::-webkit-scrollbar-track,
    #kh-ephor-ai-list::-webkit-scrollbar-track,
    #kh-ephor-log-container::-webkit-scrollbar-track,
    textarea::-webkit-scrollbar-track,
    .kh-dialog main::-webkit-scrollbar-track{background:transparent;border-radius:10px;}
  </style>

  <!-- ===== Header ===== -->
  <div class="kh-ephor-header" style="display:flex;align-items:center;gap:12px;cursor:move;padding-top:12px;">
    <h2 style="margin:0;font-size:16px;">Ephor – Settings & Manual Send</h2>
    <span style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;">
      <button id="kh-ephor-gear" class="kh-btn" title="Settings">⚙️</button>
      <button id="kh-ephor-close" class="kh-btn kh-close-button">✕</button>
    </span>
  </div>

  <!-- ===== Settings row (segmented) ===== -->
  <div id="kh-top-settings-row" class="kh-split-row" style="display:flex;align-items:center;gap:8px;">
    <div class="kh-seg-label"><strong>Mode</strong></div>
    <span class="kh-seg">
      <label><input type="radio" name="kh-ephor-mode" id="kh-ephor-mode-multiplexer" value="multiplexer"> API</label>
      <label><input type="radio" name="kh-ephor-mode" id="kh-ephor-mode-stream" value="stream"> Normal</label>
    </span>
    <div class="kh-seg-label"><strong>Workflow</strong></div>
    <span class="kh-seg">
      <label><input type="radio" name="kh-query-mode" id="kh-query-single"  value="single"> Single stage</label>
      <label><input type="radio" name="kh-query-mode" id="kh-query-workflow" value="workflow"> Multi-stage</label>
    </span>
    <div class="kh-seg-label"><strong>Run</strong></div>
    <span class="kh-seg" id="kh-ephor-run-row">
      <label><input type="radio" name="kh-run-mode" id="kh-run-auto"   value="automatic"> Auto</label>
      <label><input type="radio" name="kh-run-mode" id="kh-run-manual" value="manual"> Manual</label>
    </span>
    <span style="flex:1 1 auto;"></span>
  </div>

  <!-- ===== Main tabs ===== -->
  <div style="display:flex;gap:6px;">
    <button id="kh-ephor-tab-settings" class="kh-bar-btn active">Prompt Setup</button>
    <button id="kh-ephor-tab-outputs"  class="kh-bar-btn">AI Outputs</button>
  </div>

  <!-- ===== Workflows row (save/load/delete/switch) ===== -->
  <div class="kh-split-row" style="margin-top:4px;align-items:center;gap:8px;">
    <div class="kh-seg-label" title="Workflows save your setup (mode, models, stages). Load one to reuse."><strong>Workflows</strong></div>
    <div class="kh-seg" style="flex: 1; padding:4px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <label for="kh-workflow-select" style="font-weight:600;">Current:</label>
      <span class="kh-select-wrap" style="position:relative;display:inline-flex;align-items:center;">
        <select id="kh-workflow-select" style="min-width:220px;padding:4px 28px 4px 6px;"></select>
      </span>
      <span style="position:relative;display:inline-flex;align-items:center;">
        <input id="kh-workflow-name" type="text" placeholder="Name…"
               style="min-width:220px;padding:4px 26px 4px 6px;">
        <button id="kh-workflow-name-clear" class="kh-btn" title="Clear name"
                style="position:absolute;right:2px;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;">×</button>
      </span>
      <span style="flex: 1; justify-content: space-around;display:inline-flex;gap:6px;align-items:center;">
        <button id="kh-workflow-save" class="kh-btn">💾 Save</button>
        <button id="kh-workflow-load" class="kh-btn">📥 Load</button>
        <button id="kh-workflow-delete" class="kh-btn">🗑 Delete</button>
      </span>
    </div>
  </div>

  <!-- ===== Stage bar (split) ===== -->
  <div class="kh-split-row" style="margin-top:0;margin-bottom: 6px;gap:8px;">
    <div class="kh-seg-label" title="Stages are steps inside a workflow. Each stage can prompt and collect outputs."><strong>Stages</strong></div>
    <div class="kh-seg" style="flex:1;">
      <div id="kh-ephor-stage-bar" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding: 0 2px;"></div>
    </div>
  </div>

  <!-- ===== Pane: SETTINGS ===== -->
  <div id="kh-ephor-pane-settings">
    <!-- (projects / chats / models grid) -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:20px;">
      <!-- 1. Projects -->
      <div>
        <p id="kh-title-projects" style="margin:0 0 4px;font-weight:600;cursor:pointer;">1. Select Project</p>
        <div id="kh-proj-body">
          <input id="kh-ephor-project-search" type="search" placeholder="Search projects…"
                 style="width:100%;padding:4px 6px;margin-bottom:8px;">
          <div id="kh-ephor-project-list"
               style="height:200px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;"></div>
          <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end;">
            <button id="kh-ephor-browse-projects" class="kh-btn" title="Browse available projects">📚 Browse</button>
            <button id="kh-ephor-refresh-projects" class="kh-btn">🔄 Refresh Projects</button>
          </div>
        </div>
        <div id="kh-proj-collapsed" class="kh-collapsed-note" style="display:none;text-align:center;font-style:italic;color:#444;">Click to expand</div>
      </div>
      <!-- 2. Chats -->
      <div style="position:relative;">
        <p id="kh-title-chats" style="margin:0 0 4px;font-weight:600;display:flex;align-items:center;gap:8px;cursor:pointer;">
          <span>2. Select Chat</span>
        </p>
        <!-- absolutely positioned sort control (does not affect flow) -->
        <span style="position:absolute;right:0;top:-6px;font-weight:400;color:#333;font-size:12px;display:inline-flex;align-items:center;gap:6px;background:#fff;">
          <label for="kh-ephor-chat-sort" style="font-weight:600;">Sort:</label>
          <select id="kh-ephor-chat-sort" class="kh-visually-hidden">
            <option value="alpha">A–Z</option>
            <option value="created">Newest</option>
          </select>

          <div class="kh-dropdown" id="kh-sort-dd">
            <button type="button" class="kh-dd-btn" aria-haspopup="listbox" aria-expanded="false">
              <span id="kh-sort-dd-label">A–Z</span>
              <span>▾</span>
            </button>
            <div class="kh-dd-menu" role="listbox">
              <div role="option" data-value="alpha">A–Z</div>
              <div role="option" data-value="created">Newest</div>
            </div>
          </div>
        </span>
        <div id="kh-chat-body">
          <input id="kh-ephor-channel-search" type="search" placeholder="Search chats…"
                 style="width:100%;padding:4px 6px;margin-bottom:8px;">
          <div id="kh-ephor-channel-list"
               style="height:200px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;"></div>
          <div style="margin-top:8px;display:flex;justify-content:flex-end;">
            <button id="kh-ephor-new-chat" class="kh-btn">➕ New Chat</button>
          </div>
        </div>
        <div id="kh-chat-collapsed" class="kh-collapsed-note" style="display:none;text-align:center;font-style:italic;color:#444;">Click to expand</div>
      </div>
      <!-- 3. Models -->
      <div>
        <p id="kh-title-models" style="margin:0 0 4px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;">
          <span>3. Select AI Models</span>
          <span id="kh-model-saved-note" style="color:#2e73e9;font-weight:500;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;"></span>
        </p>
        <div id="kh-model-body">
          <input id="kh-ephor-model-search" type="search" placeholder="Search models…"
                 style="width:100%;padding:4px 6px;margin-bottom:6px;">
          <div id="kh-ephor-ai-list"
               style="height:200px;min-height:200px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;"></div>
          <!-- AI Selections toolbar (preset buttons + gear) -->
          <div id="kh-ai-sel-toolbar" style="margin-top:8px;display:flex;align-items:center;gap:8px;">
            <div id="kh-ai-sel-row" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;"></div>
            <span style="flex:1 1 auto;"></span>
            <button id="kh-ai-sel-gear" class="kh-btn" title="AI Selections">⚙️</button>
          </div>
        </div>
        <div id="kh-model-collapsed" class="kh-collapsed-note" style="display:none;text-align:center;font-style:italic;color:#444;">Click to expand</div>
      </div>
    </div>

    <!-- per-ticket custom instructions (scope toggle) -->
    <div style="margin-top:10px;">
      <p style="margin:0 0 4px;font-weight:600;display:flex;align-items:center;gap:10px;justify-content: space-between;">
        <span id="kh-ephor-instr-label">4. Per-ticket Instructions</span>
        <label style="font-weight:normal;color:#333;">
          <input type="checkbox" id="kh-ephor-instr-scope" style="position:relative;top:2px;"> Save instructions per-stage instead
        </label>
      </p>
      <textarea id="kh-ephor-custom-instr"
                placeholder="Optional: saved for this Kayako ticket. These lines will be prepended to prompts."></textarea>
      <p style="margin:4px 0 0;color:#666;font-size:12px;">
        Scope applies to workflow runs. When checked, the same instructions are used for all stages of the ticket.
      </p>
    </div>

    <!-- prompt / default instructions -->
    <div style="margin-top:10px;">
      <p style="margin:0 0 4px;font-weight:600;">5. Default Instructions</p>

      <!-- Insert row (segmented) -->
      <div class="kh-split-row" style="margin-bottom:6px;align-items:center;gap:15px;">
        <div class="kh-seg-label"><strong>Insert</strong></div>
        <div class="kh-seg" style="flex:1 1 auto;align-items:center;gap:8px;">
          <div id="kh-placeholder-row" style="display:flex;gap:12px;align-items:center;overflow-x:auto;white-space:nowrap;flex:1 1 auto;"></div>
          <button id="kh-add-placeholder" class="kh-btn" title="Add placeholder"
                  style="margin-left:8px; width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;
                         border-radius:50%;border:1px solid #adc1e3;background:#f5f7ff;color:#1a2b4f;">➕</button>
        </div>
        <div style="background:#fff;display:inline-flex;align-items:center;">
          <button id="kh-ephor-canned-btn" class="kh-btn" style="margin-left:auto;">📑 Placeholders</button>
        </div>
      </div>

      <div id="kh-ephor-prompt-wrap" style="position:relative;">
        <pre id="kh-ephor-prompt-highlight" style="position:absolute;inset:0;margin:0;border-radius:4px;padding:6px;pointer-events:none;white-space:pre-wrap;word-break:normal;overflow-wrap:anywhere;font-family:monospace;background:hsl(213 20% 99% / 1);color:transparent;"></pre>
        <textarea id="kh-ephor-prompt-input"
                  style="position:relative;z-index:1;width:100%;height:90px;min-height:90px"></textarea>
      </div>
    </div>

    <!-- toolbar -->
    <div id="kh-ephor-bottom-toolbar" style="display:flex;align-items:center;gap:8px;padding-top:2px;">
      <div>
          <button id="kh-instr-gear" class="kh-btn" title="Saved Instructions">📝 Instructions</button>
          <div id="kh-saved-instr" style="margin-left:auto;display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:flex-end;"></div>
      </div>
      <span style="display:flex;align-items:center;gap:6px;">
        <span id="kh-ephor-progress">Idle</span>
        <button id="kh-ephor-cancel-btn" class="kh-btn" style="display:none;">Cancel</button>
        <button id="kh-ephor-send-btn" class="kh-btn-primary" style="padding:6px 12px;font-weight:bold;margin-left:auto;background:#2e73e9;color:#fff;
                         border:none;border-radius:4px;">Send</button>
      </span>
    </div>
  </div>

  <!-- ===== Pane: OUTPUTS ===== -->
  <div id="kh-ephor-pane-outputs" style="display:none;">
    <div id="kh-model-tabs"></div>
    <div id="kh-model-content">
      <textarea id="kh-default-output" placeholder="Outputs will appear here…"></textarea>
    </div>
  </div>

  <!-- ===== API Log ===== -->
  <div id="kh-ephor-log-section">
    <div style="display:flex;align-items:center;gap:8px;">
      <!-- ⬇ clickable toggle -->
      <p id="kh-ephor-log-toggle" style="margin:0;font-weight:600;cursor:pointer;">API Log</p>
      <div style="display:flex;gap:8px;align-items:center;margin-left:auto;">
        <label><input type="checkbox" id="kh-ephor-log-verbose"> Verbose</label>
        <button id="kh-ephor-copy-log"  class="kh-btn">📋 Copy</button>
        <button id="kh-ephor-clear-log" class="kh-btn">🗑 Clear</button>
      </div>
    </div>
    <!-- ⬇ start collapsed (display:none). Keep width stable: allow wrapping + isolate inline-size -->
    <div id="kh-ephor-log-container"
         style="background:#f0f0f0;border:1px solid #ddd;border-radius:4px;height:100px;
                overflow:auto; /* both axes */
                padding:5px;margin-top:4px;display:none;
                contain:inline-size; /* don't let intrinsic width of pre affect modal */">
      <pre style="margin:0;font-size:10px;font-family:monospace;
                  white-space:pre-wrap;
                  overflow-wrap:anywhere; /* robustly wrap JWTs/URLs */
                  word-break:normal;      /* rely on overflow-wrap */
                  max-width:100%;"></pre>
    </div>
  </div>
`;

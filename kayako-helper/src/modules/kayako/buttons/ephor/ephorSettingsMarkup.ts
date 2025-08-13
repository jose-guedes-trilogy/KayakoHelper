/* Kayako Helper – ephorSettingsMarkup.ts (v2.6.2 – keep modal width stable when opening log) */

export const EPHOR_SETTINGS_MARKUP = /* HTML */ `
  <style>
    /* ---------- generic buttons ---------- */
    .kh-btn{padding:4px 12px;border:1px solid #ccc;border-radius:4px;background:#fff;
            cursor:pointer;font:inherit;display:inline-flex;align-items:center;gap:4px;}
    .kh-btn:hover{background:#f5f7ff;border-color:#99a;}
    .kh-btn-primary{background:#2e73e9;color:#fff;border-color:#2e73e9;}
    .kh-btn-primary:hover{background:#255ecd;color:#fff;}

    /* ---------- tab / stage buttons ---------- */
    .kh-bar-btn{border:none;background:none;cursor:pointer;padding:4px 12px;border-radius:4px;}
    .kh-bar-btn.active{background:#2e73e9;color:#fff;}

    /* ---------- list labels ---------- */
    #kh-ephor-ai-list label{display:flex;align-items:center;gap:6px;padding:4px 8px;
                            cursor:pointer;border-radius:3px;}
    #kh-ephor-ai-list label:hover{background:#f0f0f0;}

    /* ---------- stage bar buttons ---------- */
    #kh-ephor-stage-bar button,#kh-ephor-stage-bar span{padding:4px 10px;border-radius:4px;cursor:pointer;}
    #kh-ephor-stage-bar .active{background:#2e73e9;color:#fff;}

    /* ---------- inputs ---------- */
    input[type="text"],input[type="search"],textarea{border:1px solid #ccc;border-radius:4px;}
    input[type="radio"]{position:relative;top:2px;}      /* align radios with labels */
    /* ⬇ move Verbose checkbox down 2 px */
    #kh-ephor-log-verbose{position:relative;top:2px;}

    /* ---------- placeholder buttons ---------- */
    .kh-ph-btn{padding:2px 6px;font-size:12px;border:1px solid #bbb;border-radius:3px;background:#f3f3f3;cursor:pointer;}
    .kh-ph-btn[disabled]{opacity:.35;pointer-events:none;}
    .kh-ph-btn:hover:not([disabled]){background:#e8e8e8;}

    /* ---------- output tabs ---------- */
    #kh-model-tabs{display:flex;gap:6px;margin-bottom:6px;}
    #kh-model-tabs button{border:none;background:none;padding:4px 10px;border-radius:4px;cursor:pointer;}
    #kh-model-tabs button.active{background:#2e73e9;color:#fff;}
    #kh-model-content textarea{width:100%;height:300px;border:1px solid #ddd;border-radius:4px;
                               padding:6px;font-family:monospace;resize:vertical;}

    /* ---------- misc ---------- */
    #kh-ephor-progress{font-weight:600;margin-right:6px;}

    /* ---------- split placeholder buttons ---------- */
    .kh-split-btn-wrapper{display:inline-flex;position:relative;}
    .kh-split-main{border-top-right-radius:0;border-bottom-right-radius:0;border-right:none;}
    .kh-split-drop{border-top-left-radius:0;border-bottom-left-radius:0;width:22px;padding:2px;
                   text-align:center;font-size:12px;}
    .kh-ph-menu{position:absolute;top:100%;right:0;display:none;background:#fff;
                border:1px solid #ccc;border-radius:4px;z-index:10002;min-width:120px;}
    .kh-ph-menu div{padding:4px 8px;cursor:pointer;white-space:nowrap;}
    .kh-ph-menu div:hover{background:#f3f3f3;}
  </style>

  <!-- ===== Header ===== -->
  <div class="kh-ephor-header" style="display:flex;align-items:center;gap:12px;cursor:move;">
    <h2 style="margin:0;font-size:16px;">Ephor – Settings & Manual Send</h2>
    <button id="kh-ephor-close" class="kh-btn" style="margin-left:auto;">✕</button>
  </div>

  <!-- ===== Unified radio row ===== -->
  <div style="display:flex;flex-wrap:wrap;gap:26px;align-items:center;margin-bottom:6px;">
    <span><strong>Connection:</strong>
      <label><input type="radio" name="kh-ephor-mode" id="kh-ephor-mode-multiplexer" value="multiplexer"> Multiplexer</label>
      <label><input type="radio" name="kh-ephor-mode" id="kh-ephor-mode-stream" value="stream"> Stream</label>
    </span>
    <span><strong>Workflow:</strong>
      <label><input type="radio" name="kh-query-mode" id="kh-query-single"  value="single"> Single stage</label>
      <label><input type="radio" name="kh-query-mode" id="kh-query-workflow" value="workflow"> Multi-stage</label>
    </span>
    <span id="kh-ephor-run-row"><strong>Run:</strong>
      <label><input type="radio" name="kh-run-mode" id="kh-run-auto"   value="automatic"> Auto</label>
      <label><input type="radio" name="kh-run-mode" id="kh-run-manual" value="manual"> Manual</label>
    </span>
  </div>

  <!-- ===== Main tabs ===== -->
  <div style="display:flex;gap:6px;">
    <button id="kh-ephor-tab-settings" class="kh-bar-btn active">Settings</button>
    <button id="kh-ephor-tab-outputs"  class="kh-bar-btn">Outputs</button>
  </div>

  <!-- ===== Stage bar ===== -->
  <div id="kh-ephor-stage-bar" style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap;"></div>

  <!-- ===== Pane: SETTINGS ===== -->
  <div id="kh-ephor-pane-settings">
    <!-- (projects / chats / models grid) -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:20px;">
      <!-- 1. Projects -->
      <div>
        <p style="margin:0 0 4px;font-weight:600;">1. Select Project</p>
        <input id="kh-ephor-project-search" type="search" placeholder="Search projects…"
               style="width:100%;padding:4px 6px;margin-bottom:8px;">
        <div id="kh-ephor-project-list"
             style="height:200px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;"></div>
      </div>
      <!-- 2. Chats -->
      <div>
        <p style="margin:0 0 4px;font-weight:600;">2. Select Chat</p>
        <input id="kh-ephor-channel-search" type="search" placeholder="Search chats…"
               style="width:100%;padding:4px 6px;margin-bottom:8px;">
        <div id="kh-ephor-channel-list"
             style="height:200px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;"></div>
      </div>
      <!-- 3. Models -->
      <div>
        <p style="margin:0 0 4px;font-weight:600;">3. Select AI Models</p>
        <input id="kh-ephor-model-search" type="search" placeholder="Search models…"
               style="width:100%;padding:4px 6px;margin-bottom:6px;">
        <div id="kh-ephor-ai-list"
             style="height:178px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;"></div>
      </div>
    </div>

    <!-- prompt -->
    <div style="margin-top:10px;">
      <p style="margin:0 0 4px;font-weight:600;">4. Prompt</p>

      <!-- placeholder buttons + canned-prompt button -->
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px;">
        <div id="kh-placeholder-row" style="display:flex;gap:6px;flex-wrap:wrap;">
          <span style="font-weight:600;">Insert:</span>
          <button class="kh-ph-btn" data-ph="@#PRV_RD_OUTPUT#@">@#PRV_RD_OUTPUT#@</button>
          <button class="kh-ph-btn" data-ph="@#TRANSCRIPT#@">@#TRANSCRIPT#@</button>
          <button class="kh-ph-btn" data-ph="@#OUTPUT_RND_1_AI_<AI_NAME>#@">@#OUTPUT_RND_1_AI_<AI_NAME>#@</button>
          <button class="kh-ph-btn" data-ph="@#OUTPUT_RND_2_AI_<AI_NAME>#@">@#OUTPUT_RND_2_AI_<AI_NAME>#@</button>
          <button class="kh-ph-btn" data-ph="@#OUTPUT_RND_3_AI_<AI_NAME>#@">@#OUTPUT_RND_3_AI_<AI_NAME>#@</button>
        </div>

        <button id="kh-ephor-canned-btn" class="kh-btn">📑 Canned Prompts…</button>
      </div>

      <textarea id="kh-ephor-prompt-input"
                style="width:100%;height:90px;padding:6px;"></textarea>
    </div>

    <!-- toolbar -->
    <div style="display:flex;align-items:center;gap:8px;border-top:1px solid #eee;padding-top:12px;">
      <button id="kh-ephor-refresh-projects" class="kh-btn">🔄 Refresh Projects</button>
      <button id="kh-ephor-new-chat"         class="kh-btn">➕ New Chat</button>
      <span style="margin-left:auto;display:flex;align-items:center;gap:6px;">
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
  <div style="margin-top:6px;">
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

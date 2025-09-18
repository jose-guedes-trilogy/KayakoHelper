/* Kayako Helper – ephorSettingsMarkup.ts (v2.7.0 – grouped collapse, include-default toggle, externalized styles) */

export const EPHOR_SETTINGS_MARKUP = /* HTML */ `

  <!-- ===== Header ===== -->
  <div class="kh-ephor-header">
    <h2>Ephor – Settings & Manual Send</h2>
    <span class="kh-header-actions">
      <button id="kh-ephor-gear" class="kh-btn" title="Settings"><span style="font-size:10px">⚙️</span></button>
      <button id="kh-ephor-close" class="kh-btn kh-close-button"><span style="font-size:10px">✕</span></button>
    </span>
  </div>

  <!-- ===== Settings row (segmented) ===== -->
  <div id="kh-top-settings-row" class="kh-split-row">
    <span class="kh-seg-pair">
      <div class="kh-seg-label"><strong>Mode</strong></div>
      <span class="kh-seg">
        <label><input type="radio" name="kh-ephor-mode" id="kh-ephor-mode-multiplexer" value="multiplexer"> API</label>
        <label><input type="radio" name="kh-ephor-mode" id="kh-ephor-mode-stream" value="stream"> Normal</label>
      </span>
    </span>
    <span class="kh-seg-pair">
      <div class="kh-seg-label"><strong>Workflow</strong></div>
      <span class="kh-seg">
        <label><input type="radio" name="kh-query-mode" id="kh-query-single"  value="single"> Single stage</label>
        <label><input type="radio" name="kh-query-mode" id="kh-query-workflow" value="workflow"> Multi-stage</label>
      </span>
    </span>
    <span class="kh-seg-pair">
      <div class="kh-seg-label"><strong>Run</strong></div>
      <span class="kh-seg" id="kh-ephor-run-row">
        <label><input type="radio" name="kh-run-mode" id="kh-run-auto"   value="automatic"> Auto</label>
        <label><input type="radio" name="kh-run-mode" id="kh-run-manual" value="manual"> Manual</label>
      </span>
    </span>
  </div>

  <!-- ===== Main tabs ===== -->
  <div class="kh-main-tabs">
    <button id="kh-ephor-tab-settings" class="kh-bar-btn active">Prompt Setup</button>
    <button id="kh-ephor-tab-outputs"  class="kh-bar-btn">AI Outputs</button>
  </div>

  <!-- ===== Workflows row (save/load/delete/switch) ===== -->
  <div class="kh-split-row kh-workflows-row">
    <div class="kh-seg-label" title="Workflows save your setup (mode, models, stages). Load one to reuse."><strong>Workflows</strong></div>
    <div class="kh-seg kh-wf-seg">
      <label for="kh-workflow-select" class="kh-strong-label">Current:</label>
      <span class="kh-select-wrap">
        <select id="kh-workflow-select"></select>
      </span>
      <span class="kh-wf-name-wrap">
        <input id="kh-workflow-name" type="text" placeholder="Name…"
        >
        <button id="kh-workflow-name-clear" class="kh-btn" title="Clear name"
        ><span style="font-size:10px">×</span></button>
      </span>
      <span class="kh-wf-actions">
        <button id="kh-workflow-save" class="kh-btn"><span style="font-size:10px">💾</span> Save</button>
        <button id="kh-workflow-load" class="kh-btn"><span style="font-size:10px">📥</span> Load</button>
        <button id="kh-workflow-delete" class="kh-btn"><span style="font-size:10px">🗑</span> Delete</button>
      </span>
    </div>
  </div>

  <!-- ===== Stage bar (split) ===== -->
  <div class="kh-split-row kh-stage-row">
    <div class="kh-seg-label" title="Stages are steps inside a workflow. Each stage can prompt and collect outputs."><strong>Stages</strong></div>
    <div class="kh-seg kh-stage-seg">
      <div id="kh-ephor-stage-bar"></div>
    </div>
  </div>

  <!-- ===== Pane: SETTINGS ===== -->
  <div id="kh-ephor-pane-settings">
    <!-- (projects / chats / models grid) -->
    <div class="kh-settings-grid">
      <!-- 1. Projects -->
      <div>
        <p id="kh-title-projects" class="kh-title">1. Select Project</p>
        <div id="kh-proj-body">
          <input id="kh-ephor-project-search" type="search" placeholder="Search projects…">
          <div id="kh-ephor-project-list"></div>
          <div class="kh-proj-actions">
            <button id="kh-ephor-browse-projects" class="kh-btn" title="Browse available projects"><span style="font-size:10px">📚</span> Browse</button>
            <button id="kh-ephor-refresh-projects" class="kh-btn"><span style="font-size:10px">🔄</span> Refresh Projects</button>
          </div>
        </div>
        <div id="kh-proj-collapsed" class="kh-collapsed-note">Click to expand</div>
      </div>
      <!-- 2. Chats -->
      <div class="kh-chats">
        <p id="kh-title-chats" class="kh-title kh-title-with-controls">
          <span>2. Select Chat</span>
        </p>
        <!-- absolutely positioned sort control (does not affect flow) -->
        <span id="kh-sort-controls">
          <label for="kh-ephor-chat-sort" class="kh-strong-label">Sort:</label>
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
          <input id="kh-ephor-channel-search" type="search" placeholder="Search chats…">
          <div id="kh-ephor-channel-list"></div>
          <div class="kh-chat-actions">
            <button id="kh-ephor-new-chat" class="kh-btn"><span style="font-size:10px">➕</span> New Chat</button>
          </div>
        </div>
        <div id="kh-chat-collapsed" class="kh-collapsed-note">Click to expand</div>
      </div>
      <!-- 3. Models -->
      <div>
        <p id="kh-title-models" class="kh-title kh-title-with-note">
          <span>3. Select AI Models</span>
          <span id="kh-model-saved-note" class="kh-model-saved-note"></span>
        </p>
        <div id="kh-model-body">
          <input id="kh-ephor-model-search" type="search" placeholder="Search models…">
          <div id="kh-ephor-ai-list"></div>
          <!-- AI Selections toolbar (preset buttons + gear) -->
          <div id="kh-ai-sel-toolbar" class="kh-ai-sel-toolbar">
            <div id="kh-ai-sel-row" class="kh-ai-sel-row"></div>
            <span class="kh-flex-spacer"></span>
            <button id="kh-ai-sel-clear" class="kh-btn" title="Clear selection"><span style="font-size:10px">🧹</span> Clear</button>
            <button id="kh-ai-sel-gear" class="kh-btn" title="AI Selections"><span style="font-size:10px">⚙️</span></button>
          </div>
        </div>
        <div id="kh-model-collapsed" class="kh-collapsed-note">Click to expand</div>
      </div>
    </div>

    <!-- per-ticket custom instructions (scope toggle) -->
    <div class="kh-section kh-instr-section">
      <p id="kh-title-instr" class="kh-title kh-title-row">
        <span id="kh-ephor-instr-label">4. Per-ticket Instructions</span>
        <label class="kh-instr-scope-label">
          <input type="checkbox" id="kh-ephor-instr-scope"> Save instructions per-stage instead
        </label>
      </p>
      <div id="kh-instr-body" class="kh-instr-body">
        <textarea id="kh-ephor-custom-instr"
                  placeholder="Optional: saved for this Kayako ticket. These lines will be prepended to prompts."></textarea>
        <p class="kh-muted-note">
          Scope applies to workflow runs. When checked, the same instructions are used for all stages of the ticket.
        </p>
      </div>
      <div id="kh-instr-collapsed" class="kh-collapsed-note">Click to expand</div>
    </div>

    <!-- prompt / default instructions -->
    <div class="kh-section kh-default-section">
      <p id="kh-title-default" class="kh-title kh-title-row">
        <span>5. Default Instructions</span>
        <label class="kh-include-default">
          <input type="checkbox" id="kh-include-default" checked> Include default instructions
        </label>
      </p>

      <div id="kh-default-section" class="kh-default-body">
        <!-- Insert row (segmented) -->
        <div class="kh-split-row kh-insert-row">
          <div class="kh-seg-label"><strong>Insert</strong></div>
          <div class="kh-seg kh-insert-seg">
            <div id="kh-placeholder-row" class="kh-placeholder-row"></div>
            <button id="kh-add-placeholder" class="kh-btn" title="Add placeholder"><span style="font-size:10px">➕</span></button>
          </div>
          <div class="kh-canned-wrap">
            <button id="kh-ephor-canned-btn" class="kh-btn"><span style="font-size:10px">📑</span> Placeholders</button>
          </div>
        </div>

        <div id="kh-ephor-prompt-wrap" class="kh-prompt-wrap">
          <pre id="kh-ephor-prompt-highlight" class="kh-prompt-highlight"></pre>
          <textarea id="kh-ephor-prompt-input" class="kh-prompt-input"></textarea>
        </div>
      </div>
      <div id="kh-default-collapsed" class="kh-collapsed-note">Click to expand</div>
      
      <!-- toolbar (split: left part hidden with default-section; right part always visible) -->
      <div id="kh-ephor-bottom-toolbar" class="kh-bottom-toolbar">
        <div id="kh-default-toolbar-left">
            <button id="kh-instr-gear" class="kh-btn" title="Saved Instructions"><span style="font-size:10px">📝</span> Instructions</button>
            <div id="kh-saved-instr" class="kh-saved-instr"></div>
        </div>
        <span class="kh-send-controls">
          <span id="kh-ephor-progress">Idle</span>
          <span id="kh-ephor-warning" class="kh-ephor-warning" title=""></span>
          <button id="kh-ephor-cancel-btn" class="kh-btn">Cancel</button>
          <button id="kh-ephor-send-btn" class="kh-btn kh-btn-primary">Send</button>
        </span>
      </div>
    </div>
  </div>

  <!-- ===== Pane: OUTPUTS ===== -->
  <div id="kh-ephor-pane-outputs" class="kh-hidden">
    <div id="kh-model-tabs"></div>
    <div id="kh-model-content">
      <textarea id="kh-default-output" placeholder="Outputs will appear here…"></textarea>
    </div>
  </div>

  <!-- ===== API Log ===== -->
  <div id="kh-ephor-log-section">
    <div class="kh-log-header">
      <!-- ⬇ clickable toggle -->
      <p id="kh-ephor-log-toggle" class="kh-log-toggle">API Log</p>
      <div class="kh-log-actions">
        <label><input type="checkbox" id="kh-ephor-log-verbose"> Verbose</label>
        <button id="kh-ephor-copy-log"  class="kh-btn"><span style="font-size:10px">📋</span> Copy</button>
        <button id="kh-ephor-clear-log" class="kh-btn"><span style="font-size:10px">🗑</span> Clear</button>
      </div>
    </div>
    <!-- ⬇ start collapsed (display:none). Keep width stable: allow wrapping + isolate inline-size -->
    <div id="kh-ephor-log-container" class="kh-log-container">
      <pre class="kh-log-pre"></pre>
    </div>
  </div>
`;

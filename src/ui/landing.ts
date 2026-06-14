export const landingPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AJO Content MCP Server</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%2032%2032'%3E%3Crect%20width%3D'32'%20height%3D'32'%20rx%3D'6'%20fill%3D'%23FA0F00'%2F%3E%3Ctext%20x%3D'16'%20y%3D'23'%20font-family%3D'Arial%2C%20sans-serif'%20font-size%3D'20'%20font-weight%3D'900'%20fill%3D'%23ffffff'%20text-anchor%3D'middle'%3EA%3C%2Ftext%3E%3C%2Fsvg%3E" />
  <style>
    :root {
      --adobe-red: #FA0F00;
      --adobe-dark: #2C2C2C;
      --adobe-mid: #4A4A4A;
      --adobe-light: #F8F7F5;
      --adobe-border: #E5E3DE;
      --adobe-success: #268E6C;
      --adobe-warn: #E68619;
      --surface: #FFFFFF;
      --font-display: 'Adobe Clean', 'Inter', system-ui, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-display);
      background: var(--adobe-light);
      color: var(--adobe-dark);
      min-height: 100vh;
    }
    header {
      background: var(--adobe-dark);
      padding: 0 40px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
      color: white;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .logo-mark {
      width: 32px;
      height: 32px;
      background: var(--adobe-red);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 16px;
      color: white;
      border-radius: 4px;
    }
    .badge {
      font-size: 11px;
      background: rgba(255,255,255,0.15);
      color: rgba(255,255,255,0.8);
      padding: 2px 8px;
      border-radius: 100px;
      font-weight: 500;
    }
    main {
      max-width: 720px;
      margin: 0 auto;
      padding: 48px 24px 80px;
    }
    .hero {
      margin-bottom: 40px;
    }
    .hero h1 {
      font-size: 28px;
      font-weight: 700;
      color: var(--adobe-dark);
      letter-spacing: -0.02em;
      line-height: 1.2;
      margin-bottom: 10px;
    }
    .hero p {
      font-size: 15px;
      color: var(--adobe-mid);
      line-height: 1.6;
    }
    .step-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--adobe-red);
      margin-bottom: 8px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--adobe-border);
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .card h2 {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .card p {
      font-size: 13px;
      color: var(--adobe-mid);
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .dropzone {
      border: 2px dashed var(--adobe-border);
      border-radius: 6px;
      padding: 32px;
      text-align: center;
      cursor: pointer;
      transition: all 0.15s;
      position: relative;
    }
    .dropzone:hover, .dropzone.drag-over {
      border-color: var(--adobe-red);
      background: rgba(250, 15, 0, 0.02);
    }
    .dropzone input[type="file"] {
      position: absolute;
      inset: 0;
      opacity: 0;
      cursor: pointer;
    }
    .dropzone-icon {
      width: 40px;
      height: 40px;
      margin: 0 auto 12px;
      background: var(--adobe-light);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dropzone-icon svg { width: 20px; height: 20px; opacity: 0.5; }
    .dropzone-text { font-size: 14px; font-weight: 500; margin-bottom: 4px; }
    .dropzone-sub { font-size: 12px; color: var(--adobe-mid); }
    .file-accepted {
      display: none;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: rgba(38, 142, 108, 0.06);
      border: 1px solid rgba(38, 142, 108, 0.25);
      border-radius: 6px;
      font-size: 13px;
      color: var(--adobe-success);
    }
    .file-accepted.show { display: flex; }
    .file-accepted svg { width: 16px; height: 16px; flex-shrink: 0; }
    .field-group { display: flex; flex-direction: column; gap: 6px; }
    label { font-size: 13px; font-weight: 500; }
    input[type="text"] {
      height: 40px;
      border: 1px solid var(--adobe-border);
      border-radius: 6px;
      padding: 0 12px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
      width: 100%;
    }
    input[type="text"]:focus { border-color: var(--adobe-red); }
    .hint { font-size: 12px; color: var(--adobe-mid); }
    .btn-primary {
      width: 100%;
      height: 44px;
      background: var(--adobe-red);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: opacity 0.15s;
      font-family: inherit;
    }
    .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
    .btn-primary:hover:not(:disabled) { opacity: 0.88; }
    .status-panel {
      display: none;
      background: var(--surface);
      border: 1px solid var(--adobe-border);
      border-radius: 8px;
      overflow: hidden;
    }
    .status-panel.show { display: block; }
    .status-header {
      padding: 16px 24px;
      background: rgba(38, 142, 108, 0.06);
      border-bottom: 1px solid var(--adobe-border);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-dot {
      width: 8px; height: 8px;
      background: var(--adobe-success);
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .status-title { font-size: 14px; font-weight: 600; color: var(--adobe-success); }
    .endpoints {
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .endpoint-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .endpoint-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--adobe-mid); width: 64px; padding-top: 2px; flex-shrink: 0; }
    .endpoint-value { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; color: var(--adobe-dark); }
    .copy-btn {
      margin-left: auto;
      padding: 4px 10px;
      border: 1px solid var(--adobe-border);
      background: white;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      font-family: inherit;
      color: var(--adobe-mid);
      flex-shrink: 0;
    }
    .copy-btn:hover { background: var(--adobe-light); }
    .divider { height: 1px; background: var(--adobe-border); margin: 0 24px; }
    .connect-section { padding: 20px 24px; }
    .connect-section h3 { font-size: 13px; font-weight: 600; margin-bottom: 14px; }
    .error-msg { font-size: 13px; color: #C9252D; padding: 12px; background: rgba(201,37,45,0.06); border-radius: 6px; display: none; }
    .error-msg.show { display: block; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .replace-btn {
      margin-left: auto;
      padding: 4px 10px;
      border: 1px solid rgba(38,142,108,0.3);
      background: white;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      font-family: inherit;
      color: var(--adobe-success);
      flex-shrink: 0;
    }
    .replace-btn:hover { background: rgba(38,142,108,0.06); }
    .conn-info {
      display: none;
      flex-direction: column;
      gap: 8px;
      margin-top: 16px;
      padding: 14px 16px;
      border: 1px solid rgba(38,142,108,0.3);
      background: rgba(38,142,108,0.05);
      border-radius: 6px;
    }
    .conn-info.show { display: flex; }
    .conn-row { display: flex; align-items: center; gap: 12px; }
    .conn-key { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--adobe-mid); width: 150px; flex-shrink: 0; }
    .conn-val { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 14px; font-weight: 600; color: var(--adobe-dark); word-break: break-all; }
    .conn-val.warn { color: var(--adobe-warn); font-family: var(--font-display); font-weight: 500; }
    .org-fallback { display: none; flex-direction: column; gap: 6px; margin-top: 16px; }
    .org-fallback.show { display: flex; }
    .reset-notice {
      display: none;
      margin-bottom: 24px;
      padding: 14px 16px;
      background: rgba(230,134,25,0.08);
      border: 1px solid rgba(230,134,25,0.35);
      border-radius: 8px;
      font-size: 13px;
      color: var(--adobe-warn);
      line-height: 1.55;
    }
    .reset-notice.show { display: block; }
    .reset-notice strong { font-weight: 700; }
    .org-fallback-note {
      font-size: 12px;
      color: var(--adobe-warn);
      background: rgba(230,134,25,0.08);
      border: 1px solid rgba(230,134,25,0.25);
      border-radius: 6px;
      padding: 10px 12px;
      line-height: 1.5;
      margin-bottom: 4px;
    }
    .clients-list { display: flex; flex-direction: column; gap: 8px; }
    .clients-empty { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--adobe-mid); }
    .clients-empty .status-dot { background: var(--adobe-warn); }
    .client-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid rgba(38,142,108,0.3);
      background: rgba(38,142,108,0.05);
      border-radius: 6px;
    }
    .client-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--adobe-success); flex-shrink: 0; animation: pulse 2s infinite; }
    .client-name { font-size: 14px; font-weight: 600; color: var(--adobe-dark); }
    .client-meta { margin-left: auto; font-size: 12px; color: var(--adobe-mid); font-family: 'SF Mono', 'Fira Code', monospace; }
    .clients-hint { font-size: 12px; color: var(--adobe-mid); margin-top: 14px; line-height: 1.5; }
  </style>
</head>
<body>
  <header>
    <div class="logo">
      <div class="logo-mark">A</div>
      AJO Content MCP Server
    </div>
    <span class="badge" id="statusBadge">Not configured</span>
  </header>

  <main>
    <div class="hero">
      <h1>Connect to Adobe Journey Optimizer</h1>
      <p>Upload your credentials file and define the sandbox to activate the MCP server. LLM clients can then manage content templates and fragments via standardized tools.</p>
    </div>

    <div class="reset-notice" id="resetNotice">
      <strong>The MCP server was restarted</strong> and is no longer configured (this happens when the container is rebuilt or restarted). Any connected clients were disconnected. Re-upload your credentials and start the server again to reconnect. Don't forget to restart the desktop client(s) too, since they'll lose connection to the MCP server when it restarts.
    </div>

    <!-- Step 1: Credentials -->
    <div class="step-label">Step 1 — Credentials</div>
    <div class="card">
      <h2>Upload environment file</h2>
      <p>Drag and drop your <code>oauth_server_to_server.json</code> file or click to browse. Credentials are stored in memory only — never written to disk or logged.</p>
      <div class="dropzone" id="dropzone">
        <input type="file" id="fileInput" accept=".json" />
        <div class="dropzone-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
          </svg>
        </div>
        <div class="dropzone-text">Drop environment-variables.json here</div>
        <div class="dropzone-sub">or click to browse</div>
      </div>
      <div class="file-accepted" id="fileAccepted">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
        <span id="fileName">File loaded</span>
        <button class="replace-btn" id="replaceFileBtn" type="button">Replace</button>
      </div>
    </div>

    <!-- Step 2: Sandbox -->
    <div class="step-label">Step 2 — Sandbox</div>
    <div class="card">
      <h2>Select sandbox</h2>
      <p>Enter the Adobe Experience Platform sandbox name to target. All API calls will be scoped to this sandbox.</p>
      <div class="field-group">
        <label for="sandboxInput">Sandbox name</label>
        <input type="text" id="sandboxInput" placeholder="e.g. prod or cjm-team" autocomplete="off" />
        <span class="hint">Find this in the Adobe Experience Platform sandbox switcher.</span>
      </div>
    </div>

    <!-- Step 3: Start -->
    <div class="step-label">Step 3 — Launch</div>
    <div class="card">
      <div class="error-msg" id="errorMsg"></div>
      <button class="btn-primary" id="startBtn" disabled>
        Start MCP Server
      </button>

      <!-- Connection summary — shown right below the button once the server is active -->
      <div class="conn-info" id="connInfo">
        <div class="conn-row">
          <span class="conn-key">Tenant namespace</span>
          <span class="conn-val" id="connNamespace">—</span>
        </div>
        <div class="conn-row">
          <span class="conn-key">Sandbox</span>
          <span class="conn-val" id="connSandbox">—</span>
        </div>
      </div>

      <!-- Organization name — revealed only if tenant namespace can't be auto-detected -->
      <div class="org-fallback" id="orgFallback">
        <div class="org-fallback-note">
          We couldn't auto-detect your tenant namespace from the Schema Registry. Enter your organization name so the LLM can identify the tenant, then re-activate.
        </div>
        <label for="orgInput">Organization name</label>
        <input type="text" id="orgInput" placeholder="e.g. Adobe, Acme Corp" autocomplete="off" />
        <span class="hint">Your company or AJO customer name. Shown to the LLM to identify the tenant.</span>
      </div>
    </div>

    <!-- Status Panel (shown after start) -->
    <div class="status-panel" id="statusPanel">
      <div class="status-header">
        <div class="status-dot"></div>
        <span class="status-title">MCP Server Active</span>
      </div>
      <div class="endpoints">
        <div class="endpoint-row">
          <span class="endpoint-label">HTTP</span>
          <span class="endpoint-value" id="httpEndpoint">http://localhost:3000/mcp</span>
          <button class="copy-btn" onclick="copyText('httpEndpoint')">Copy</button>
        </div>
        <div class="endpoint-row">
          <span class="endpoint-label">STDIO</span>
          <span class="endpoint-value">stdin / stdout (always active alongside HTTP)</span>
        </div>
      </div>
      <div class="divider"></div>
      <div class="connect-section">
        <h3>Recently connected client(s) (idle clients get removed after 10 seconds)</h3>
        <div class="clients-list" id="clientsList">
          <div class="clients-empty"><span class="status-dot"></span> Waiting for an MCP client to connect…</div>
        </div>
        <p class="clients-hint">Connecting another client (Claude Code, Cursor, Codex…)? See the <strong>README</strong> on GitHub for per-client setup.</p>
      </div>
    </div>
  </main>

  <script>
    let credentials = null;
    let serverUrl = window.location.origin;

    function copyText(id) {
      const el = document.getElementById(id);
      navigator.clipboard.writeText(el.textContent);
    }

    // ─── Connected-client polling ──────────────────────────────────────────────
    let clientPollTimer = null;
    const KNOWN_CLIENTS = {
      'claude-ai': 'Claude Desktop',
      'claude-code': 'Claude Code',
      'cursor-vscode': 'Cursor',
      'cursor': 'Cursor',
      'codex': 'Codex',
      'codex-cli': 'Codex CLI',
      'mcp-remote': 'mcp-remote bridge'
    };

    function prettyClient(name) { return KNOWN_CLIENTS[name] || name; }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function renderClients(clients) {
      const list = document.getElementById('clientsList');
      if (!clients || !clients.length) {
        list.innerHTML = '<div class="clients-empty"><span class="status-dot"></span> Waiting for an MCP client to connect…</div>';
        return;
      }
      list.innerHTML = clients.map(c =>
        '<div class="client-row">' +
          '<span class="client-dot"></span>' +
          '<span class="client-name">' + escapeHtml(prettyClient(c.name)) + '</span>' +
          '<span class="client-meta">' + escapeHtml(c.transport) + (c.version ? ' · v' + escapeHtml(c.version) : '') + '</span>' +
        '</div>'
      ).join('');
    }

    async function pollClients() {
      try {
        const res = await fetch('/api/connected-clients');
        const data = await res.json();
        // If the server reports it's no longer configured while this page still
        // shows "active", the container was restarted/rebuilt and lost its state.
        // Reset the page so the UI matches reality.
        if (data.configured === false) { handleServerReset(); return; }
        renderClients(data.clients);
      } catch { /* transient (e.g. mid-restart) — keep last render until next poll */ }
    }

    function startClientPolling() {
      pollClients();
      if (clientPollTimer) clearInterval(clientPollTimer);
      clientPollTimer = setInterval(pollClients, 3000);
    }

    function stopClientPolling() {
      if (clientPollTimer) { clearInterval(clientPollTimer); clientPollTimer = null; }
    }

    // File drop/select
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');

    ['dragenter', 'dragover'].forEach(e => {
      dropzone.addEventListener(e, (ev) => { ev.preventDefault(); dropzone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(e => {
      dropzone.addEventListener(e, () => dropzone.classList.remove('drag-over'));
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

    function handleFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          credentials = JSON.parse(e.target.result);
          document.getElementById('resetNotice').classList.remove('show');
          document.getElementById('fileAccepted').classList.add('show');
          // Prefer the credential set's own name (top-level "name" in the export); fall back to the filename
          const credName = (typeof credentials.name === 'string' && credentials.name.trim()) ? credentials.name.trim() : file.name;
          document.getElementById('fileName').textContent = credName + ' — ' + (credentials.values?.length || 0) + ' values';
          dropzone.style.display = 'none';
          checkReady();
        } catch {
          showError('Invalid JSON file. Please check the file format.');
        }
      };
      reader.readAsText(file);
    }

    // Allow swapping in a different credentials file without reloading the page
    document.getElementById('replaceFileBtn').addEventListener('click', () => {
      credentials = null;
      fileInput.value = '';
      document.getElementById('fileAccepted').classList.remove('show');
      dropzone.style.display = '';
      resetActivationUI();
      checkReady();
    });

    // Reset everything that activation produced, back to the pre-launch state
    function resetActivationUI() {
      needsOrg = false;
      stopClientPolling();
      renderClients([]);
      const btn = document.getElementById('startBtn');
      btn.innerHTML = 'Start MCP Server';
      btn.style.background = '';
      btn.disabled = false;
      document.getElementById('statusPanel').classList.remove('show');
      document.getElementById('connInfo').classList.remove('show');
      document.getElementById('orgFallback').classList.remove('show');
      document.getElementById('orgInput').value = '';
      document.getElementById('statusBadge').textContent = 'Not configured';
      document.getElementById('errorMsg').classList.remove('show');
    }

    // The server lost its configuration (container restarted/rebuilt). Return the
    // page to the initial upload state and explain why, since the credentials and
    // sandbox the server held are gone and must be provided again.
    function handleServerReset() {
      resetActivationUI();
      credentials = null;
      fileInput.value = '';
      document.getElementById('fileAccepted').classList.remove('show');
      dropzone.style.display = '';
      document.getElementById('resetNotice').classList.add('show');
      checkReady();
    }

    let needsOrg = false;
    const startBtn = document.getElementById('startBtn');

    document.getElementById('sandboxInput').addEventListener('input', () => {
      // Changing the sandbox invalidates any prior detection / activation
      if (needsOrg || document.getElementById('statusPanel').classList.contains('show')) {
        resetActivationUI();
      }
      checkReady();
    });

    function checkReady() {
      const sandbox = document.getElementById('sandboxInput').value.trim();
      startBtn.disabled = !credentials || !sandbox;
    }

    function showError(msg) {
      const el = document.getElementById('errorMsg');
      el.textContent = msg;
      el.classList.add('show');
    }

    function spinner(text) { return '<div class="spinner"></div> ' + text; }

    function failStart(msg) {
      showError(msg);
      startBtn.disabled = false;
      startBtn.innerHTML = needsOrg ? 'Activate MCP Server' : 'Start MCP Server';
    }

    async function postJson(url, body) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res.json();
    }

    startBtn.addEventListener('click', async () => {
      const sandbox = document.getElementById('sandboxInput').value.trim();
      const org = document.getElementById('orgInput').value.trim();
      document.getElementById('errorMsg').classList.remove('show');

      // Phase 1: probe for the tenant namespace BEFORE activating, so the org
      // input can be revealed up front when detection isn't possible.
      if (!needsOrg) {
        startBtn.disabled = true;
        startBtn.innerHTML = spinner('Detecting tenant…');
        let detect;
        try {
          detect = await postJson('/api/detect-tenant', { credentials, sandboxName: sandbox });
        } catch (err) {
          return failStart('Network error: ' + err.message);
        }
        if (!detect.success) {
          return failStart(detect.error || 'Could not validate credentials.');
        }
        if (!detect.tenantNamespace) {
          // No namespace — reveal the org input and wait for the user before activating
          needsOrg = true;
          document.getElementById('orgFallback').classList.add('show');
          startBtn.disabled = false;
          startBtn.innerHTML = 'Activate MCP Server';
          document.getElementById('orgInput').focus();
          return;
        }
        // Namespace found — fall through and activate immediately
      }

      await activate(sandbox, org);
    });

    async function activate(sandbox, org) {
      startBtn.disabled = true;
      const steps = ['Validating credentials…', 'Detecting tenant…', 'Validating sandbox…'];
      let i = 0;
      startBtn.innerHTML = spinner(steps[0]);
      const stepTimer = setInterval(() => {
        i = Math.min(i + 1, steps.length - 1);
        startBtn.innerHTML = spinner(steps[i]);
      }, 2000);

      let data;
      try {
        data = await postJson('/api/configure', { credentials, sandboxName: sandbox, orgName: org || undefined });
      } catch (err) {
        clearInterval(stepTimer);
        return failStart('Network error: ' + err.message);
      }
      clearInterval(stepTimer);

      if (!data.success) {
        return failStart(data.error || 'Configuration failed.');
      }

      // Server is active — render the connection summary right below the button
      document.getElementById('statusBadge').textContent = 'Active';
      document.getElementById('httpEndpoint').textContent = serverUrl + '/mcp';
      document.getElementById('statusPanel').classList.add('show');
      document.getElementById('connSandbox').textContent = sandbox;
      document.getElementById('connInfo').classList.add('show');
      startClientPolling();

      const connNs = document.getElementById('connNamespace');
      if (data.tenantNamespace) {
        connNs.textContent = data.tenantNamespace;
        connNs.classList.remove('warn');
        document.getElementById('orgFallback').classList.remove('show');
      } else if (org) {
        connNs.textContent = org + ' (manual)';
        connNs.classList.remove('warn');
      } else {
        connNs.textContent = 'Not auto-detected';
        connNs.classList.add('warn');
      }

      startBtn.disabled = true;
      startBtn.innerHTML = '✓ Server Active';
      startBtn.style.background = 'var(--adobe-success)';
    }
  </script>
</body>
</html>`;

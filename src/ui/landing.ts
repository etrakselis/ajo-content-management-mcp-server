export const landingPageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ET AJO Content MCP</title>
  <link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAABL1BMVEUAAADjHADqDwDqEQDrFADrDwDqEQDqEADqDwD/AADqEQDpDwDqEQDrEADrFADqEADqEADnEADpEADqDwD/AADqEADqEADfAADrEQDqEADqEADrEADqEADqEADqEADrEQDqEADsDgDqEADpEAD/AADsEwDqEADqEADwDwDqEADqEQDqEADpCwDpDwDqEADrFADpEADqEQD/AADqEADqEQDbAADqEADqEAD/AADoEADoDwDpEADpEADqEADqEADrDQDpEADqDgDrEADqEADoEQDnDADqEADqEADrEAD/AADqEADqEADuEQDpEQDrEQDqEADpEADqEADqDwDqDgDqDwDrEADpDwDqDwDqDwDrEADuEQDqEADoDwDqEQDqDwDpEADrDQDrEADqEADqEAD///8XdvSxAAAAY3RSTlMACYeIDWRszNYBPUSorxn6/CCAhgXk6whZX8S878owS5I2neEDKf6hEfV7+Bd2+xpdegLeqgfq4gRPQ45SutwnvSVzwCwVlPCiBunzDzuKbdX0dyTXu0WVVLAe5SFKhaQmfW7io+08AAAAAWJLR0Rkwtq4CQAAAAlwSFlzAAAA6AAAAOgBhtX2rwAAAAd0SU1FB+gIFBUtLabQ30cAAAEtSURBVDjLrZJXQ8IwFIUjRQQRRUXcewKKW3Erbhy4wAEimv//H0y4p22Slic9L733nC+jSRj7T7UELFKwCdDKoVAToM0GwhHfvJ07ivoCHS4Q88s7u1wg3u0D9HBFvd480acCyX4PMMA1DXqAIQqGR+g7auZjGDk+gWLSAKbInp6ZnaNqXs8XUmSnnbUyixqwRG52mbEVrLGq5mvrZG6IenOL6u2cAuxg1K5s9tDsK8ABWYeNWzzCNo/d/ARWntpTTHHmAPj3zLl+qBd2Hrwk4wr9dYH6m1sYIYy4s0fcwyhSG3mg9vFJKi82+ow9vdDTi+r3KOcpoS43gJgOvArrDfW7zD/iOpBMMJar4OlVBWBxQ5/CrKEOiKMvmMCXMq14enXL1Ldc+AdNnf1Zv9MjogPfmGNPAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI0LTA4LTIwVDIxOjQ1OjQ1KzAwOjAwMdr8AwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNC0wOC0yMFQyMTo0NTo0NSswMDowMECHRL8AAAAZdEVYdFNvZnR3YXJlAHd3dy5pbmtzY2FwZS5vcmeb7jwaAAAAV3pUWHRSYXcgcHJvZmlsZSB0eXBlIGlwdGMAAHic4/IMCHFWKCjKT8vMSeVSAAMjCy5jCxMjE0uTFAMTIESANMNkAyOzVCDL2NTIxMzEHMQHy4BIoEouAOoXEXTyQjWVAAAAAElFTkSuQmCC" />
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
      padding: 16px 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .logo-mark {
      width: 30px;
      height: 30px;
      border-radius: 3px;
      display: block;
      object-fit: contain;
      position: absolute;
      left: 48px;
    }
    .logo-text {
      color: white;
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1;
    }
    .badge {
      font-size: 11px;
      background: rgba(255,255,255,0.15);
      color: rgba(255,255,255,0.8);
      padding: 2px 8px;
      border-radius: 100px;
      font-weight: 500;
      position: absolute;
      right: 40px;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    @property --btn-angle {
      syntax: '<angle>';
      initial-value: 0deg;
      inherits: false;
    }
    @keyframes traceBorder {
      to { --btn-angle: 360deg; }
    }
    .btn-about {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      background: rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.9);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.15s;
      position: relative;
    }
    .btn-about::before {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 7px;
      padding: 1px;
      background: conic-gradient(from var(--btn-angle), transparent 80%, #FA0F00 88%, transparent 95%);
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      animation: traceBorder 2s linear infinite;
      pointer-events: none;
    }
    .btn-about:hover { background: rgba(255,255,255,0.2); }
    .btn-about svg { width: 15px; height: 15px; opacity: 0.85; }
    main {
      max-width: 960px;
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
    .step { animation: stepReveal 0.35s ease both; scroll-margin-top: 70px; }
    .step.hidden { display: none; }
    .tenant-banner {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 18px;
      margin-bottom: 20px;
      border: 1px solid rgba(38,142,108,0.3);
      background: rgba(38,142,108,0.05);
      border-radius: 8px;
      animation: stepReveal 0.35s ease both;
    }
    .tenant-banner.warn { border-color: rgba(230,134,25,0.35); background: rgba(230,134,25,0.08); }
    .tenant-banner-icon {
      width: 36px; height: 36px;
      flex-shrink: 0;
      border-radius: 8px;
      background: rgba(38,142,108,0.12);
      color: var(--adobe-success);
      display: flex; align-items: center; justify-content: center;
    }
    .tenant-banner.warn .tenant-banner-icon { background: rgba(230,134,25,0.12); color: var(--adobe-warn); }
    .tenant-banner-icon svg { width: 18px; height: 18px; }
    .tenant-banner-text { display: flex; flex-direction: column; gap: 2px; }
    .tenant-banner-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--adobe-mid); }
    .tenant-banner-value { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 15px; font-weight: 600; color: var(--adobe-dark); word-break: break-all; }
    .tenant-banner.warn .tenant-banner-value { font-family: var(--font-display); color: var(--adobe-warn); }
    @keyframes stepReveal {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
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
    input[type="text"], input[type="email"] {
      height: 40px;
      border: 1px solid var(--adobe-border);
      border-radius: 6px;
      padding: 0 12px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
      width: 100%;
      background: rgba(38, 142, 108, 0.06);
    }
    input[type="text"]:focus, input[type="email"]:focus { border-color: var(--adobe-red); }
    input:-webkit-autofill,
    input:-webkit-autofill:hover,
    input:-webkit-autofill:focus {
      -webkit-box-shadow: 0 0 0px 1000px rgba(38, 142, 108, 0.06) inset;
      box-shadow: 0 0 0px 1000px rgba(38, 142, 108, 0.06) inset;
      -webkit-text-fill-color: var(--adobe-dark);
    }
    .required-mark { color: var(--adobe-red); }
    select {
      height: 40px;
      border: 1px solid var(--adobe-border);
      border-radius: 6px;
      padding: 0 12px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s;
      width: 100%;
      background: rgba(38, 142, 108, 0.06);
      cursor: pointer;
    }
    select:focus { border-color: var(--adobe-red); }
    .hint { font-size: 12px; color: var(--adobe-mid); }
    .hint a, .sandbox-note a { color: var(--adobe-red); text-decoration: none; font-weight: 500; cursor: pointer; }
    .hint a:hover, .sandbox-note a:hover { text-decoration: underline; }
    .sandbox-msg { font-size: 13px; color: var(--adobe-mid); display: flex; align-items: center; gap: 8px; }
    .sandbox-note { font-size: 12px; line-height: 1.5; padding: 10px 12px; border-radius: 6px; margin-top: 12px; }
    .sandbox-note.info { color: var(--adobe-mid); background: var(--adobe-light); border: 1px solid var(--adobe-border); }
    .sandbox-note.warn { color: var(--adobe-warn); background: rgba(230,134,25,0.08); border: 1px solid rgba(230,134,25,0.25); }
    .spinner.dark { border: 2px solid rgba(0,0,0,0.12); border-top-color: var(--adobe-red); }
    .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; cursor: pointer; }
    .toggle-text { display: flex; flex-direction: column; gap: 4px; }
    .toggle-title { font-size: 14px; font-weight: 600; }
    .switch { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
    .switch input { position: absolute; opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; inset: 0; background: var(--adobe-border); border-radius: 100px; transition: background 0.15s; }
    .slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 3px; top: 3px; background: white; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform 0.15s; }
    .switch input:checked + .slider { background: var(--adobe-success); }
    .switch input:checked + .slider::before { transform: translateX(20px); }
    .btn-primary {
      width: 100%;
      height: 44px;
      background: #C0392B;
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
    .btn-primary.btn-trace { position: relative; }
    .btn-primary.btn-trace::before {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 7px;
      padding: 1px;
      background: conic-gradient(from var(--btn-angle), transparent 80%, #FA0F00 88%, transparent 95%);
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      animation: traceBorder 2s linear infinite;
      pointer-events: none;
    }
    @keyframes btnBreathe {
      0%, 100% { box-shadow: 0 0 0 0 rgba(192,57,43,0), 0 2px 6px rgba(0,0,0,0.12); }
      50%       { box-shadow: 0 0 0 7px rgba(192,57,43,0.3), 0 6px 28px rgba(192,57,43,0.45); }
    }
    .btn-primary.btn-breathing:not(:disabled) {
      animation: btnBreathe 2.5s ease-in-out infinite;
    }
    @property --card-angle {
      syntax: '<angle>';
      initial-value: 0deg;
      inherits: false;
    }
    @keyframes traceCard {
      to { --card-angle: 360deg; }
    }
    .card-trace {
      position: relative;
    }
    .card-trace::after {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 9px;
      padding: 1px;
      background: conic-gradient(from var(--card-angle), transparent 80%, #FA0F00 88%, transparent 95%);
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      animation: traceCard 2s linear infinite;
      pointer-events: none;
    }
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
      margin-bottom: 12px;
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
    .client-restart-notice {
      display: none;
      margin-bottom: 24px;
      padding: 14px 16px;
      background: rgba(201,37,45,0.06);
      border: 1px solid rgba(201,37,45,0.35);
      border-radius: 8px;
      font-size: 13px;
      color: #C9252D;
      line-height: 1.55;
    }
    .client-restart-notice.show { display: block; }
    .client-restart-notice strong { font-weight: 700; }
    .config-change-notice {
      display: none;
      margin-top: 14px;
      padding: 12px 14px;
      background: rgba(201,37,45,0.06);
      border: 1px solid rgba(201,37,45,0.35);
      border-radius: 6px;
      font-size: 13px;
      color: #C9252D;
      line-height: 1.55;
    }
    .config-change-notice.show { display: block; }
    .config-change-notice strong { font-weight: 700; }
    .config-change-notice .dismiss-btn,
    .client-restart-notice .dismiss-btn {
      display: block;
      margin-top: 10px;
      padding: 4px 12px;
      background: #E8E8E8;
      border: 1px solid #D0D0D0;
      border-radius: 4px;
      cursor: pointer;
      color: #555;
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
    }
    .config-change-notice .dismiss-btn:hover,
    .client-restart-notice .dismiss-btn:hover { background: #DADADA; }
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
    .naming-section { padding-bottom: 20px; border-bottom: 1px solid var(--adobe-border); margin-bottom: 20px; }
    .naming-section:last-child { padding-bottom: 0; border-bottom: none; margin-bottom: 0; }
    .naming-editor-wrap { margin-top: 12px; }
    .md-dropzone-wrap { position: relative; }
    .md-editor {
      width: 100%;
      min-height: 200px;
      border: 1px solid var(--adobe-border);
      border-radius: 6px;
      padding: 12px;
      font-size: 13px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      line-height: 1.6;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s;
      background: #2C2C2C;
      color: #F2F2F2;
      caret-color: #F2F2F2;
      border-color: #2C2C2C;
      display: block;
    }
    .md-editor::placeholder { color: #9A9A9A; }
    .md-editor.md-editor-tall { min-height: calc(100vh - 510px); }
    .md-editor:focus { border-color: var(--adobe-red); }
    .md-dropzone-wrap.drag-over .md-editor { border-color: var(--adobe-red); background: #1F1F1F; }
    .md-drop-overlay {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(250,15,0,0.06);
      border: 2px dashed var(--adobe-red);
      border-radius: 6px;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      color: var(--adobe-red);
      pointer-events: none;
      z-index: 1;
    }
    .md-dropzone-wrap.drag-over .md-drop-overlay { display: flex; }
    .md-editor-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
    .upload-md-btn {
      padding: 4px 10px;
      border: 1px solid var(--adobe-border);
      background: white;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
      color: var(--adobe-mid);
      flex-shrink: 0;
    }
    .upload-md-btn:hover { background: var(--adobe-light); }
    .md-editor-msg { display: none; font-size: 12px; line-height: 1.45; margin-top: 8px; }
    .md-editor-msg.show { display: block; }
    .md-editor-msg.error { color: #C9252D; }
    .md-editor-msg.warn { color: var(--adobe-warn); }
  </style>
</head>
<body>
  <header>
    <img class="logo-mark" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAABL1BMVEUAAADjHADqDwDqEQDrFADrDwDqEQDqEADqDwD/AADqEQDpDwDqEQDrEADrFADqEADqEADnEADpEADqDwD/AADqEADqEADfAADrEQDqEADqEADrEADqEADqEADqEADrEQDqEADsDgDqEADpEAD/AADsEwDqEADqEADwDwDqEADqEQDqEADpCwDpDwDqEADrFADpEADqEQD/AADqEADqEQDbAADqEADqEAD/AADoEADoDwDpEADpEADqEADqEADrDQDpEADqDgDrEADqEADoEQDnDADqEADqEADrEAD/AADqEADqEADuEQDpEQDrEQDqEADpEADqEADqDwDqDgDqDwDrEADpDwDqDwDqDwDrEADuEQDqEADoDwDqEQDqDwDpEADrDQDrEADqEADqEAD///8XdvSxAAAAY3RSTlMACYeIDWRszNYBPUSorxn6/CCAhgXk6whZX8S878owS5I2neEDKf6hEfV7+Bd2+xpdegLeqgfq4gRPQ45SutwnvSVzwCwVlPCiBunzDzuKbdX0dyTXu0WVVLAe5SFKhaQmfW7io+08AAAAAWJLR0Rkwtq4CQAAAAlwSFlzAAAA6AAAAOgBhtX2rwAAAAd0SU1FB+gIFBUtLabQ30cAAAEtSURBVDjLrZJXQ8IwFIUjRQQRRUXcewKKW3Erbhy4wAEimv//H0y4p22Slic9L733nC+jSRj7T7UELFKwCdDKoVAToM0GwhHfvJ07ivoCHS4Q88s7u1wg3u0D9HBFvd480acCyX4PMMA1DXqAIQqGR+g7auZjGDk+gWLSAKbInp6ZnaNqXs8XUmSnnbUyixqwRG52mbEVrLGq5mvrZG6IenOL6u2cAuxg1K5s9tDsK8ABWYeNWzzCNo/d/ARWntpTTHHmAPj3zLl+qBd2Hrwk4wr9dYH6m1sYIYy4s0fcwyhSG3mg9vFJKi82+ow9vdDTi+r3KOcpoS43gJgOvArrDfW7zD/iOpBMMJar4OlVBWBxQ5/CrKEOiKMvmMCXMq14enXL1Ldc+AdNnf1Zv9MjogPfmGNPAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI0LTA4LTIwVDIxOjQ1OjQ1KzAwOjAwMdr8AwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNC0wOC0yMFQyMTo0NTo0NSswMDowMECHRL8AAAAZdEVYdFNvZnR3YXJlAHd3dy5pbmtzY2FwZS5vcmeb7jwaAAAAV3pUWHRSYXcgcHJvZmlsZSB0eXBlIGlwdGMAAHic4/IMCHFWKCjKT8vMSeVSAAMjCy5jCxMjE0uTFAMTIESANMNkAyOzVCDL2NTIxMzEHMQHy4BIoEouAOoXEXTyQjWVAAAAAElFTkSuQmCC" alt="ET AJO Content MCP logo" />
    <div class="header-actions">
      <span class="logo-text">ET AJO Content MCP</span>
      <a class="btn-about" href="https://github.com/etrakselis/ajo_content_mgmt_mcp" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
        </svg>
        About
      </a>
    </div>
  </header>

  <main>
    <div class="hero">
      <h1>Connect to Adobe Journey Optimizer</h1>
      <p>Upload your credentials file and define the sandbox to activate the MCP server. LLM clients can then manage content templates and fragments via standardized tools.</p>
    </div>

    <div class="reset-notice" id="resetNotice">
      <strong>The MCP server was restarted</strong> and is no longer configured (this happens when the container is rebuilt or restarted). Re-upload your credentials and start the server again to reconnect.
    </div>
    <div class="client-restart-notice" id="clientRestartNotice">
      <strong>Restart your MCP client.</strong> A client was connected when this server went down. Once you've restarted the server here, you must also restart your MCP client (Claude Desktop, Claude Code, Cursor, etc.) so it can reinitialize the connection — the previous session cannot be recovered automatically.
      <button class="dismiss-btn" onclick="document.getElementById('clientRestartNotice').classList.remove('show')">Dismiss</button>
    </div>

    <!-- Step 1: Credentials -->
    <section class="step" id="step1" data-step-name="Credentials">
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

    </section>

    <!-- Tenant identity — revealed as soon as credentials are analyzed, so the
         user can confirm the tenant before continuing. -->
    <div class="tenant-banner" id="tenantBanner" style="display:none">
      <div class="tenant-banner-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-3"/>
        </svg>
      </div>
      <div class="tenant-banner-text">
        <span class="tenant-banner-label">Tenant namespace</span>
        <span class="tenant-banner-value" id="tenantValue">—</span>
      </div>
    </div>

    <!-- Step 2: Sandbox -->
    <section class="step hidden" id="step2" data-step-name="Sandbox">
    <div class="step-label">Step 2 — Sandbox</div>
    <div class="card">
      <h2>Select sandbox</h2>
      <p>Choose the Adobe Experience Platform sandbox to target. Sandboxes are discovered automatically from your uploaded credentials. All API calls will be scoped to the selected sandbox.</p>

      <!-- Before any credentials are uploaded -->
      <div class="sandbox-msg" id="sandboxPrompt">Upload your credentials file above to load the list of accessible sandboxes.</div>

      <!-- While discovering -->
      <div class="sandbox-msg" id="sandboxLoading" style="display:none"><span class="spinner dark"></span> Discovering sandboxes…</div>

      <!-- Auto-discovery succeeded: pick from the dropdown -->
      <div class="field-group" id="sandboxSelectGroup" style="display:none">
        <label for="sandboxSelect">Sandbox name</label>
        <select id="sandboxSelect"></select>
        <span class="hint">Discovered from your API project credentials. <a id="manualEntryLink">Enter a name manually</a> instead.</span>
      </div>

      <!-- Manual entry fallback -->
      <div class="field-group" id="sandboxManualGroup" style="display:none">
        <label for="sandboxInput">Sandbox name</label>
        <input type="text" id="sandboxInput" placeholder="e.g. prod or cjm-team" autocomplete="off" />
        <span class="hint">Find this in the Adobe Experience Platform sandbox switcher. <a id="autoDiscoverLink">Discover sandboxes automatically</a>.</span>
      </div>

      <!-- Info / error banner for discovery -->
      <div class="sandbox-note" id="sandboxNote" style="display:none"></div>
    </div>

    </section>

    <!-- Step 3: Author -->
    <section class="step hidden" id="step3" data-step-name="Author">
    <div class="step-label">Step 3 — Author</div>
    <div class="card">
      <div class="field-group">
        <label for="authorEmailInput">Your email <span class="required-mark">*</span></label>
        <input type="email" id="authorEmailInput" placeholder="you@company.com" autocomplete="email" />
        <span class="hint">Recorded with every content change made while the server runs, so create/update/delete actions can be attributed to you. This is <strong>not verified</strong> — please enter your real address. The next step will appear once a valid email format is detected.</span>
      </div>
    </div>
    </section>

    <!-- Step 4: Access mode -->
    <section class="step hidden" id="step4" data-step-name="Access mode (optional)">
    <div class="step-label">Step 4 — Access mode</div>
    <div class="card">
      <h2>Write access</h2>
      <p>Control what connected LLM clients are allowed to do. The server defaults to <strong>read-only</strong> — turn this on only if you want clients to create, update, delete, publish, or archive content.</p>
      <label class="toggle-row" for="writeToggle">
        <span class="toggle-text">
          <span class="toggle-title">Allow write operations</span>
          <span class="hint">On: write tools (create, update, delete, publish, archive) execute normally. Off: read-only — those tools are still visible to the client but are blocked at execution and return an error; only list/get actually run. You can flip this any time after launch and it takes effect immediately — no client restart needed.</span>
        </span>
        <span class="switch">
          <input type="checkbox" id="writeToggle" />
          <span class="slider"></span>
        </span>
      </label>
    </div>

    </section>

    <!-- Step 5: Naming Convention — only shown when write access is on -->
    <section class="step hidden" id="step5" data-step-name="Naming Convention (optional)">
    <div class="step-label">Step 5 — Naming Convention</div>
    <div class="card">
      <h2>Content naming convention</h2>
      <p>Optionally define naming rules for content templates, fragments, folders, and tags. When enforcement is on, the connected LLM will follow these rules automatically whenever it creates or names any of those. Write your convention in markdown — the LLM reads it directly.</p>
      <label class="toggle-row" for="namingConventionToggle" style="cursor:pointer;margin-bottom:0">
        <span class="toggle-text">
          <span class="toggle-title">Enforce naming convention</span>
          <span class="hint">When on, the LLM must follow the rules below when naming new content templates, fragments, folders, and tags.</span>
        </span>
        <span class="switch">
          <input type="checkbox" id="namingConventionToggle" />
          <span class="slider"></span>
        </span>
      </label>
      <div id="namingConventionEditor" class="naming-editor-wrap" style="display:none">
        <div class="md-dropzone-wrap" id="namingMdDropzone">
          <textarea id="namingConventionMarkdown" class="md-editor" maxlength="20000" placeholder="Define your naming rules in markdown. The LLM will read and apply these rules to templates, fragments, folders, and tags.">{{DEFAULT_NAMING_CONVENTION}}</textarea>
          <div class="md-drop-overlay">Drop .md file here</div>
          <input type="file" id="namingMdFileInput" accept=".md,text/markdown,text/plain" style="display:none" />
        </div>
        <div class="md-editor-footer">
          <span class="hint">If needed, edit/replace the above default for your use-case, otherwise leave as is.</span>
          <button class="upload-md-btn" type="button" id="namingMdUploadBtn">Upload .md file</button>
        </div>
        <div class="md-editor-msg" id="namingMdMsg"></div>
      </div>
    </div>
    </section>

    <!-- Step 6: Launch -->
    <section class="step hidden" id="step6" data-step-name="Launch">
    <div class="step-label">Step 6 — Launch</div>
    <div class="card">
      <div class="error-msg" id="errorMsg"></div>
      <button class="btn-primary" id="startBtn" disabled>
        Start MCP Server
      </button>

      <!-- Connection summary — shown right below the button once the server is
           active. Tenant namespace and sandbox are already shown above (banner +
           Step 2), so only the access mode is surfaced here. -->
      <div class="conn-info" id="connInfo">
        <div class="conn-row">
          <span class="conn-key">Access mode</span>
          <span class="conn-val" id="connAccess">—</span>
        </div>
      </div>

      <!-- Shown after re-activation when clients were connected under the previous config -->
      <div class="config-change-notice" id="configChangeNotice">
        <strong>Restart your MCP client(s).</strong> The server configuration changed since clients last connected. Previously connected clients (Claude Desktop, Claude Code, Cursor, etc.) must be restarted to pick up the updated settings.
        <button class="dismiss-btn" onclick="document.getElementById('configChangeNotice').classList.remove('show')">Dismiss</button>
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

    </section>

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
        <h3>Recently connected client(s) (idle http clients get removed after 10 seconds, stdio clients are always shown unless the app is closed)</h3>
        <div class="clients-list" id="clientsList">
          <div class="clients-empty"><span class="status-dot"></span> Waiting for an MCP client to connect…</div>
        </div>
        <p class="clients-hint">See the <a href="https://github.com/etrakselis/ajo_content_mgmt_mcp#client-connection-guide" target="_blank" rel="noopener noreferrer" style="color:var(--adobe-red);text-decoration:none;font-weight:600"><strong>README</strong></a> on GitHub for (Claude Code/Desktop, Cursor, Codex…) connection guide for per-client setup instructions.</p>
      </div>
    </div>
  </main>

  <script>
    let credentials = null;
    let serverUrl = window.location.origin;

    // The naming-convention editor is pre-filled (server-injected) with the default
    // governance rules. Capture that initial value so a server-reset can restore it
    // rather than blanking the box.
    const DEFAULT_NAMING_MD = document.getElementById('namingConventionMarkdown').value;

    function copyText(id) {
      const el = document.getElementById(id);
      navigator.clipboard.writeText(el.textContent);
    }

    // ─── Connected-client polling ──────────────────────────────────────────────
    let clientPollTimer = null;
    let pollFailCount = 0;
    let prevClientCount = 0;
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
        prevClientCount = 0;
        list.innerHTML = '<div class="clients-empty"><span class="status-dot"></span> Waiting for an MCP client to connect…</div>';
        return;
      }
      hadConnectedClients = true;
      if (clients.length > prevClientCount) {
        setTimeout(() => document.getElementById('statusPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
      }
      prevClientCount = clients.length;
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
        pollFailCount = 0;
        // If the server reports it's no longer configured while this page still
        // shows "active", the container was restarted/rebuilt and lost its state.
        // Reset the page so the UI matches reality.
        if (data.configured === false) { handleServerReset(); return; }
        renderClients(data.clients);
      } catch {
        // After 3 consecutive network failures (~9 s) treat the server as gone.
        if (++pollFailCount >= 3) handleServerReset();
      }
    }

    function startClientPolling() {
      pollFailCount = 0;
      prevClientCount = 0;
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
          document.getElementById('fileName').textContent = credName ;
          dropzone.style.display = 'none';
          discoverSandboxes();
        } catch {
          showError('Invalid JSON file. Please check the file format.');
        }
      };
      reader.readAsText(file);
    }

    // Allow swapping in a different credentials file without reloading the page
    document.getElementById('replaceFileBtn').addEventListener('click', () => {
      credentials = null;
      hadConnectedClients = false;
      fileInput.value = '';
      document.getElementById('fileAccepted').classList.remove('show');
      dropzone.style.display = '';
      resetActivationUI();
      resetSandboxUI();
      checkReady();
    });

    // Reset everything that activation produced, back to the pre-launch state
    function resetActivationUI() {
      needsOrg = false;
      serverActive = false;
      document.getElementById('clientRestartNotice').classList.remove('show');
      document.getElementById('configChangeNotice').classList.remove('show');
      stopClientPolling();
      renderClients([]);
      const btn = document.getElementById('startBtn');
      btn.innerHTML = 'Start MCP Server';
      btn.style.background = '';
      btn.disabled = false;
      btn.classList.remove('btn-trace', 'btn-breathing');
      document.getElementById('statusPanel').classList.remove('show');
      document.getElementById('connInfo').classList.remove('show');
      document.getElementById('orgFallback').classList.remove('show');
      document.getElementById('orgInput').value = '';
      document.getElementById('errorMsg').classList.remove('show');
    }

    // The server lost its configuration (container restarted/rebuilt). Return the
    // page to the initial upload state and explain why, since the credentials and
    // sandbox the server held are gone and must be provided again.
    function handleServerReset() {
      const clientsWereConnected = hadConnectedClients;
      hadConnectedClients = false;
      resetActivationUI();
      resetSandboxUI();
      credentials = null;
      fileInput.value = '';
      document.getElementById('fileAccepted').classList.remove('show');
      dropzone.style.display = '';
      document.getElementById('writeToggle').checked = false;
      document.getElementById('authorEmailInput').value = '';
      document.getElementById('namingConventionToggle').checked = false;
      document.getElementById('namingConventionEditor').style.display = 'none';
      document.getElementById('namingConventionMarkdown').value = DEFAULT_NAMING_MD;
      document.getElementById('resetNotice').classList.add('show');
      if (clientsWereConnected) document.getElementById('clientRestartNotice').classList.add('show');
      checkReady();
    }

    let needsOrg = false;
    let hadConnectedClients = false;
    let serverActive = false;
    const startBtn = document.getElementById('startBtn');

    // ─── Sandbox discovery ─────────────────────────────────────────────────────
    // 'idle' (no creds yet) · 'loading' · 'list' (dropdown) · 'manual' (text input)
    let sandboxMode = 'idle';

    // The active sandbox value depends on which input is currently shown.
    function getSandboxName() {
      if (sandboxMode === 'list') {
        return document.getElementById('sandboxSelect').value.trim();
      }
      return document.getElementById('sandboxInput').value.trim();
    }

    function setSandboxMode(mode) {
      sandboxMode = mode;
      document.getElementById('sandboxPrompt').style.display = mode === 'idle' ? '' : 'none';
      document.getElementById('sandboxLoading').style.display = mode === 'loading' ? '' : 'none';
      document.getElementById('sandboxSelectGroup').style.display = mode === 'list' ? '' : 'none';
      document.getElementById('sandboxManualGroup').style.display = mode === 'manual' ? '' : 'none';
    }

    function showSandboxNote(html, kind) {
      const el = document.getElementById('sandboxNote');
      if (!html) { el.style.display = 'none'; el.innerHTML = ''; return; }
      el.className = 'sandbox-note ' + (kind || 'info');
      el.innerHTML = html;
      el.style.display = '';
    }

    // Tenant identity banner shown between Step 1 and Step 2.
    function showTenantBanner(text, isWarn) {
      document.getElementById('tenantValue').textContent = text;
      document.getElementById('tenantBanner').classList.toggle('warn', !!isWarn);
      document.getElementById('tenantBanner').style.display = '';
    }
    function hideTenantBanner() {
      document.getElementById('tenantBanner').style.display = 'none';
    }

    // Return Step 2 to its initial state (used when credentials are removed/lost).
    function resetSandboxUI() {
      setSandboxMode('idle');
      showSandboxNote('');
      hideTenantBanner();
      document.getElementById('sandboxSelect').innerHTML = '';
      document.getElementById('sandboxInput').value = '';
    }

    // Switch to manual entry and explain why auto-discovery didn't populate the list.
    function fallbackToManual(noteHtml, kind) {
      setSandboxMode('manual');
      showSandboxNote(noteHtml, kind);
      const retry = document.getElementById('retryDiscoverLink');
      if (retry) retry.addEventListener('click', (e) => { e.preventDefault(); discoverSandboxes(); });
      checkReady();
    }

    function populateSandboxDropdown(sandboxes) {
      // Place a "prod" sandbox first (if present), then sort the rest by label.
      const sorted = sandboxes.slice().sort((a, b) => {
        const ap = a.name === 'prod' ? 0 : 1, bp = b.name === 'prod' ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (a.title || a.name).localeCompare(b.title || b.name);
      });
      // Always lead with a placeholder so the user must actively pick a sandbox,
      // even when only one is available — never auto-select.
      let html = '<option value="" disabled selected>Select a sandbox…</option>';
      html += sorted.map(s => {
        const base = (s.title && s.title !== s.name) ? s.title + ' (' + s.name + ')' : s.name;
        const text = s.type ? base + ' — ' + s.type : base;
        return '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(text) + '</option>';
      }).join('');
      const sel = document.getElementById('sandboxSelect');
      sel.innerHTML = html;
      setSandboxMode('list');
      showSandboxNote('');
      checkReady();
    }

    async function discoverSandboxes() {
      if (!credentials) { resetSandboxUI(); checkReady(); return; }
      // A fresh credential set invalidates any prior detection / activation.
      if (needsOrg || document.getElementById('statusPanel').classList.contains('show')) {
        resetActivationUI();
      }
      setSandboxMode('loading');
      showSandboxNote('');
      hideTenantBanner();
      checkReady();

      let data;
      try {
        data = await postJson('/api/list-sandboxes', { credentials });
      } catch (err) {
        fallbackToManual('Unable to retrieve the sandbox list (network error). Enter the sandbox name manually, or <a id="retryDiscoverLink">try again</a>.', 'warn');
        return;
      }

      // Surface the tenant identity as soon as it's known (detected server-side
      // from a discovered sandbox; org-wide so it applies to any selection).
      if (data.tenantNamespace) showTenantBanner(data.tenantNamespace, false);

      if (!data.success) {
        let msg;
        if (data.code === 'AUTH_FAILED') {
          msg = 'Could not authenticate with Adobe to load sandboxes. You can still enter the sandbox name manually — your credentials are fully validated when you start the server.';
        } else if (data.code === 'FORBIDDEN') {
          msg = 'These credentials do not have permission to list sandboxes (the Sandbox Management API may not be added to your Adobe Developer Console project). Enter the sandbox name manually instead.';
        } else {
          msg = (data.error || 'Could not load sandboxes.') + ' Enter the sandbox name manually, or <a id="retryDiscoverLink">try again</a>.';
        }
        fallbackToManual(msg, 'warn');
        return;
      }

      const sandboxes = Array.isArray(data.sandboxes) ? data.sandboxes : [];
      if (!sandboxes.length) {
        fallbackToManual('No accessible sandboxes were found for this API project. Enter a sandbox name manually if you know it.', 'info');
        return;
      }
      populateSandboxDropdown(sandboxes);
    }

    // Toggle between the dropdown and manual entry.
    document.getElementById('manualEntryLink').addEventListener('click', (e) => {
      e.preventDefault();
      setSandboxMode('manual');
      showSandboxNote('');
      checkReady();
    });
    document.getElementById('autoDiscoverLink').addEventListener('click', (e) => {
      e.preventDefault();
      discoverSandboxes();
    });

    // Selecting a different sandbox from the dropdown invalidates prior activation.
    document.getElementById('sandboxSelect').addEventListener('change', () => {
      if (needsOrg || document.getElementById('statusPanel').classList.contains('show')) {
        resetActivationUI();
      }
      checkReady();
    });

    document.getElementById('sandboxInput').addEventListener('input', () => {
      // Changing the sandbox invalidates any prior detection / activation
      if (needsOrg || document.getElementById('statusPanel').classList.contains('show')) {
        resetActivationUI();
      }
      checkReady();
    });

    // Reveal steps one at a time: Step 1 is always shown; Step 2 appears once
    // credentials are loaded; Steps 3 & 4 appear once a sandbox is chosen.
    // Removing/replacing credentials (or a server reset) collapses back.
    function syncSteps() {
      const hasCreds = !!credentials;
      const hasSandbox = !!getSandboxName();
      const hasEmail = isAuthorEmailValid();
      const writeOn = document.getElementById('writeToggle').checked;
      const steps = document.querySelectorAll('.step');
      const wasHidden = {};
      steps.forEach(s => { wasHidden[s.id] = s.classList.contains('hidden'); });
      document.getElementById('step2').classList.toggle('hidden', !hasCreds);
      document.getElementById('step3').classList.toggle('hidden', !(hasCreds && hasSandbox));
      document.getElementById('step4').classList.toggle('hidden', !(hasCreds && hasSandbox && hasEmail));
      document.getElementById('step5').classList.toggle('hidden', !(hasCreds && hasSandbox && hasEmail && writeOn));
      document.getElementById('step6').classList.toggle('hidden', !(hasCreds && hasSandbox && hasEmail));
      // Renumber labels sequentially based on which steps are currently visible,
      // so the user always sees 1, 2, 3… with no gaps regardless of toggle state.
      let n = 0;
      steps.forEach(function(section) {
        if (!section.classList.contains('hidden')) {
          n++;
          const label = section.querySelector('.step-label');
          if (label) label.textContent = 'Step ' + n + ' — ' + section.dataset.stepName;
        }
      });
      // Breathing animation on the activate button tracks step 6 visibility.
      startBtn.classList.toggle('btn-breathing', !document.getElementById('step6').classList.contains('hidden'));

      // Trace the first newly revealed step; if a step was hidden, fall back to the
      // last still-visible step so the trace never gets stuck on a hidden card.
      const newlyVisible = Array.from(steps).find(s => wasHidden[s.id] && !s.classList.contains('hidden'));
      const newlyHidden  = Array.from(steps).find(s => !wasHidden[s.id] && s.classList.contains('hidden'));
      if (newlyVisible) {
        const lastVisible = Array.from(steps).filter(s => !s.classList.contains('hidden')).pop();
        setTimeout(() => (lastVisible || newlyVisible).scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        updateCardTrace(newlyVisible);
      } else if (newlyHidden) {
        const lastVisible = Array.from(steps).filter(s => !s.classList.contains('hidden')).pop();
        updateCardTrace(lastVisible || null);
      }
    }

    // Self-declared author email — required before launch. Validated only for
    // basic shape; ownership is never verified.
    function getAuthorEmail() {
      return document.getElementById('authorEmailInput').value.trim();
    }
    function isAuthorEmailValid() {
      return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(getAuthorEmail());
    }

    let emailSyncTimer = null;
    document.getElementById('authorEmailInput').addEventListener('input', () => {
      if (needsOrg || document.getElementById('statusPanel').classList.contains('show')) {
        resetActivationUI();
      }
      // Update button state immediately so it reflects the current validity without delay.
      startBtn.disabled = !credentials || !getSandboxName() || !isAuthorEmailValid();
      // Debounce step reveal: wait until the user pauses typing before showing/hiding
      // downstream steps so they don't flash in and out mid-word.
      clearTimeout(emailSyncTimer);
      emailSyncTimer = setTimeout(syncSteps, 600);
    });

    function updateCardTrace(step) {
      document.querySelectorAll('.card').forEach(c => c.classList.remove('card-trace'));
      if (!step || step.id === 'step6') return;
      const cards = step.querySelectorAll('.card');
      if (cards.length) cards[cards.length - 1].classList.add('card-trace');
    }

    function checkReady() {
      startBtn.disabled = !credentials || !getSandboxName() || !isAuthorEmailValid();
      syncSteps();
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

    async function deactivate() {
      startBtn.disabled = true;
      startBtn.innerHTML = spinner('Deactivating…');
      try { await postJson('/api/deactivate', {}); } catch { /* reset UI regardless */ }
      resetActivationUI();
      checkReady();
    }

    startBtn.addEventListener('click', async () => {
      if (serverActive) { deactivate(); return; }
      const sandbox = getSandboxName();
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

      const allowWrites = document.getElementById('writeToggle').checked;
      let data;
      try {
        data = await postJson('/api/configure', { credentials, sandboxName: sandbox, orgName: org || undefined, allowWrites, authorEmail: getAuthorEmail(), namingConvention: getNamingConvention() });
      } catch (err) {
        clearInterval(stepTimer);
        return failStart('Network error: ' + err.message);
      }
      clearInterval(stepTimer);

      if (!data.success) {
        return failStart(data.error || 'Configuration failed.');
      }

      // Server is active — render the connection summary right below the button
      document.getElementById('httpEndpoint').textContent = serverUrl + '/mcp';
      document.getElementById('statusPanel').classList.add('show');
      setAccessModeDisplay(data.writesAllowed);
      document.getElementById('connInfo').classList.add('show');
      updateCardTrace(null);
      if (hadConnectedClients) {
        document.getElementById('configChangeNotice').classList.add('show');
        hadConnectedClients = false;
      }
      startClientPolling();
      setTimeout(() => document.getElementById('statusPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);

      // Finalize the tenant identity in the banner above (it may have been
      // unknown until the user supplied an org name for the fallback).
      if (data.tenantNamespace) {
        showTenantBanner(data.tenantNamespace, false);
        document.getElementById('orgFallback').classList.remove('show');
      } else if (org) {
        showTenantBanner(org + ' (manual)', false);
      } else {
        showTenantBanner('Not auto-detected', true);
      }

      serverActive = true;
      startBtn.disabled = false;
      startBtn.innerHTML = 'Deactivate Server';
      startBtn.style.background = 'var(--adobe-mid)';
    }

    function setAccessModeDisplay(writesAllowed) {
      const el = document.getElementById('connAccess');
      if (writesAllowed === false) {
        el.textContent = 'Read-only';
        el.classList.add('warn');
      } else {
        el.textContent = 'Read & write';
        el.classList.remove('warn');
      }
    }

    // ─── Naming convention ─────────────────────────────────────────────────────

    function getNamingConvention() {
      return {
        enabled: document.getElementById('namingConventionToggle').checked,
        markdown: document.getElementById('namingConventionMarkdown').value.trim()
      };
    }

    // Naming convention is injected into the LLM's system prompt every session, so
    // it's capped (matching the server's limit). maxlength bounds typing/pasting;
    // these guards bound file uploads, which set .value programmatically and so
    // bypass maxlength. The byte guard rejects an absurd/binary file before reading
    // it into memory; the char guard is the authoritative check after decoding.
    const MAX_NAMING_MD_LEN = 20000;
    const MAX_NAMING_FILE_BYTES = 100 * 1024;

    (function setupNamingConvention() {
      const dropzone = document.getElementById('namingMdDropzone');
      const fileInput = document.getElementById('namingMdFileInput');
      const uploadBtn = document.getElementById('namingMdUploadBtn');
      const textarea = document.getElementById('namingConventionMarkdown');
      const msg = document.getElementById('namingMdMsg');

      function showMsg(text, kind) {
        msg.textContent = text;
        msg.className = 'md-editor-msg show ' + (kind || 'error');
      }
      function clearMsg() { msg.textContent = ''; msg.className = 'md-editor-msg'; }

      function invalidate() {
        if (needsOrg || document.getElementById('statusPanel').classList.contains('show')) resetActivationUI();
      }

      // Read a dropped/selected .md file into the editor, with size guards.
      function loadMdFile(file) {
        if (!file) return;
        if (file.size > MAX_NAMING_FILE_BYTES) {
          showMsg('That file is too large to be a naming convention (max ' + Math.round(MAX_NAMING_FILE_BYTES / 1024) + ' KB). Upload a smaller .md file.', 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = String(ev.target.result);
          if (text.length > MAX_NAMING_MD_LEN) {
            showMsg('That file has ' + text.length.toLocaleString() + ' characters, over the ' + MAX_NAMING_MD_LEN.toLocaleString() + '-character limit. Trim it and try again — it was not loaded.', 'error');
            return;
          }
          clearMsg();
          textarea.value = text;
          invalidate();
        };
        reader.onerror = () => showMsg('Could not read that file. Try again or paste the markdown directly.', 'error');
        reader.readAsText(file);
      }

      uploadBtn.addEventListener('click', () => fileInput.click());

      ['dragenter', 'dragover'].forEach(ev => {
        dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
      });
      ['dragleave', 'drop'].forEach(ev => {
        dropzone.addEventListener(ev, () => dropzone.classList.remove('drag-over'));
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        loadMdFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', () => {
        loadMdFile(fileInput.files[0]);
        fileInput.value = '';
      });

      document.getElementById('namingConventionToggle').addEventListener('change', (e) => {
        const editor = document.getElementById('namingConventionEditor');
        editor.style.display = e.target.checked ? '' : 'none';
        document.getElementById('namingConventionMarkdown').classList.toggle('md-editor-tall', !!e.target.checked);
        if (e.target.checked) setTimeout(() => {
          document.getElementById('step5').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
        invalidate();
      });

      textarea.addEventListener('input', () => {
        // maxlength caps typed/pasted length; clear any stale over-limit message.
        if (textarea.value.length <= MAX_NAMING_MD_LEN) clearMsg();
        invalidate();
      });
    })();

    // The write toggle drives step visibility (naming convention only appears when
    // writes are on) and, once the server is active, flips the access mode live.
    updateCardTrace(document.getElementById('step1'));

    document.getElementById('writeToggle').addEventListener('change', async (e) => {
      // Turning writes off makes naming convention irrelevant — clear it so the
      // user doesn't accidentally activate a convention they can't use.
      if (!e.target.checked) {
        document.getElementById('namingConventionToggle').checked = false;
        document.getElementById('namingConventionEditor').style.display = 'none';
      }
      syncSteps();
      if (!document.getElementById('statusPanel').classList.contains('show')) return;
      try {
        const data = await postJson('/api/access-mode', { allowWrites: e.target.checked });
        if (data.success) setAccessModeDisplay(data.writesAllowed);
      } catch { /* will apply on next activation */ }
    });
  </script>
</body>
</html>`;

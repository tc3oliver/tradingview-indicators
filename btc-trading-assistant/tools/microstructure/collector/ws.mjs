// Reconnecting websocket with staleness tracking.
// Reconnects on close, on error, on a staleness timeout, and pre-emptively before the
// exchange's 24-hour connection cap. Every reconnect is reported so it can be written
// to the event log — an unlogged reconnect is a hole in the record.
export class Stream {
  constructor(url, { name, onMessage, onEvent, staleMs = 5000, maxHours = 12 }) {
    this.url = url; this.name = name;
    this.onMessage = onMessage;
    this.onEvent = onEvent || (() => {});
    this.staleMs = staleMs; this.maxMs = maxHours * 3600_000;
    this.ws = null; this.connectedAt = 0; this.lastMsgAt = 0;
    this.messages = 0; this.reconnects = 0; this.attempt = 0;
    this.stopped = false;
  }

  get ageMs() { return this.lastMsgAt ? Date.now() - this.lastMsgAt : Infinity; }
  get stale() { return this.ageMs > this.staleMs; }

  start() { this.stopped = false; this._open(); this._watch(); return this; }

  stop() {
    this.stopped = true;
    clearInterval(this._timer);
    try { this.ws?.close(); } catch { /* already closing */ }
  }

  _open() {
    if (this.stopped) return;
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { return this._retry(`construct failed: ${e.message}`); }
    this.ws = ws;
    ws.onopen = () => {
      this.connectedAt = Date.now(); this.lastMsgAt = Date.now(); this.attempt = 0;
      this.onEvent({ type: 'ws_open', stream: this.name, at: this.connectedAt });
    };
    ws.onmessage = (m) => {
      this.lastMsgAt = Date.now(); this.messages++;
      let payload;
      try { payload = JSON.parse(m.data); } catch { return this.onEvent({ type: 'ws_parse_error', stream: this.name, at: Date.now() }); }
      this.onMessage(payload.data ?? payload, this.lastMsgAt);
    };
    ws.onerror = () => { /* close follows */ };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this._retry(`closed code=${e?.code ?? '?'}`);
    };
  }

  _retry(reason) {
    if (this.stopped) return;
    this.reconnects++;
    this.attempt++;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.attempt, 6));
    this.onEvent({ type: 'ws_reconnect', stream: this.name, at: Date.now(), reason, attempt: this.attempt, delayMs: delay });
    this.ws = null;
    setTimeout(() => this._open(), delay);
  }

  _watch() {
    this._timer = setInterval(() => {
      if (this.stopped || !this.ws) return;
      if (this.connectedAt && Date.now() - this.connectedAt > this.maxMs) {
        this.onEvent({ type: 'ws_rotate', stream: this.name, at: Date.now(), reason: 'pre-empting the 24h connection cap' });
        const old = this.ws; this.ws = null;
        try { old.close(); } catch { /* ignore */ }
        this._open();
        return;
      }
      if (this.stale) {
        this.onEvent({ type: 'ws_stale', stream: this.name, at: Date.now(), ageMs: this.ageMs });
        const old = this.ws; this.ws = null;
        try { old.close(); } catch { /* ignore */ }
        this._retry('stale feed');
      }
    }, 1000);
    this._timer.unref?.();
  }
}

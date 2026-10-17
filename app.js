/* Exodus board: the application tracker as a game the candidate has to win (Bangalore -> Europe). Vanilla JS, no build
 * step, relative URLs only. The art lives in art.js; Motion (vendor/motion-12.23.0) animates the fly-back and the bursts.
 *
 * Flow: password -> PBKDF2-SHA256 (salt + iterations from manifest.json) -> AES-256-GCM key -> decrypt check.enc ("ok")
 * -> decrypt data.json (+ secrets.json when the bundle carries the write token) -> render. Documents are decrypted on
 * demand into Blob URLs. The raw AES key lives in sessionStorage so a reload on the phone does not ask again.
 *
 * Writes (CLAUDE.md §10, tracker/SCHEMA.md): the page never talks to a server of its own. With the write token it creates
 * files in the private repo through the GitHub Contents API, never modifying one: tracker/jobs/manual-<time>.json (a queued
 * job) and tracker/commands/<ms>-<cid>.json (set, job, job_applied, revise, reached_out, original_instruction,
 * general_instruction, notification_read). CI replays the commands and republishes; until then the change shows as SYNCING
 * from a pending list kept in localStorage.
 *
 * Every command carries a unique `cid` (also in its file name, tracker/commands/<ms>-<cid>.json); data.json.commands lists
 * the cids CI processed or rejected, so a SYNCING entry clears exactly when its command was applied (or turns red with
 * the reason when it was rejected). The time-based prune stays only as a 3-day fallback.
 *
 * Crypto format v2 (scripts/encrypt_bundle.py): blob = iv(12) || ciphertext || tag(16). Public: manifest.json (KDF
 * parameters only), check.enc, index.enc. index.enc (encrypted) maps every bundle path to its opaque file d/<id>.enc.
 */
'use strict';
(() => {
  // ---------------------------------------------------------------- helpers
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const attr = s => esc(s).replace(/\n/g, '&#10;');
  const DAY = 86400000;
  const isoDay = s => (s || '').slice(0, 10);
  const parseDay = s => new Date(isoDay(s) + 'T00:00:00');
  const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = () => ymd(today());
  const daysSince = s => s ? Math.max(0, Math.round((today() - parseDay(s)) / DAY)) : null;
  const fmtDay = s => s ? parseDay(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  const fmtStamp = s => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? s : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const num = (v, d = 0) => (v == null || isNaN(v)) ? '–' : Number(v).toFixed(d).replace(/\.0$/, '');
  const by = (f, dir = 1) => (a, b) => { const x = f(a), y = f(b); return x < y ? -dir : x > y ? dir : 0; };
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u || ''; } };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const store = {   // per-viewer conveniences only; every access may throw (private mode, blocked storage)
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const DOC_LABELS = { resume: 'Resume PDF', cover_letter: 'Cover letter', report: 'Report', jd: 'JD', job_description: 'JD', notes: 'Notes', tailoring_notes: 'Notes', screening: 'Screening', interview_prep: 'Interview prep', project_spec: 'Project spec' };
  const EXCLUDED = ['stale-cleanup-2026-10', 'no-response-30d'];   // rule closures: never a reply
  const INSIGHT_EXCLUDED = ['stale-cleanup-2026-10'];                // left out of the insights; silence (no-response-30d) counts as a send without a reply (M4)
  const REASON_TEXT = { 'stale-cleanup-2026-10': 'closed in the 2026-10 board reset', 'no-response-30d': 'no reply within 30 days' };
  const roleLabel = r => (State.data && State.data.roles && State.data.roles[r]) || String(r || '').replace(/([a-z])([A-Z])/g, '$1 $2');

  // ---------------------------------------------------------------- flags (vendored flag-icons 4x3 SVGs, MIT)
  const FLAG_DIR = 'vendor/flag-icons-7.5.0/4x3/';
  const ISO = { Australia: 'au', Austria: 'at', Belgium: 'be', Canada: 'ca', Czechia: 'cz', Denmark: 'dk', Estonia: 'ee', Finland: 'fi', Germany: 'de',
    Ireland: 'ie', Japan: 'jp', Luxembourg: 'lu', Netherlands: 'nl', Norway: 'no', Poland: 'pl', Portugal: 'pt', Singapore: 'sg', Spain: 'es',
    Sweden: 'se', Switzerland: 'ch', UAE: 'ae', UK: 'gb', India: 'in', USA: 'us', Europe: 'eu' };
  const flag = (c, cls = '') => ISO[c] ? `<img class="flag ${cls}" src="${FLAG_DIR}${ISO[c]}.svg" alt="${attr(c)}" title="${attr(c)}" width="20" height="15" loading="lazy" decoding="async">`
    : `<span class="flag noflag ${cls}" title="${attr(c === 'Global' ? 'Global (US + India market)' : c || 'country not known yet')}">${ico(c === 'Global' ? 'globe' : 'help')}</span>`;

  // ---------------------------------------------------------------- pixel icons (text maps -> inline SVG, currentColor)
  const ICON = {
    key: ['.xxx.....', 'x...x....', 'x...xxxxx', 'x...x.x.x', '.xxx.....'],
    send: ['........x', '......xxx', '....xxx.x', '..xxx..x.', 'xxxx..x..', '..xx.x...', '...xxx...', '...xx....', '...x.....'],
    revise: ['..x......', '.xx......', 'xxxxxxx..', '.xx....x.', '..x.....x', '........x', '.......x.', '..xxxxx..'],
    trash: ['...xxx...', 'xxxxxxxxx', '.x.....x.', '.x.x.x.x.', '.x.x.x.x.', '.x.x.x.x.', '.x.....x.', '..xxxxx..'],
    skull: ['..xxxxx..', '.xxxxxxx.', 'xx..x..xx', 'xx..x..xx', 'xxxxxxxxx', '.xxx.xxx.', '..x.x.x..', '..xxxxx..'],
    quill: ['.......xx', '......xxx', '.....xxx.', '....xxx..', '...xxx...', '..xxx....', '.xx......', 'x........'],
    bell: ['....x....', '...xxx...', '..xxxxx..', '..xxxxx..', '.xxxxxxx.', 'xxxxxxxxx', '.........', '...xxx...'],
    beacon: ['x...x...x', '.x..x..x.', '...xxx...', '..xxxxx..', '...xxx...', '...x.x...', '..x...x..', '.x.....x.', 'xxxxxxxxx'],
    copy: ['xxxxx....', 'x...x....', 'x..xxxxx.', 'x..x...x.', 'xxxx...x.', '...x...x.', '...xxxxx.'],
    close: ['xx.....xx', '.xx...xx.', '..xx.xx..', '...xxx...', '..xx.xx..', '.xx...xx.', 'xx.....xx'],
    lock: ['..xxxxx..', '.x.....x.', '.x.....x.', 'xxxxxxxxx', 'xxxx.xxxx', 'xxxx.xxxx', 'xxxxxxxxx'],
    add: ['...xxx...', '...xxx...', 'xxxxxxxxx', 'xxxxxxxxx', '...xxx...', '...xxx...'],
    hammer: ['.xxxxx...', 'xxxxxxx..', '.xxxxx...', '...xx....', '....xx...', '.....xx..', '......xx.', '.......xx'],
    check: ['........x', '.......xx', 'x.....xx.', 'xx...xx..', '.xx.xx...', '..xxx....', '...x.....'],
    save: ['xxxxxxxx.', 'x.xxxx.xx', 'x.xxxx..x', 'x.......x', 'x.xxxxx.x', 'x.x...x.x', 'xxxxxxxxx'],
    doc: ['xxxxx....', 'x...xx...', 'x.xx.xx..', 'x.....x..', 'x.xxx.x..', 'x.....x..', 'x.xxx.x..', 'xxxxxxx..'],
    chart: ['.......xx', '....xx.xx', '....xx.xx', '.xx.xx.xx', '.xx.xx.xx', 'xxxxxxxxx'],
    link: ['...xxxxxx', '......xxx', '.....xx.x', '....xx..x', '...xx....', 'x.xx.....', 'xxx......'],
    mail: ['xxxxxxxxx', 'xx.....xx', 'x.x...x.x', 'x..xxx..x', 'x.......x', 'xxxxxxxxx'],
    board: ['xx.xx.xx.', 'xx.xx.xx.', '.........', 'xx.xx.xx.', 'xx.xx....', '.........', 'xx.......', 'xx.......'],
    scroll: ['.xxxxxxx.', 'x.......x', '.x.xxx.x.', '.x.....x.', '.x.xxx.x.', '.x.....x.', 'x.......x', '.xxxxxxx.'],
    globe: ['..xxxxx..', '.x.x.x.x.', 'xxxxxxxxx', 'x..x.x..x', 'xxxxxxxxx', '.x.x.x.x.', '..xxxxx..'],
    pin: ['xxxxxx...', 'xxxxxxx..', 'xxxxxx...', 'x........', 'x........', 'x........', 'x........'],
    warn: ['....x....', '...xxx...', '...x.x...', '..xx.xx..', '..xxxxx..', '.xxx.xxx.', 'xxxxxxxxx'],
    info: ['..xxxxx..', '.xxx.xxx.', 'xxxxxxxxx', 'xxx..xxxx', 'xxxx.xxxx', 'xxxx.xxxx', '.xxx..xx.', '..xxxxx..'],
    star: ['....x....', '....x....', '...xxx...', 'xxxxxxxxx', '.xxxxxxx.', '..xxxxx..', '.xx...xx.', 'xx.....xx'],
    hourglass: ['xxxxxxx', '.x...x.', '..xxx..', '...x...', '..x.x..', '.x.x.x.', 'xxxxxxx'],
    chest: ['.xxxxxxx.', 'x.......x', 'xxxxxxxxx', 'x...x...x', 'x..xxx..x', 'x.......x', 'xxxxxxxxx'],
    trophy: ['xxxxxxxxx', 'x.xxxxx.x', 'x.xxxxx.x', '.xxxxxxx.', '...xxx...', '....x....', '..xxxxx..'],
    help: ['.xxxxx.', 'xx...xx', '....xx.', '...xx..', '...xx..', '.......', '...xx..'],
    play: ['xx.....', 'xxxx...', 'xxxxxx.', 'xxxxxxx', 'xxxxxx.', 'xxxx...', 'xx.....'],
  };
  function runs(rows, test) { let d = ''; rows.forEach((r, y) => { let x = 0; while (x < r.length) { if (test(r[x])) { let e = x; while (e < r.length && r[e] === r[x]) e++; d += `M${x} ${y}h${e - x}v1h-${e - x}z`; x = e; } else x++; } }); return d; }
  function ico(name, cls = '') {
    const rows = ICON[name] || ICON.help, w = Math.max(...rows.map(r => r.length));
    return `<svg class="ico ${cls}" viewBox="0 0 ${w} ${rows.length}" width="${w * 2}" height="${rows.length * 2}" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="${runs(rows, c => c === 'x')}"/></svg>`;
  }
  function sprite(rows, pal, cls = '', scale = 3) {
    const w = rows[0].length; let paths = '';
    Object.entries(pal).forEach(([ch, col]) => { const d = runs(rows.map(r => r.replace(new RegExp(`[^${ch}]`, 'g'), '.')), c => c === ch); if (d) paths += `<path fill="${col}" d="${d}"/>`; });
    return `<svg class="spr ${cls}" viewBox="0 0 ${w} ${rows.length}" width="${w * scale}" height="${rows.length * scale}" aria-hidden="true" shape-rendering="crispEdges">${paths}</svg>`;
  }
  const KNIGHT = ['....hhhh....', '...hhhhhh...', '...hdwwdh...', '...hweewh...', '....wwww....', '..r.dwwd.s..', '.rrwdwwdws..', '.rr.dwwd.s..', '.rr..ww..s..', '.r..dddd.ws.', '....w..w....', '....w..w....', '...ww..ww...'];
  const KNIGHT_PAL = { h: '#9aa3a8', d: '#3a3f48', w: '#e8e2cf', e: '#ff5c5c', s: '#cfd8e8', r: '#8a2a3a' };
  const FLAME = [['....y....', '...yy....', '...yoy...', '..yoooy..', '..oorro..', '.yorrroy.', '.orrwrro.', '.orwwwro.', '..rwwwr..'],
    ['....y....', '....yy...', '...yoy...', '..yooy...', '..orroo..', '.yorrroy.', '.orrwrro.', '.orwwwro.', '..rwwwr..']];
  const FLAME_PAL = { y: '#ffe27a', o: '#ff9a3c', r: '#ff5c3a', w: '#fff3c4' };
  const PLANE = ['...x.....', '...xx....', 'x..xxx...', 'xxxxxxxxx', 'x..xxx...', '...xx....', '...x.....'];

  // ---------------------------------------------------------------- the game button (one component, used everywhere)
  // tone = colour family (lime send/confirm, gold revise/outreach/first, red reject/discard, cyan info/follow-up, violet
  // instructions, stone neutral). attrs carries data-* and disabled.
  const gbtn = (label, icon, tone = 'stone', attrs = '', cls = '') => `<button type="button" class="gbtn t-${tone} ${cls}" ${attrs}>${ico(icon)}<span>${esc(label)}</span></button>`;
  const glink = (label, icon, tone, href, cls = '') => `<a class="gbtn t-${tone} ${cls}" href="${attr(href)}" target="_blank" rel="noopener">${ico(icon)}<span>${esc(label)}</span></a>`;

  // ---------------------------------------------------------------- crypto (unchanged format)
  // Preview mode: a page that defines window.QB_PREVIEW = {password, manifest, files: {path: base64}} runs without a
  // server or ciphertext (dashboard/README.md "Preview"). Production never sets it.
  const PREVIEW = window.QB_PREVIEW || null;
  const Crypto = {
    manifest: null, key: null, pw: null, index: null,
    b64ToBytes(b64) { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; },
    bytesToB64(bytes) { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); },
    async loadManifest() {
      if (PREVIEW) { this.manifest = PREVIEW.manifest; return this.manifest; }
      const r = await fetch('manifest.json?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('manifest.json not found (' + r.status + ')');
      this.manifest = await r.json();
      if (this.manifest.version !== 2 || this.manifest.cipher !== 'AES-256-GCM') throw new Error('unsupported bundle format');
      return this.manifest;
    },
    // the encrypted index: bundle path -> {id, size, type, v}; the public site never lists the paths (C1)
    async loadIndex() {
      if (PREVIEW) { this.index = { files: Object.fromEntries(Object.keys(PREVIEW.files).map(k => [k, { id: k }])) }; return this.index; }
      const idx = JSON.parse(new TextDecoder().decode(await this.decryptRaw('index.enc', Date.now())));
      if (idx.version !== 2 || !idx.files) throw new Error('unsupported index format');
      this.index = idx; return idx;
    },
    entry(path) { return (this.index && this.index.files && this.index.files[path]) || null; },
    has(path) { return !!this.entry(path); },
    async deriveKey(password) {
      if (PREVIEW) { this.pw = password; this.key = 'preview'; return; }
      const m = this.manifest;
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: this.b64ToBytes(m.salt), iterations: m.iterations }, base, 256);
      this.key = await this.importRaw(new Uint8Array(bits));
    },
    importRaw(raw) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['decrypt']); },
    async decryptRaw(name, v) {
      const r = await fetch(name + '?v=' + encodeURIComponent(v || Date.now()), { cache: 'no-store' });
      if (!r.ok) { const e = new Error(`${name} not found (${r.status})`); e.status = r.status; throw e; }
      const buf = new Uint8Array(await r.arrayBuffer());
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, this.key, buf.slice(12));
    },
    async decrypt(path) {
      if (PREVIEW) { const b = PREVIEW.files[path]; if (b == null) throw new Error(path + ' not in the preview'); return this.b64ToBytes(b).buffer; }
      const e = this.entry(path);
      if (!e) { const err = new Error(`${path.split('/').pop()} is not in this bundle`); err.status = 404; throw err; }
      return this.decryptRaw(`d/${e.id}.enc`, e.v);
    },
    async verify() { if (PREVIEW) return this.key === 'preview' && this.pw === (PREVIEW.password || ''); try { return new TextDecoder().decode(await this.decryptRaw('check.enc')) === 'ok'; } catch (e) { return false; } },
    async remember() {
      if (PREVIEW) return;
      try {
        const raw = new Uint8Array(await crypto.subtle.exportKey('raw', this.key));
        sessionStorage.setItem('tracker.key', JSON.stringify({ salt: this.manifest.salt, raw: this.bytesToB64(raw) }));
      } catch (e) { /* private mode: the key lives in memory only */ }
    },
    async restore() {
      if (PREVIEW) return false;
      try {
        const saved = JSON.parse(sessionStorage.getItem('tracker.key') || 'null');
        if (!saved || saved.salt !== this.manifest.salt) return false;
        this.key = await this.importRaw(this.b64ToBytes(saved.raw));
        return await this.verify();
      } catch (e) { return false; }
    },
    forget() { this.key = null; this.index = null; try { sessionStorage.removeItem('tracker.key'); } catch (e) { /* ignore */ } },
  };
  const Docs = {
    cache: new Map(),
    typeOf(path) {
      const m = Crypto.entry(path);
      if (m && m.type) return m.type;
      const ext = path.split('.').pop().toLowerCase();
      return { pdf: 'application/pdf', html: 'text/html', md: 'text/markdown', txt: 'text/plain', json: 'application/json' }[ext] || 'application/octet-stream';
    },
    async get(path) {
      if (this.cache.has(path)) return this.cache.get(path);
      let buf;
      try { buf = await Crypto.decrypt(path); } catch (e) {
        // republished since unlock: the file moved or changed under an old index. Reload the index once and retry.
        if (e.status !== 404 && e.name !== 'OperationError') throw e;
        await Crypto.loadIndex();
        buf = await Crypto.decrypt(path);
      }
      const type = this.typeOf(path);
      // text types carry charset=utf-8, or NEW TAB / DOWNLOAD show "VerÃ¶ffentlicht" (browsers guess Latin-1 for bare text/plain)
      const blob = new Blob([buf], { type: /^text\/|json$/.test(type) ? type + ';charset=utf-8' : type });
      const entry = { url: URL.createObjectURL(blob), type, size: buf.byteLength, text: type.startsWith('text/') || type === 'application/json' ? new TextDecoder().decode(buf) : null };
      this.cache.set(path, entry);
      return entry;
    },
    clear() { this.cache.forEach(e => URL.revokeObjectURL(e.url)); this.cache.clear(); },
  };

  // ---------------------------------------------------------------- state, pending writes, routing
  const State = { raw: null, data: null, secrets: null, sheet: null, tab: 'board', showResult: false, scene: null, globe: null, lockScene: null, mottoTimer: null };
  const Pending = {
    key: 'qb.pending',
    list() { const l = store.get(this.key, []); return Array.isArray(l) ? l : []; },
    save(l) { store.set(this.key, l); },
    add(entry) { const l = this.list(); l.push(Object.assign({ at: new Date().toISOString() }, entry)); this.save(l); },
    clear() { try { localStorage.removeItem(this.key); } catch (e) { /* ignore */ } },
    // A pending write leaves when the bundle lists its cid as processed; a rejected one stays (red, not applied) until the
    // 3-day fallback. Entries without a cid, or a bundle without git history (processed_known false), use the old rule:
    // dropped once the bundle was generated after the write.
    prune() {
      const gen = State.raw && State.raw.generated ? new Date(State.raw.generated).getTime() : 0;
      const cmds = (State.raw && State.raw.commands) || {}, done = new Set(cmds.processed || []);
      const rej = new Map((cmds.rejected || []).map(r => [r.cid, r.error || 'rejected']));
      const job = p => p.op === 'job_add' && p.job && ((State.raw && State.raw.jobs) || []).some(j => j.id === p.job.id);
      const keep = this.list().filter(p => {
        const t = new Date(p.at).getTime();
        if (!(Date.now() - t < 3 * DAY)) return false;
        if (job(p)) return false;
        if (p.cid) { if (rej.has(p.cid)) { p.rejected = rej.get(p.cid); return true; } if (done.has(p.cid)) return false; if (cmds.processed_known) return true; }
        return t > gen;
      });
      this.save(keep); return keep;
    },
  };
  const clone = o => (window.structuredClone ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  function applyPending() {
    // Optimistic view: a command the phone wrote shows as done (SYNCING) until the bundle CI built after it arrives.
    const D = State.data = clone(State.raw);
    D.applications = D.applications || []; D.jobs = D.jobs || []; D.notifications = D.notifications || []; D.instructions = D.instructions || []; D.originals = D.originals || [];
    const apps = D.applications, jobs = D.jobs;
    apps.forEach(a => { a.revisionPending = ['draft', 'ready'].includes(a.status) && ((a.revisions || []).some(r => r.status === 'pending') || a.queue_priority === true); });
    Pending.prune().forEach(p => {
      const a = p.id ? apps.find(x => x.id === p.id) : null;
      if (p.rejected) { const j = p.id ? jobs.find(x => x.id === p.id) : null, t = a || j; if (t) t.cmdRejected = `${p.op}${p.status ? ' ' + p.status : ''}: ${p.rejected}`; return; }
      if (p.op === 'set' && a) { a.status = p.status; a.pending = true; if (p.status === 'applied' && !a.applied) a.applied = isoDay(p.at); if (p.reason) a.outcome_reason = p.reason; a.revisionPending = false; }
      else if (p.op === 'revise' && a) { a.status = 'draft'; a.pending = true; a.revisionPending = true; a.revisionAt = p.at; (a.revisions = a.revisions || []).push({ at: p.at, feedback: p.feedback || '', status: 'pending', pending: true }); }
      else if (p.op === 'reached_out' && a) { a.pending = true; a.outreach = { at: p.at, contact: p.contact || '', pending: true }; }
      else if (p.op === 'notification_read') { for (const id of p.ids || [p.id]) { const n = D.notifications.find(x => x.id === id); if (n) { n.read = true; n.pending = true; } } }
      else if (p.op === 'original_instruction' || p.op === 'general_instruction') D.instructions.unshift({ id: 'pending-' + p.at, ts: p.at, kind: p.op === 'general_instruction' ? 'general' : 'original', scope: p.scope, role: p.role, text: p.text, status: 'pending', pending: true });
      else if (p.op === 'job') { const j = jobs.find(x => x.id === p.id); if (j) { j.pending = true; if (p.status) j.status = p.status; if (p.priority != null) { j.priority = p.priority; if (p.priority) j.hold = false; } if (p.jd) { j.jd_available = true; j.jd_text = j.jd_text || p.jd; } } }
      else if (p.op === 'job_applied') { const j = jobs.find(x => x.id === p.id); if (j) { j.pending = true; j.status = 'applied'; } }
      else if (p.op === 'job_add' && p.job && !jobs.some(x => x.id === p.job.id)) jobs.unshift(Object.assign({ pending: true }, p.job));
    });
  }
  const TABS = [['board', 'Board', 'board'], ['originals', 'Originals', 'scroll'], ['notifications', 'Notifications', 'bell'], ['stats', 'Stats', 'chart']];
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [view, ...rest] = h.split('/');
    const param = rest.length ? decodeURIComponent(rest.join('/')) : null;
    if (!State.data) return;
    if (view === 'app' && param) { openApp(param); return; }
    if (view === 'job' && param) { openJob(param); return; }
    if (view === 'add') { openAdd(); return; }
    closeSheet(false);
    showTab(TABS.some(t => t[0] === view) ? view : 'board');
  }
  const go = h => { if (location.hash !== h) location.hash = h; else route(); };
  const tabHash = () => State.tab === 'board' ? '#/' : '#/' + State.tab;

  // ---------------------------------------------------------------- derived state
  const excludedApp = a => a.excluded_from_insights === true || INSIGHT_EXCLUDED.includes(a.outcome_reason);
  const firstApplied = a => (a.history || []).findIndex(h => h.status === 'applied' && !h.event);
  function replied(a) {
    const i = firstApplied(a); if (i < 0) return false;
    return a.history.slice(i + 1).some(h => !h.event && !EXCLUDED.includes(h.reason) && (h.email || ['assessment', 'interview', 'offer', 'rejected'].includes(h.status)));
  }
  const reachedBoss = a => (a.history || []).some(h => ['assessment', 'interview', 'offer'].includes(h.status)) || ['assessment', 'interview', 'offer'].includes(a.status);
  const reachedOffer = a => a.status === 'offer' || (a.history || []).some(h => h.status === 'offer');
  function laneOf(a) {
    if (a.revisionPending) return 'queue';
    switch (a.status) {
      case 'draft': case 'ready': return 'ready';
      case 'applied': case 'acknowledged': return 'applied';
      case 'assessment': case 'interview': return 'boss';
      default: return 'result';
    }
  }
  function streak() {
    const days = new Set(), apps = State.data.applications;
    apps.forEach(a => {
      const i = firstApplied(a); if (i >= 0) days.add(isoDay(a.history[i].date));
      (a.history || []).forEach(h => { if (h.event === 'outreach' || /follow[- ]?up/i.test(h.note || '')) days.add(isoDay(h.date)); });
      (a.revisions || []).forEach(r => days.add(isoDay(r.at)));
      if (a.outreach && a.outreach.at) days.add(isoDay(a.outreach.at));
    });
    State.data.jobs.forEach(j => { if (j.queued_at) days.add(isoDay(j.queued_at)); });
    const local = new Set([...days].map(d => d));
    let n = 0; const d = today(); if (!local.has(ymd(d))) d.setDate(d.getDate() - 1);
    while (local.has(ymd(d)) && n < 400) { n++; d.setDate(d.getDate() - 1); }
    return { n, today: local.has(todayIso()) };
  }
  const JOURNEY = [['BLR', 'Bangalore'], ['SENT', 'first send'], ['REPLY', 'a human replied'], ['BOSS', 'assessment or interview'], ['OFFER', 'an offer'], ['EUROPE', 'visa, flight, new city']];
  function journey() {
    const apps = State.data.applications.filter(a => !excludedApp(a));
    let lvl = 0;
    if (State.data.applications.some(a => a.applied)) lvl = 1;
    if (apps.some(replied)) lvl = 2;
    if (apps.some(reachedBoss)) lvl = 3;
    if (apps.some(reachedOffer)) lvl = 4;
    return lvl;
  }

  // ---------------------------------------------------------------- hero, HUD
  function renderHero() {
    const D = State.data, apps = D.applications, cand = D.candidate || {};
    const sample = /sample/i.test(cand.note || '');
    $('#sample').hidden = !sample;
    $('#topright').textContent = `· ${(cand.name || '').split(' ')[0].toUpperCase()} · ${fmtStamp(D.generated)}`;
    $('#top-acts').innerHTML = gbtn('+ Job', 'add', 'lime', 'data-add', 'sm') + gbtn('Lock', 'lock', 'stone', 'data-lock', 'sm');
    const sent = apps.filter(a => a.applied), countries = {};
    sent.forEach(a => { countries[a.country] = (countries[a.country] || 0) + 1; });
    const offers = [...new Set(apps.filter(a => a.status === 'offer').map(a => a.country))];
    $('#globe-cap').textContent = `${Object.keys(countries).length} countries lit · ${plural(sent.length, 'flight')}${offers.length ? ' · landed: ' + offers.join(', ') : ''}`;
    if (State.globe) State.globe.stop();
    if (window.Art) State.globe = Art.globe($('#globe'), { dest: countries, offers });
    // HUD: journey, streak, counts
    const lvl = journey(), st = streak();
    const open = apps.filter(a => laneOf(a) !== 'result').length, ready = apps.filter(a => laneOf(a) === 'ready').length;
    const boss = apps.filter(a => laneOf(a) === 'boss').length, offerN = apps.filter(a => a.status === 'offer').length;
    const tier = st.n === 0 ? 'ember' : st.n < 3 ? 'small' : st.n < 7 ? 'mid' : 'big';
    $('#hud').innerHTML = `
      <div class="tile journey frame" aria-label="Journey: ${attr(JOURNEY[lvl][0])}">
        <span class="lbl">Journey · Bangalore to Europe</span>
        <ol class="track">${JOURNEY.map(([k, t], i) => `<li class="${i < lvl ? 'done' : i === lvl ? 'here' : ''}" title="${attr(t)}"><span class="node">${i === lvl ? sprite(PLANE, { x: '#ffffff' }, 'plane', 2) : ''}</span><span class="k">${k}</span></li>`).join('')}</ol>
      </div>
      <div class="tile streak frame ${tier}"><span class="lbl">Streak</span>
        <span class="flame-wrap" aria-hidden="true">${sprite(FLAME[0], FLAME_PAL, 'flame f1', 3)}${sprite(FLAME[1], FLAME_PAL, 'flame f2', 3)}</span>
        <span class="num">${st.n}<small>${st.n === 1 ? 'day' : 'days'}</small></span>
        <span class="lbl muted">${st.n ? (st.today ? 'lit today' : 'act today to keep it') : 'send something to light it'}</span></div>
      <div class="tile frame"><span class="lbl">Open</span><span class="num">${open}</span><span class="lbl muted">${ready} ready to send</span></div>
      <div class="tile frame"><span class="lbl">Boss fights</span><span class="num amber">${boss}</span><span class="lbl muted">${offerN ? plural(offerN, 'offer') : 'no offer yet'}</span></div>
      <div class="tile frame skyline"><span class="lbl">Skyline</span><span class="num">${apps.length}</span><span class="lbl muted">${apps.length === 1 ? 'building' : 'buildings'}, one per application</span></div>`;
    // the rotating line from the encrypted bundle
    const lines = (D.motivation && D.motivation.lines) || [];
    clearInterval(State.mottoTimer);
    const m = $('#motto'); let i = Math.floor(Date.now() / 86400000) % Math.max(1, lines.length);
    const show = () => { if (!lines.length) { m.textContent = ''; return; } m.classList.remove('in'); void m.offsetWidth; m.textContent = lines[i % lines.length]; m.classList.add('in'); i++; };
    show(); if (lines.length > 1) State.mottoTimer = setInterval(show, 9000);
  }
  function buildScene() {
    if (!window.Art) return;
    const apps = State.data.applications.slice().sort(by(a => a.created || a.applied || ''));
    if (State.scene) State.scene.destroy();
    State.scene = Art.scene($('#scene'), { buildings: apps.map(a => ({ id: a.id, offer: a.status === 'offer', boss: ['assessment', 'interview'].includes(a.status) })) });
  }

  // "since your last visit": a per-viewer snapshot in localStorage (wrapped; the page works without it)
  // ids are stored hashed: no company name sits in plaintext storage after LOCK
  const hid = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  function sinceLastVisit() {
    const D = State.data, prev = store.get('qb.lastVisit', null);
    const snap = { v: 2, at: new Date().toISOString(), apps: {}, notes: D.notifications.map(n => hid(n.id)), jobs: D.jobs.filter(j => ['new', 'queued'].includes(j.status)).map(j => hid(j.id)) };
    D.applications.forEach(a => { snap.apps[hid(a.id)] = laneOf(a) + ':' + a.status; });
    store.set('qb.lastVisit', snap);
    const box = $('#since');
    if (!prev || prev.v !== 2 || !prev.apps) { box.hidden = true; return; }
    const items = [], laneName = { queue: 'QUEUE', ready: 'READY', applied: 'APPLIED', boss: 'BOSS FIGHT', result: 'RESULT' };
    D.applications.forEach(a => {
      const was = prev.apps[hid(a.id)], now = snap.apps[hid(a.id)];
      if (!was) items.push([`${a.company} forged`, laneName[laneOf(a)], a]);
      else if (was !== now) items.push([`${a.company}: ${was.split(':')[1]} → ${a.status}`, laneName[laneOf(a)], a]);
    });
    const newJobs = snap.jobs.filter(id => !(prev.jobs || []).includes(id)).length;
    const newNotes = snap.notes.filter(id => !(prev.notes || []).includes(id)).length;
    if (!items.length && !newJobs && !newNotes) { box.hidden = true; return; }
    const ago = daysSince(prev.at);
    box.innerHTML = `<div class="since-head"><span class="lbl">Since your last visit · ${ago === 0 ? 'earlier today' : ago === 1 ? 'yesterday' : ago + ' days ago'}</span>${gbtn('Got it', 'check', 'stone', 'data-since-close', 'sm')}</div>
      <ul>${items.slice(0, 6).map(([t, l, a]) => `<li><a href="#/app/${encodeURIComponent(a.id)}">${flag(a.country)} ${esc(t)}</a> <span class="pill">${esc(l)}</span></li>`).join('')}
      ${items.length > 6 ? `<li class="muted">+ ${items.length - 6} more</li>` : ''}
      ${newJobs ? `<li>${ico('hourglass')} ${plural(newJobs, 'new job')} in the queue</li>` : ''}${newNotes ? `<li>${ico('bell')} ${plural(newNotes, 'new notification')}</li>` : ''}</ul>`;
    box.hidden = false;
  }

  // ---------------------------------------------------------------- tabs
  function renderTabs() {
    const unread = State.data.notifications.filter(n => !n.read).length;
    $('#tabs').innerHTML = TABS.map(([id, label, icon]) => `<button type="button" role="tab" class="tab gbtn t-stone" id="tab-${id}" data-tab="${id}" aria-selected="${State.tab === id}" aria-controls="view-${id}">${ico(icon)}<span class="tl">${label}</span>${id === 'notifications' && unread ? `<b class="badge" aria-label="${unread} unread">${unread}</b>` : ''}</button>`).join('');
  }
  function showTab(id) {
    State.tab = id;
    TABS.forEach(([t]) => { const v = $('#view-' + t); if (v) v.hidden = t !== id; });
    $$('#tabs .tab').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === id));
    if (id === 'originals') renderOriginals();
    else if (id === 'notifications') renderNotifications();
    else if (id === 'stats') renderStats();
    const v = $('#view-' + id);
    if (v && window.Motion && Motion.animate && !(window.Art && Art.reducedMotion)) Motion.animate(v, { opacity: [0, 1], transform: ['translateY(8px)', 'translateY(0)'] }, { duration: .25 });
  }

  // ---------------------------------------------------------------- health (H2): the worker and main, live
  // data.health comes from CI (scripts/dashboard.py); running / paused are recomputed against the viewer's clock.
  function workerState() {
    const H = State.data.health || {}, w = H.worker || {}, c = Object.assign({ in_flight_minutes: 90, max_strikes: 2, backoff_hours: 6, quiet_minutes: 30 }, H.dispatch_config || ((State.data.config || {}).dispatch) || {});
    const t = s => { const d = s ? new Date(s).getTime() : NaN; return isNaN(d) ? null : d; };
    const fired = t(w.worker_fired_at), fin = t(w.worker_finished_at), now = Date.now(), strikes = w.worker_strikes || 0;
    const suite = (H.suite || {}).status || 'unknown';
    const st = { suite, failing: (H.suite || {}).failing || [], runUrl: (H.suite || {}).run_url, configured: H.worker_configured, quiet: c.quiet_minutes,
      blocked: w.worker_blocked || '', fireError: w.last_fire_error || '', stuck: Array.isArray(w.stuck_ids) ? w.stuck_ids : Object.keys(w.stuck_ids || {}), dispatch: H.dispatch || '', fired: w.worker_fired_at, strikes };
    st.running = !!(fired && (!fin || fin < fired) && now - fired < c.in_flight_minutes * 60000);
    st.paused = !!(strikes >= c.max_strikes && fired && now - fired < c.backoff_hours * 3600000);
    st.pausedUntil = st.paused ? new Date(fired + c.backoff_hours * 3600000).toISOString() : null;
    st.kind = suite === 'failed' ? 'red' : st.configured === false ? 'unconfigured' : st.paused ? 'paused' : st.running ? 'running' : 'idle';
    return st;
  }
  function workerLine(short) {   // the one sentence about when the queue moves (live from health, L2)
    const w = workerState();
    if (w.kind === 'red') return short ? 'main is red — nothing tailored until fixed' : `main is red${w.failing.length ? ': ' + w.failing[0] : ''} — nothing new is tailored until fixed`;
    if (w.kind === 'unconfigured') return short ? 'Worker not configured' : 'Worker not configured (WORKER_FIRE_URL / WORKER_FIRE_TOKEN): nothing is tailored automatically';
    if (w.kind === 'paused') return short ? `Worker paused (${w.strikes} failed runs)` : `Worker paused (${w.strikes} failed runs)${w.blocked ? ': ' + w.blocked : ''} · retries after ${fmtStamp(w.pausedUntil)}`;
    if (w.kind === 'running') return `Worker running since ${fmtStamp(w.fired)}`;
    return short ? `Worker idle — starts ~${w.quiet || 30} min after the last change` : `Worker idle — starts within ~${w.quiet || 30} min of the last change`;
  }
  function renderHealth() {
    const box = $('#health'); if (!box) return;
    const w = workerState(), tone = { red: 'bad', unconfigured: 'bad', paused: 'warn', running: 'run', idle: 'idle' }[w.kind];
    const extra = [];
    if (w.kind === 'red' && w.failing.length > 1) extra.push('also failing: ' + w.failing.slice(1).join(', '));
    if (w.fireError) extra.push('last fire error: ' + w.fireError);
    if (w.stuck.length) extra.push('stuck: ' + w.stuck.join(', '));
    if (w.dispatch) extra.push('dispatcher: ' + w.dispatch);
    box.className = 'health frame h-' + tone;
    box.innerHTML = `<span class="h-ico">${ico(w.kind === 'red' || w.kind === 'unconfigured' ? 'warn' : w.kind === 'paused' ? 'hourglass' : w.kind === 'running' ? 'hammer' : 'info')}</span>
      <div class="h-body"><b>${esc(workerLine(false))}</b>${extra.length ? `<div class="muted small">${esc(extra.join(' · '))}</div>` : ''}</div>
      ${w.runUrl && w.kind === 'red' ? glink('CI run', 'link', 'stone', w.runUrl, 'sm') : ''}`;
    box.hidden = false;
  }
  const maxAttempts = () => (State.data.health || {}).worker_max_attempts ?? ((State.data.config || {}).worker_max_attempts ?? 2);
  const parked = j => (j.worker_attempts || 0) >= maxAttempts() && ['new', 'queued'].includes(j.status);
  const closedReason = j => /^stale-cleanup/.test(j.reason || '') ? 'closed in the October board reset (old, unsent)'
    : (j.dismissed_via === 'you' ? 'dismissed by you: ' : '') + (j.dismissed_reason || j.reason || j.status);
  // Discarded by the routine (worker scoring, hard filters, auto rules), not by the user: shown apart, collapsed, with
  // FORGE ANYWAY (priority: tailored whatever the fit, never discarded again). The stale cleanup is history, not a decision.
  const byRoutine = j => j.status === 'dismissed' && j.dismissed_via !== 'you' && j.dismissed_via !== 'cleanup' && !/^stale-cleanup/.test(j.reason || '');
  function renderDiscarded() {
    const box = $('#discarded-jobs'); if (!box) return;
    const list = State.data.jobs.filter(byRoutine).sort(by(j => j.dismissed || j.found || '', -1));
    const open = box.querySelector('details') && box.querySelector('details').open;
    box.innerHTML = list.length ? `<details class="closed frame"${open ? ' open' : ''}><summary>${ico('close')} Discarded by the routine <span class="muted">${list.length} · tap one to see why</span></summary>
      <ul class="closed-list">${list.map(j => `<li><button type="button" class="closed-row" data-job="${attr(j.id)}">${flag(j.country)} <b>${esc(j.company || host(j.url) || j.id)}</b> <span class="muted">${esc(j.title || '')}</span>
        ${j.fit != null ? `<span class="tag">fit ${esc(String(j.fit))}</span>` : ''}${j.pending ? '<span class="tag sync">SYNCING</span>' : ''}${j.cmdRejected ? `<span class="tag bad">rejected: ${esc(j.cmdRejected)}</span>` : ''}
        <span class="why bad-text">${esc(String(j.reason || 'no reason recorded').slice(0, 160))}</span></button>
        ${gbtn('Forge anyway', 'hammer', 'gold', `data-forge-anyway="${attr(j.id)}" ${dis()}`, 'sm')}</li>`).join('')}</ul></details>` : '';
  }
  function renderClosedJobs() {
    renderDiscarded();
    const box = $('#closed-jobs'); if (!box) return;
    const list = State.data.jobs.filter(j => !byRoutine(j) && ['dismissed', 'expired'].includes(j.status))
      .sort(by(j => j.dismissed || j.found || '', -1));
    const open = box.querySelector('details') && box.querySelector('details').open;
    box.innerHTML = list.length ? `<details class="closed frame"${open ? ' open' : ''}><summary>${ico('scroll')} Closed jobs <span class="muted">${list.length} · dismissed by you, expired</span></summary>
      <ul class="closed-list">${list.map(j => `<li><button type="button" class="closed-row" data-job="${attr(j.id)}">${flag(j.country)} <b>${esc(j.company || host(j.url) || j.id)}</b> <span class="muted">${esc(j.title || '')}</span>
        <span class="tag ${j.status === 'applied' ? '' : 'bad'}">${esc(j.status.toUpperCase())}</span>${j.pending ? '<span class="tag sync">SYNCING</span>' : ''}${j.cmdRejected ? `<span class="tag bad">rejected: ${esc(j.cmdRejected)}</span>` : ''}
        <span class="why">${esc(String(closedReason(j)).slice(0, 140))}</span></button>
        ${j.status !== 'applied' ? gbtn('Back to queue', 'revise', 'gold', `data-unclose="${attr(j.id)}" ${dis()}`, 'sm') : ''}</li>`).join('')}</ul></details>` : '';
  }

  // ---------------------------------------------------------------- the board
  const LANES = [
    { id: 'queue', label: 'Queue', sub: 'worker · revisions first', live: true, icon: 'hourglass', hint: 'Nothing queued. Add a job with + JOB.' },
    { id: 'ready', label: 'Ready', sub: 'forged · review and send', icon: 'chest', hint: 'Forged resumes land here.' },
    { id: 'applied', label: 'Applied', sub: 'sent · message the recruiter', icon: 'send', hint: 'Sent applications wait here for a reply.' },
    { id: 'boss', label: 'Boss fight', sub: 'assessments · interviews', icon: 'knight', hint: 'No boss yet. Every interview starts as a send.' },
    { id: 'result', label: 'Result', sub: 'offers · rejections · closed', icon: 'trophy', hint: 'Outcomes land here.' },
  ];
  const contactLine = a => { const c = (a.contacts || [])[0]; return c ? `<div class="who">${ico('mail')} ${esc(c.name)}${c.email ? ' · ' + esc(c.email) : c.title ? ' · ' + esc(c.title) : ''}</div>` : ''; };
  function appCard(a, i) {
    const s = a.scores || {}, lane = laneOf(a), last = (a.history || []).slice(-1)[0] || {};
    const sync = (a.pending ? '<span class="tag sync">SYNCING</span>' : '') + (a.cmdRejected ? `<span class="tag bad cmd-rej" title="${attr(a.cmdRejected)}">rejected: ${esc(a.cmdRejected.slice(0, 60))}</span>` : '');
    const pips = s.shortlist != null ? `<span class="pips" title="shortlist ${num(s.shortlist, 1)}/10">${Array.from({ length: 5 }, (_, k) => `<i class="${k < Math.round(s.shortlist / 2) ? 'on' : ''}"></i>`).join('')}</span>` : '<span class="tag">UNSCORED</span>';
    let cls = '', badge = '', line = '';
    if (lane === 'queue') { const r = (a.revisions || []).filter(x => x.status === 'pending').slice(-1)[0] || {}; badge = '<span class="tag gold">REVISION</span>'; line = esc((r.feedback || 'revision requested').slice(0, 70)); cls = 'rev'; }
    else if (lane === 'ready') { badge = a.status === 'draft' ? '<span class="tag warn">DRAFT</span>' : '<span class="new">NEW LOOT</span>'; line = pips + (s.band ? ` <span class="tag">${esc(s.band)}</span>` : ''); cls = a.status === 'ready' ? 'ready' : ''; }
    else if (lane === 'applied') { line = `${daysSince(a.applied) ?? '?'} d since sent`; if (a.outreach) cls = 'outreach'; }
    else if (lane === 'boss') { line = esc((last.note || a.status).slice(0, 48)); badge = `<span class="tag amber">${esc(a.status.toUpperCase())}</span>`; }
    else { const off = a.status === 'offer', why = a.outcome_reason; cls = off ? 'win' : 'lost'; badge = off ? '<span class="tag pass">OFFER</span>' : `<span class="tag bad">${esc(a.status.toUpperCase())}</span>`;
      line = off ? esc((last.note || 'offer').slice(0, 48)) : esc(why ? (REASON_TEXT[why] || why) : (last.note || 'no reason recorded')).slice(0, 60); }
    return `<button class="card ${cls}" style="--i:${i}" type="button" data-app="${attr(a.id)}">
      ${cls === 'outreach' ? '<span class="ribbon">contacted</span>' : ''}
      <div class="r1">${flag(a.country)}<span class="co">${esc(a.company)}</span>${badge}</div>
      <div class="ttl">${esc(a.title || roleLabel(a.role))}</div>
      ${contactLine(a)}
      <div class="r3"><span class="line">${line}</span>${sync}${cls === 'outreach' ? `<span class="beacon" title="recruiter contacted">${ico('beacon')}</span>` : ''}</div></button>`;
  }
  function jobCard(j, i) {
    const floor = (State.data.config || {}).auto_apply_min_fit ?? 6, name = j.company || host(j.url) || 'job';
    const isParked = parked(j);
    const state = (j.pending ? '<span class="tag sync">SYNCING</span>' : isParked ? '<span class="tag bad">PARKED</span>' : j.hold ? '<span class="tag bad">HELD</span>' : j.priority ? '<span class="tag gold">FIRST</span>' : '')
      + (j.cmdRejected ? `<span class="tag bad cmd-rej" title="${attr(j.cmdRejected)}">rejected: ${esc(j.cmdRejected.slice(0, 60))}</span>` : '');
    const left = isParked ? `<span class="bad-text">parked after ${j.worker_attempts} attempts${j.blocked_reason ? ': ' + esc(j.blocked_reason.slice(0, 60)) : ''}</span>`
      : j.hold && j.status === 'new' ? '<span class="bad-text">hard filter: forge anyway?</span>'
      : j.status === 'queued' ? '<span class="forge">forging</span>'
      : j.jd_available === false ? '<span class="bad-text">JD fetch failed: paste the JD</span>'
      : !j.jd_text && !j.jd_available ? 'CI fetches the JD'
      : (j.fit || 0) < floor && !j.priority ? `fit ${j.fit ?? '?'}: waits for you` : esc(workerLine(true));
    return `<button class="card job" style="--i:${i}" type="button" data-job="${attr(j.id)}">
      <div class="r1">${flag(j.country)}<span class="co">${esc(name)}</span><span class="tag fit">FIT ${j.fit ?? '?'}</span></div>
      <div class="ttl">${esc(j.title || j.url)}</div>
      <div class="r3"><span class="line">${left}</span>${state}</div></button>`;
  }
  function laneItems() {
    const apps = State.data.applications, jobs = State.data.jobs, items = {};
    const revs = apps.filter(a => laneOf(a) === 'queue').sort(by(a => -new Date(a.revisionAt || ((a.revisions || []).slice(-1)[0] || {}).at || 0).getTime()));
    const queue = jobs.filter(j => ['new', 'queued'].includes(j.status)).sort(by(j => [j.priority ? 0 : 1, -(j.fit ?? 0), j.found || ''].join('|')));
    queue.sort((x, y) => (y.priority ? 1 : 0) - (x.priority ? 1 : 0) || (y.fit ?? -1) - (x.fit ?? -1) || String(x.found || '').localeCompare(String(y.found || '')));
    items.queue = revs.map((a, i) => appCard(a, i)).concat(queue.map((j, i) => jobCard(j, i + revs.length)));
    const lastDate = a => (a.history || []).slice(-1)[0]?.date || a.applied || a.created || '';
    ['ready', 'applied', 'boss'].forEach(l => { items[l] = apps.filter(a => laneOf(a) === l).sort(by(lastDate, -1)).map(appCard); });
    const res = apps.filter(a => laneOf(a) === 'result').sort((x, y) => (y.status === 'offer') - (x.status === 'offer') || lastDate(y).localeCompare(lastDate(x)));
    items.resultCount = res.length;
    items.result = res.map(appCard);
    if (res.length > 6 && !State.showResult) items.result = items.result.slice(0, 6).concat([gbtn(`Show all ${res.length}`, 'scroll', 'stone', 'data-result-all', 'wide')]);
    return items;
  }
  function renderBoard() {
    const items = laneItems(), count = id => id === 'result' ? items.resultCount : items[id].length;
    $('#lane-strip').innerHTML = LANES.map(l => `<button type="button" class="chip-btn" data-lane="${l.id}">${esc(l.label)} <b>${count(l.id)}</b></button>`).join('');
    $('#board').innerHTML = LANES.map(l => `<section class="lane lane-${l.id}" id="lane-${l.id}" aria-label="${attr(l.label)}">
        <header class="lane-head frame">${l.icon === 'knight' ? sprite(KNIGHT, KNIGHT_PAL, 'knight', 2) : ico(l.icon, 'lane-ico')}<div><div class="lane-name">${esc(l.label)}</div><div class="sub">${esc(l.live ? workerLine(true) : l.sub)}</div></div><span class="num">${String(count(l.id)).padStart(2, '0')}</span></header>
        <div class="cards">${items[l.id].length ? items[l.id].join('') : `<div class="lane-empty">${esc(l.hint)}</div>`}</div></section>`).join('');
    const w = State.data.write || {};
    renderHealth(); renderClosedJobs();
    $('#foot').textContent = `encrypted bundle · built ${fmtStamp(State.data.generated)} · ${State.secrets ? 'writes go to ' + w.repo : 'read-only (no write token in this bundle)'} · bands are estimates until calibrated`;
  }
  function scrollToLane(id, smooth) {
    const b = $('#board'), l = $('#lane-' + id); if (!b || !l) return;
    const left = l.getBoundingClientRect().left - b.getBoundingClientRect().left + b.scrollLeft;
    b.scrollTo({ left, behavior: smooth && !(window.Art && Art.reducedMotion) ? 'smooth' : 'auto' });
  }
  function renderAll() { applyPending(); renderHero(); renderTabs(); renderBoard(); if (State.tab !== 'board') showTab(State.tab); }

  // ---------------------------------------------------------------- ORIGINALS
  function renderOriginals() {
    const D = State.data, list = D.originals.slice().sort(by(o => `${o.country === 'Global' ? 'A' : 'B'}${o.country}${o.role}${o.lang}`));
    const insts = D.instructions;
    $('#view-originals').innerHTML = `
      <div class="frame panel general">
        <h2 class="h">${ico('scroll')} Instructions for the worker</h2>
        <p class="hint">An instruction to every Original goes through the normal change flow (facts → Global master → measure → every Original). A general instruction is anything else the worker should know.</p>
        <div class="field"><label for="gen-text">General instruction</label><textarea id="gen-text" rows="2" maxlength="4000" placeholder="e.g. skip roles that need German above B1" ${canWrite() ? '' : 'disabled'}></textarea></div>
        <div class="row-acts">${gbtn('Send to the worker', 'send', 'violet', `data-general ${canWrite() ? '' : 'disabled'}`)}</div>
        ${writeHint()}
        ${insts.length ? `<ul class="insts">${insts.slice(0, 8).map(n => `<li><span class="tag ${n.status === 'done' ? 'pass' : 'gold'}">${esc((n.status || 'pending').toUpperCase())}</span>${n.pending ? '<span class="tag sync">SYNCING</span>' : ''} <b>${esc(n.kind === 'general' ? 'general' : `${n.scope === 'all' ? 'all countries' : n.scope} · ${roleLabel(n.role)}`)}</b> <span class="muted">${esc(fmtStamp(n.ts))}</span><div>${esc(n.text)}</div></li>`).join('')}</ul>` : ''}
      </div>
      <div class="orig-grid">${list.length ? list.map(origCard).join('') : '<p class="hint">No Originals in this bundle.</p>'}</div>`;
  }
  function origCard(o, i) {
    const ats = o.ats || null, scr = o.screening || null, sc = (scr && scr.scores) || {}, key = `${o.country}|${o.role}|${o.lang}`;
    const shortlist = sc.shortlist ?? null, verdict = scr && scr.verdict;
    const vcls = !verdict ? '' : /STRONG YES|^YES/.test(verdict) ? 'pass' : /BORDER/.test(verdict) ? 'gold' : 'bad';
    return `<article class="orig frame" style="--i:${i}" data-orig="${attr(key)}">
      <header class="orig-head">${flag(o.country, 'big')}<div><div class="co">${esc(o.country)}</div><div class="ttl">${esc(roleLabel(o.role))} · ${esc(o.lang)}</div></div></header>
      <div class="kv"><span class="k">Market ATS</span><span class="v">${ats && ats.mean_ats_pct != null ? num(ats.mean_ats_pct, 1) + '%' : '–'}</span><span class="muted">${ats && ats.jd_count ? `over ${plural(ats.jd_count, 'JD')}` : 'not measured'}</span></div>
      ${ats && ats.mean_ats_pct != null ? `<div class="meter-bar" title="mean ATS ${num(ats.mean_ats_pct, 1)}%"><i style="width:${Math.min(100, ats.mean_ats_pct)}%"></i></div>` : ''}
      <div class="kv"><span class="k">Shortlist</span><span class="v">${shortlist != null ? num(shortlist, 1) + '<small>/10</small>' : '–'}</span>${verdict ? `<span class="tag ${vcls}">${esc(verdict)}</span>` : '<span class="muted">not screened</span>'}</div>
      ${ats && (ats.missing || []).length ? `<div class="miss-list"><span class="k">What is missing</span><div class="chips">${ats.missing.slice(0, 6).map(m => `<span class="chip" title="in ${m.jds ?? '?'} of ${ats.jd_count ?? '?'} JDs">${esc(m.term)} <b>${m.share_pct != null ? m.share_pct + '%' : ''}</b></span>`).join('')}</div></div>` : ''}
      <div class="row-acts">${o.report ? gbtn('Report', 'chart', 'cyan', `data-odoc="${attr(o.report)}" data-okind="report" data-otitle="${attr(o.country + ' · ' + o.lang)}"`, 'sm') : ''}${o.pdf ? gbtn('PDF', 'doc', 'stone', `data-odoc="${attr(o.pdf)}" data-okind="resume" data-otitle="${attr(o.country + ' · ' + o.lang)}"`, 'sm') : ''}</div>
      <div class="field"><label>Instruction for this Original</label><textarea class="oi-text" rows="2" maxlength="4000" placeholder="what should change" ${canWrite() ? '' : 'disabled'}></textarea></div>
      <div class="row-acts">${gbtn('This country', 'pin', 'violet', `data-oi="country" ${canWrite() ? '' : 'disabled'}`, 'sm')}${gbtn('All countries', 'globe', 'violet', `data-oi="all" ${canWrite() ? '' : 'disabled'}`, 'sm')}</div>
    </article>`;
  }

  // ---------------------------------------------------------------- NOTIFICATIONS
  function renderNotifications() {
    const list = State.data.notifications, unread = list.filter(n => !n.read).length;
    const lv = { info: ['info', 'cyan'], action: ['star', 'lime'], warn: ['warn', 'red'] };
    $('#view-notifications').innerHTML = `<div class="frame panel"><h2 class="h">${ico('bell')} Notifications <span class="muted">${unread} unread of ${list.length}</span>${unread ? gbtn('Mark all as read', 'check', 'lime', `data-read-all ${canWrite() ? '' : 'disabled'}`, 'sm') : ''}</h2>${writeHint()}
      ${list.length ? `<ul class="notes">${list.map(n => { const [ic, tone] = lv[n.level] || lv.info; return `<li class="note ${n.read ? 'read' : 'unread'} lv-${esc(n.level || 'info')}" data-note="${attr(n.id)}">
        <span class="lv t-${tone}">${ico(ic)}</span>
        <div class="nb"><div class="nt">${esc(n.title)}</div><div class="muted small">${esc(fmtStamp(n.ts))} · ${esc(n.level || 'info')}</div>${n.body ? `<p>${esc(n.body)}</p>` : ''}</div>
        <div class="na">${n.link ? glink('Open', 'link', 'stone', n.link, 'sm') : ''}${n.pending ? '<span class="tag sync">SYNCING</span>' : ''}${n.read ? '<span class="tag">READ</span>' : gbtn('Mark read', 'check', 'lime', `data-read="${attr(n.id)}" ${canWrite() ? '' : 'disabled'}`, 'sm')}</div></li>`; }).join('')}</ul>` : '<p class="hint">No notifications.</p>'}</div>`;
  }

  // ---------------------------------------------------------------- STATS (dataviz: one hue per single-series chart, text in ink, tooltips, a table under each chart)
  function hbarChart(rows, opts = {}) {   // rows: [{label, value, html?, note?}]
    const max = Math.max(1, ...rows.map(r => r.value));
    return `<div class="hbars" role="img" aria-label="${attr(opts.aria || '')}">${rows.map(r => `<div class="hb" data-tip="${attr(`${r.label}: ${r.value}${r.note ? ' · ' + r.note : ''}`)}">
      <span class="hl">${r.html || esc(r.label)}</span><span class="track"><i style="width:${(100 * r.value / max).toFixed(1)}%;${r.color ? 'background:' + r.color : ''}"></i></span><span class="hv">${r.value}${r.note ? ` <small>${esc(r.note)}</small>` : ''}</span></div>`).join('')}</div>`;
  }
  function vbarChart(cols, opts = {}) {   // cols: [{label, value}]
    const W = 320, H = 150, padL = 22, padB = 22, padT = 14, n = Math.max(1, cols.length), max = Math.max(1, ...cols.map(c => c.value));
    const gw = (W - padL) / n, bw = Math.max(4, Math.min(26, gw - 4)); let out = '';
    const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
    ticks.forEach(t => { const y = padT + (H - padT - padB) * (1 - t / max); out += `<line x1="${padL}" x2="${W}" y1="${y}" y2="${y}" class="gl"/><text x="${padL - 5}" y="${y + 3}" text-anchor="end">${t}</text>`; });
    const maxI = cols.reduce((m, c, i) => c.value > cols[m].value ? i : m, 0);
    cols.forEach((c, i) => {
      const h = Math.round((H - padT - padB) * c.value / max), x = padL + i * gw + (gw - bw) / 2, y = H - padB - h;
      out += `<rect class="bar" x="${x}" y="${y}" width="${bw}" height="${Math.max(0, h)}" fill="var(--series-1)" data-tip="${attr(`${c.label}: ${c.value}`)}"/>`;
      out += `<rect x="${padL + i * gw}" y="${padT}" width="${gw}" height="${H - padT - padB}" fill="transparent" data-tip="${attr(`${c.label}: ${c.value}`)}"/>`;
      if (c.value && (i === maxI || i === n - 1)) out += `<text class="val" x="${x + bw / 2}" y="${y - 4}" text-anchor="middle">${c.value}</text>`;
      if (n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1) out += `<text x="${padL + i * gw + gw / 2}" y="${H - 7}" text-anchor="middle">${esc(c.label)}</text>`;
    });
    out += `<line x1="${padL}" x2="${W}" y1="${H - padB}" y2="${H - padB}" class="axis"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${attr(opts.aria || '')}">${out}</svg>`;
  }
  const table = (head, rows) => `<details class="tbl"><summary>Table</summary><table><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></details>`;
  const chart = (id, title, sub, body, tbl = '') => `<figure class="chart frame" id="chart-${id}"><figcaption><h3>${title}</h3><p class="sub">${sub}</p></figcaption>${body}${tbl}</figure>`;
  function renderStats() {
    const apps = State.data.applications, basis = apps.filter(a => !excludedApp(a)), excluded = apps.filter(excludedApp);
    const sent = basis.filter(a => a.applied), rep = sent.filter(replied), boss = sent.filter(reachedBoss), off = sent.filter(reachedOffer);
    const few = sent.length < 40;
    const funnel = [['Applied', sent.length], ['Reply', rep.length], ['Boss fight', boss.length], ['Offer', off.length]];
    const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
    const ORD = ['#c8ff5a', '#a6dc45', '#84b834', '#649426'];
    // weekly sends: every sent application (closed ones included: this measures effort, not outcomes)
    const weeksMap = {}; apps.filter(a => a.applied).forEach(a => { const d = parseDay(a.applied); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = ymd(d); weeksMap[k] = (weeksMap[k] || 0) + 1; });
    const wk = Object.keys(weeksMap).sort(), weeks = [];
    if (wk.length) { const d = parseDay(wk[0]), end = parseDay(wk[wk.length - 1]); while (d <= end) { weeks.push({ label: fmtDay(ymd(d)), value: weeksMap[ymd(d)] || 0 }); d.setDate(d.getDate() + 7); } }
    const wkShown = weeks.slice(-12);
    const reasons = {}; basis.filter(a => ['rejected', 'withdrawn'].includes(a.status)).forEach(a => { const r = REASON_TEXT[a.outcome_reason] || a.outcome_reason || 'no reason recorded'; reasons[r] = (reasons[r] || 0) + 1; });
    const reasonRows = Object.entries(reasons).sort(by(([, v]) => -v)).slice(0, 8).map(([label, value]) => ({ label, value }));
    const closed = {}; excluded.forEach(a => { closed[a.outcome_reason] = (closed[a.outcome_reason] || 0) + 1; });
    const byC = {}; apps.forEach(a => { byC[a.country] = (byC[a.country] || 0) + 1; });
    const countryRows = Object.entries(byC).sort(by(([, v]) => -v)).slice(0, 10).map(([label, value]) => ({ label, value, html: `${flag(label)} ${esc(label)}` }));
    const scored = apps.filter(a => a.scores && a.scores.shortlist != null), bins = ['<5', '5', '6', '7', '8', '9+'].map(label => ({ label, value: 0 }));
    scored.forEach(a => { const s = a.scores.shortlist; bins[s < 5 ? 0 : s < 6 ? 1 : s < 7 ? 2 : s < 8 ? 3 : s < 9 ? 4 : 5].value++; });
    const empty = t => `<p class="empty">${t}</p>`;
    $('#view-stats').innerHTML = `
      <div class="tiles">
        <div class="tile frame"><span class="num">${sent.length}</span><span class="lbl">sent (insight basis)</span></div>
        <div class="tile frame"><span class="num">${rep.length}</span><span class="lbl">replies · ${pct(rep.length, sent.length)}</span></div>
        <div class="tile frame"><span class="num amber">${boss.length}</span><span class="lbl">boss fights</span></div>
        <div class="tile frame"><span class="num lime">${off.length}</span><span class="lbl">offers</span></div>
        <div class="tile frame"><span class="num muted">${excluded.length}</span><span class="lbl">board reset, left out</span></div>
      </div>
      ${few ? `<p class="hint note-few">${sent.length} sent applications in the insight basis: these are counts, not patterns. Trends need about 40 outcomes.</p>` : ''}
      <div class="charts">
        ${chart('funnel', 'Funnel', 'Applied → reply → boss fight → offer; each step as a share of the one before', sent.length
          ? hbarChart(funnel.map(([label, value], i) => ({ label, value, color: ORD[i], note: i ? pct(value, funnel[i - 1][1]) : '' })), { aria: 'Funnel' }) : empty('Nothing sent in the insight basis yet.'),
          table(['Step', 'Count', 'From previous'], funnel.map(([l, v], i) => [l, v, i ? pct(v, funnel[i - 1][1]) : '']))) }
        ${chart('weekly', 'Weekly applications', 'Applications sent per week (Monday weeks), closed ones included', wkShown.length ? vbarChart(wkShown, { aria: 'Weekly applications' }) : empty('Nothing sent yet.'),
          wkShown.length ? table(['Week of', 'Sent'], wkShown.map(w => [w.label, w.value])) : '')}
        ${chart('reasons', 'Rejection reasons', `Employer rejections, withdrawals and no reply within 30 days. Left out: ${Object.entries(closed).map(([k, v]) => `${v} ${REASON_TEXT[k] || k}`).join(', ') || 'none'} (the board reset is excluded)`,
          reasonRows.length ? hbarChart(reasonRows, { aria: 'Rejection reasons' }) : empty('No employer rejection with a reason yet.'), reasonRows.length ? table(['Reason', 'Count'], reasonRows.map(r => [r.label, r.value])) : '')}
        ${chart('country', 'By country', 'All applications per country', countryRows.length ? hbarChart(countryRows, { aria: 'Applications by country' }) : empty('No applications.'),
          countryRows.length ? table(['Country', 'Applications'], countryRows.map(r => [r.label, r.value])) : '')}
        ${chart('scores', 'Score distribution', `Screener shortlist score, ${plural(scored.length, 'scored application')}`, scored.length ? vbarChart(bins, { aria: 'Shortlist score distribution' }) : empty('No screened applications yet.'),
          scored.length ? table(['Shortlist', 'Applications'], bins.map(b => [b.label, b.value])) : '')}
      </div>`;
  }

  // ---------------------------------------------------------------- sheets
  const blocks = (v, max, c) => `<span class="blocks" style="--c:${c}">${Array.from({ length: max }, (_, i) => `<i class="${i < Math.round(v) ? 'on' : ''}"></i>`).join('')}</span>`;
  const meter = (k, v, max, c, txt) => `<div class="meter"><span class="k">${k}</span>${blocks(v, max, c)}<span class="v">${txt}</span></div>`;
  function sheet(html, onClick) {
    const m = $('#modal'); m.innerHTML = `<div class="sheet frame" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false;
    m.onclick = e => {
      if (e.target === m || e.target.closest('[data-close]')) { closeSheet(true); return; }
      const cp = e.target.closest('[data-copy]'); if (cp) { copyText(cp.dataset.copy); return; }
      const h = e.target.closest('[data-href]'); if (h) { go(h.dataset.href); return; }
      const d = e.target.closest('[data-doc]'); if (d) { openDoc(d.dataset.doc, d.dataset.kind); return; }
      if (onClick) onClick(e, m);
    };
    document.body.style.overflow = 'hidden';
    const sh = m.querySelector('.sheet');
    if (window.Motion && Motion.animate && !(window.Art && Art.reducedMotion)) Motion.animate(sh, { transform: ['translateY(18px) scale(.98)', 'translateY(0) scale(1)'], opacity: [0, 1] }, { duration: .22 });
    const f = m.querySelector('.gbtn:not([disabled]), input, textarea'); if (f) f.focus({ preventScroll: true });
    return m;
  }
  function closeSheet(nav) {
    const m = $('#modal'); if (m.hidden) return; m.hidden = true; m.innerHTML = ''; State.sheet = null; document.body.style.overflow = '';
    if (nav) history.replaceState(null, '', tabHash());
  }
  const findApp = id => State.data.applications.find(a => a.id === id);
  const findJob = id => State.data.jobs.find(j => j.id === id);
  const canWrite = () => !!(State.secrets && State.secrets.github_token);
  const writeHint = () => canWrite() ? '' : '<p class="hint">Read-only: this bundle carries no write token. Set DASHBOARD_WRITE_TOKEN in the CI secrets to act from here.</p>';
  const dis = () => canWrite() ? '' : 'disabled';
  function parseMessage(md) {    // recruiter_message.md: "## LinkedIn ..." and "## Email ..." sections; anything else is one block
    const out = { linkedin: '', email: '', other: '' }; if (!md) return out;
    const parts = String(md).split(/^#{1,4}\s+/m);
    parts.forEach(p => { const [head, ...body] = p.split('\n'), text = body.join('\n').trim(); if (/linkedin/i.test(head)) out.linkedin = text; else if (/e-?mail/i.test(head)) out.email = text; else if (p.trim()) out.other += (out.other ? '\n\n' : '') + p.trim(); });
    if (!out.linkedin && !out.email) out.other = String(md).trim();
    return out;
  }

  function openApp(id) {
    const a = findApp(id);
    if (!a) { sheet(`<h3>Not in this bundle</h3><p class="hint">“${esc(id)}” is not in the data this page holds. CI publishes a new bundle after every push to main.</p><div class="actions">${gbtn('Close', 'close', 'stone', 'data-close')}</div>`); return; }
    State.sheet = { kind: 'app', id };
    const s = a.scores || {}, ats = a.ats || null, scr = a.screening || null, lane = laneOf(a);
    const kwRows = ats ? (ats.matched || []).slice().sort(by(r => -(r.weight || 0))).slice(0, 8).map(r => `<tr><td>${esc(r.term)}</td><td>${esc(r.section || '')}</td><td class="ok">✓ ${esc(r.where || '')}${r.count_resume ? ' ×' + r.count_resume : ''}</td></tr>`).join('')
      + (ats.missing || []).slice().sort(by(r => -(r.weight || 0))).slice(0, 8).map(r => `<tr><td>${esc(r.term)}</td><td>${esc(r.section || '')}</td><td class="miss">✗ missing</td></tr>`).join('') : '';
    const kills = scr && scr.kill_shots && scr.kill_shots.length ? scr.kill_shots.slice(0, 4).map(k => `<p class="kill">${esc(k.issue)} <span class="q">${k.fixable ? '(fixable)' : '(not fixable from the resume)'}${k.quote ? ' · “' + esc(k.quote.slice(0, 120)) + '”' : ''}</span></p>`).join('') : '<p class="hint">No kill shots recorded.</p>';
    const risks = scr && scr.top_risks && scr.top_risks.length ? scr.top_risks.slice(0, 3).map(r => `<p class="risk">${esc(r)}</p>`).join('') : '';
    const docs = Object.entries(a.documents || {}).filter(([, p]) => p);
    const src = a.source || {}, msg = parseMessage(a.recruiter_message), contacts = a.contacts || [];
    const isReady = ['ready', 'draft'].includes(a.status), isApplied = ['applied', 'acknowledged'].includes(a.status), closed = lane === 'result';
    const stampCls = s.shortlist == null ? 'none' : s.gate_passed ? 'pass' : 'fail';
    const contactHtml = contacts.length ? `<ul class="contacts">${contacts.map(c => `<li class="contact frame">
        <div><b>${esc(c.name)}</b>${c.title ? ` <span class="muted">· ${esc(c.title)}</span>` : ''}</div>
        ${c.email ? `<div class="cv"><span class="mono">${esc(c.email)}</span>${gbtn('Copy', 'copy', 'stone', `data-copy="${attr(c.email)}" aria-label="Copy email of ${attr(c.name)}"`, 'xs')}</div>` : ''}
        ${c.linkedin ? `<div class="cv"><a href="${attr(c.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>${gbtn('Copy', 'copy', 'stone', `data-copy="${attr(c.linkedin)}" aria-label="Copy LinkedIn of ${attr(c.name)}"`, 'xs')}</div>` : ''}
        ${c.source_url ? `<div class="cv small"><span class="muted">found on</span> <a href="${attr(c.source_url)}" target="_blank" rel="noopener">${esc(host(c.source_url))} ↗</a></div>` : ''}</li>`).join('')}</ul>` : '<p class="hint">No contact found in the posting yet.</p>';
    const msgBlock = (label, text, key) => text ? `<div class="msg"><div class="msg-head"><span class="lbl">${label}</span>${gbtn('Copy ' + label, 'copy', 'stone', `data-copy="${attr(text)}" data-copykey="${key}"`, 'xs')}</div><pre class="msg-text">${esc(text)}</pre></div>` : '';
    const outreachHtml = a.outreach ? `<p class="outreach-note">${ico('beacon')} Recruiter contacted ${fmtStamp(a.outreach.at)}${a.outreach.contact ? ' · ' + esc(a.outreach.contact) : ''}${a.outreach.pending ? ' <span class="tag sync">SYNCING</span>' : ''}</p>` : '';
    const revs = (a.revisions || []).slice().reverse();
    sheet(`
      <div class="sheet-head"><div class="sh-title">${flag(a.country, 'big')}<div><div class="co">${esc(a.company)}</div><div class="ttl">${esc(a.title || '')} · ${esc(a.country)}${a.location ? ' · ' + esc(a.location) : ''} · ${esc(roleLabel(a.role))}</div>
        <div class="rarity">${esc(lane.toUpperCase())} · ${esc(a.status.toUpperCase())}${a.pending ? ' · SYNCING' : ''}${a.outcome_reason ? ' · ' + esc(REASON_TEXT[a.outcome_reason] || a.outcome_reason) : ''}</div></div></div>
        <div class="sh-right"><div class="stamp ${stampCls}">${s.shortlist == null ? 'UNSCREENED' : s.gate_passed ? 'GATE PASS' : 'GATE FAIL'}</div>${gbtn('Close', 'close', 'stone', 'data-close aria-label="Close"', 'xs')}</div></div>
      ${outreachHtml}
      ${a.cmdRejected ? `<p class="bad-text">Your last change was rejected by CI: ${esc(a.cmdRejected)}</p>` : ''}
      <div class="grid2">
        <div>
          <h3>Scores</h3>
          ${meter('Shortlist', (s.shortlist || 0), 10, 'var(--lime)', num(s.shortlist, 1))}
          ${meter('ATS screen', (s.ats_screener || 0), 10, 'var(--cyan)', num(s.ats_screener))}
          ${meter('Keywords', (s.keyword_coverage_pct || 0) / 10, 10, 'var(--gold)', num(s.keyword_coverage_pct) + '%')}
          ${meter('ATS match', (s.ats_pct || 0) / 10, 10, 'var(--violet)', num(s.ats_pct) + '%')}
          <p class="hint">Keywords = JD coverage (target 40-60%). Band <b>${esc(s.band || 'none')}</b>${s.calibrated ? '' : ', an estimate until 20 outcomes exist in it'}. ${s.shortlist == null ? 'Not screened yet.' : s.gate_passed ? 'Gate passed.' : 'Gate failed: shortlist ≥ 7 and ATS ≥ 8 needed.'}${scr && scr.verdict ? ' Screener verdict: ' + esc(scr.verdict) + '.' : ''}</p>
          ${a.project ? `<h3>Gap project</h3><p class="hint">${esc(a.project)}. The resume carries the “Building …” line; the repo must exist under that name before the first call.</p>` : ''}
          <h3>Gaps</h3><div class="chips">${(a.gaps || []).length ? a.gaps.map(g => `<span class="chip">${esc(g)}</span>`).join('') : '<span class="hint">none recorded</span>'}</div>
          ${(a.tier_l || []).length ? `<h3>Tier L claimed</h3><div class="chips">${a.tier_l.map(g => `<span class="chip l">${esc(g)}</span>`).join('')}</div>` : ''}
          <h3>Recruiter</h3>${contactHtml}
          ${msg.linkedin || msg.email || msg.other ? `<h3>Recruiter message</h3>${msgBlock('LinkedIn note', msg.linkedin, 'linkedin')}${msgBlock('Email', msg.email, 'email')}${msgBlock('Message', msg.other, 'other')}` : ''}
        </div>
        <div>
          <h3>Keywords</h3>
          ${kwRows ? `<table class="kw"><tr><th>Term</th><th>JD</th><th>Resume</th></tr>${kwRows}</table>` : '<p class="hint">No ATS score file for this application.</p>'}
          <h3>Kill shots</h3>${kills}
          ${risks ? `<h3>Top risks</h3>${risks}` : ''}
          ${revs.length ? `<h3>Revisions</h3><ul class="log">${revs.map(r => `<li><span class="d">${fmtDay(r.at)}</span><span><span class="st">${esc((r.status || '').toUpperCase())}</span>${esc(r.feedback)}${r.pending ? ' <span class="tag sync">SYNCING</span>' : ''}</span></li>`).join('')}</ul>` : ''}
        </div>
      </div>
      <h3>Documents</h3>
      <div class="docs">${docs.length ? docs.map(([k, p]) => gbtn(DOC_LABELS[k] || k, k === 'report' ? 'chart' : 'doc', 'stone', `data-doc="${attr(p)}" data-kind="${attr(k)}"`, 'sm')).join('') : '<span class="hint">No documents in the bundle (external record).</span>'}
        ${src.url ? glink('Job post', 'link', 'stone', src.url, 'sm') : ''}${src.email_url ? glink('Source mail', 'mail', 'stone', src.email_url, 'sm') : ''}</div>
      <div id="viewer" class="viewer" hidden></div>
      <h3>Log</h3>
      <ul class="log">${(a.history || []).slice().reverse().map(h => `<li><span class="d">${fmtDay(h.date)}</span><span><span class="st">${esc((h.event || h.status).toUpperCase())}</span>${esc(h.note || '')}${h.reason ? ` <span class="muted">(${esc(REASON_TEXT[h.reason] || h.reason)})</span>` : ''}${h.email ? `<div class="mail">${esc(h.email.subject || '')} · <a href="${attr(h.email.url)}" target="_blank" rel="noopener">open in Gmail ↗</a>${h.email.from ? ' · ' + esc(h.email.from) : ''}</div>` : ''}</span></li>`).join('')}</ul>
      ${a.next_action ? `<p class="hint">Next: ${esc(a.next_action)}${a.follow_up_due ? ' · follow-up due ' + fmtDay(a.follow_up_due) : ''}</p>` : ''}
      ${a.notes ? `<h3>Notes</h3><p class="hint">${esc(a.notes)}</p>` : ''}
      ${closed ? '' : `<h3>Record</h3>${writeHint()}
      <div class="record"><div class="field"><label for="rec-status">Status</label><select id="rec-status" ${dis()}>${['applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'].map(x => `<option value="${x}">${x}</option>`).join('')}</select></div>
        <div class="field"><label for="rec-note">Note (who wrote, what they ask, a date; the reason for a rejection)</label><input id="rec-note" type="text" ${dis()}></div>
        ${gbtn('Record', 'quill', 'cyan', `data-record ${dis()}`)}</div>`}
      <div id="extra"></div>
      <div class="actions">
        ${isReady ? gbtn('Discard', 'trash', 'red', `data-discard ${dis()}`) : ''}
        ${!closed && !isReady ? gbtn('Rejected', 'skull', 'red', `data-rejected ${dis()}`) : ''}
        ${isApplied ? gbtn('Followed up', 'bell', 'cyan', `data-follow ${dis()}`) : ''}
        ${isApplied && !a.outreach ? gbtn('Reached out to recruiter', 'beacon', 'gold', `data-reached ${dis()}`) : ''}
        ${isReady && lane !== 'queue' ? gbtn('Revise', 'revise', 'gold', `data-revise ${dis()}`) : ''}
        ${isReady && lane !== 'queue' ? gbtn('Mark as sent', 'send', 'lime', `data-sent ${dis()}`) : ''}
      </div>`,
    async (e, m) => {
      const extra = m.querySelector('#extra');
      const ask = (html, focus) => { extra.innerHTML = html; const f = extra.querySelector(focus); if (f) f.focus(); };
      if (e.target.closest('[data-sent]')) {
        await act(e, () => command({ op: 'set', id: a.id, status: 'applied', note: 'sent (recorded on the dashboard)' }), 'Sent. It moves to APPLIED.', { burst: 'LEVEL UP · SENT', after: () => flashCard(a.id) });
      } else if (e.target.closest('[data-follow]')) {
        await act(e, () => command({ op: 'set', id: a.id, status: a.status === 'acknowledged' ? 'applied' : a.status, note: 'follow-up sent (recorded on the dashboard)' }), 'Follow-up logged.');
      } else if (e.target.closest('[data-discard-send]')) {
        const box = m.querySelector('#discard-reason'), why = (box.value.trim() || box.placeholder).slice(0, 200);
        await act(e, () => command({ op: 'set', id: a.id, status: 'withdrawn', reason: why, note: 'discarded on the dashboard: ' + why }), 'Discarded. It moves to RESULT.');
      } else if (e.target.closest('[data-discard]')) {
        const dflt = a.status === 'draft' ? 'not sending' : 'posting closed before applying';
        ask(`<div class="field"><label for="discard-reason">Why discard it? (one line; it feeds the stats)</label><input id="discard-reason" type="text" maxlength="200" value="${attr(dflt)}" placeholder="${attr(dflt)}"></div><div class="row-acts">${gbtn('Discard', 'trash', 'red', 'data-discard-send')}</div>`, '#discard-reason');
      } else if (e.target.closest('[data-rejected-send]') || (e.target.closest('[data-rejected]') && m.querySelector('#rej-reason'))) {
        const box = m.querySelector('#rej-reason');
        if (!box.value.trim()) { toast('Give the reason first.', true); box.focus(); return; }
        await act(e, () => command({ op: 'set', id: a.id, status: 'rejected', reason: box.value.trim().slice(0, 200), note: box.value.trim().slice(0, 500) }), 'Recorded as rejected.');
      } else if (e.target.closest('[data-rejected]')) {
        ask(`<div class="field"><label for="rej-reason">Rejection reason (one line; it feeds the stats)</label><input id="rej-reason" type="text" maxlength="200" placeholder="other candidates / location / seniority / language"></div><div class="row-acts">${gbtn('Record rejection', 'skull', 'red', 'data-rejected-send')}</div>`, '#rej-reason');
      } else if (e.target.closest('[data-revise-send]')) {
        const t = m.querySelector('#rev-text').value.trim();
        if (t.length < 10) { toast('Say what to change (10+ characters).', true); return; }
        const from = cardRect(a.id);
        await act(e, () => command({ op: 'revise', id: a.id, feedback: t.slice(0, 4000) }), 'Revision queued. The card goes back to the head of the QUEUE.', { after: () => flyToQueue(a.id, from) });
      } else if (e.target.closest('[data-revise]')) {
        ask(`<div class="field"><label for="rev-text">What should change? (the worker revises the resume before you send it)</label><textarea id="rev-text" rows="4" maxlength="4000" placeholder="e.g. lead with the Kafka CDC work; cut the forecasting bullet to one line"></textarea></div><div class="row-acts">${gbtn('Send revision', 'revise', 'gold', 'data-revise-send')}</div>`, '#rev-text');
      } else if (e.target.closest('[data-reached-send]')) {
        const c = m.querySelector('#ro-contact').value.trim().slice(0, 200);
        await act(e, () => command(Object.assign({ op: 'reached_out', id: a.id }, c ? { contact: c } : {})), 'Beacon lit: recruiter contacted.', { after: () => flashCard(a.id) });
      } else if (e.target.closest('[data-reached]')) {
        const c0 = contacts[0], val = c0 ? `${c0.name}${c0.title ? ' (' + c0.title + ')' : ''}` : '';
        ask(`<div class="field"><label for="ro-contact">Who did you contact? (optional)</label><input id="ro-contact" type="text" maxlength="200" value="${attr(val)}"></div><div class="row-acts">${gbtn('Confirm outreach', 'beacon', 'gold', 'data-reached-send')}</div>`, '#ro-contact');
      } else if (e.target.closest('[data-record]')) {
        const st = m.querySelector('#rec-status').value, note = m.querySelector('#rec-note').value.trim();
        if (['rejected', 'withdrawn'].includes(st) && !note) { toast('A rejection or withdrawal needs the reason in the note.', true); return; }
        const c = { op: 'set', id: a.id, status: st, note }; if (['rejected', 'withdrawn'].includes(st)) c.reason = note.slice(0, 200);
        await act(e, () => command(c), `Recorded: ${st}. CI syncs it in a few minutes.`);
      }
    });
  }
  function openJob(id) {
    const j = findJob(id);
    if (!j) { sheet(`<h3>Not in this bundle</h3><p class="hint">Job “${esc(id)}” is not in the data this page holds.</p><div class="actions">${gbtn('Close', 'close', 'stone', 'data-close')}</div>`); return; }
    State.sheet = { kind: 'job', id };
    const floor = (State.data.config || {}).auto_apply_min_fit ?? 6, src = j.source || {}, name = j.company || host(j.url) || 'job', open = ['new', 'queued'].includes(j.status);
    const isParked = parked(j), linked = j.status === 'applied' && j.application_id ? findApp(j.application_id) : null;
    const who = { you: 'you', cleanup: 'the October board reset' }[j.dismissed_via] || 'the routine';
    const plan = j.status === 'dismissed' ? `<span class="bad-text">Discarded by ${who}${j.dismissed ? ' on ' + fmtDay(j.dismissed) : ''}: <strong>${esc(j.reason || 'no reason recorded')}</strong>.</span>`
        + (byRoutine(j) ? ' FORGE ANYWAY puts it first in line for the next worker run, whatever the fit.' : ' BACK TO QUEUE reopens it.')
      : j.status === 'expired' ? `Expired: the posting is closed${j.reason ? ' (' + esc(j.reason) + ')' : ''}.`
      : j.status === 'applied' ? (linked ? `Forged into the application below, which is <b>${esc(linked.status.toUpperCase())}</b>${linked.status === 'draft' ? ' (not sent: open it to see the gate result)' : linked.status === 'ready' ? ' (not sent yet: send it, then MARK AS SENT)' : ''}.` : 'Linked to an application that is no longer on the board.')
      : isParked ? `Parked: the worker failed on it ${j.worker_attempts} times${j.blocked_reason ? ' (' + esc(j.blocked_reason) + ')' : ''}. UN-PARK puts it first in line for the next run.`
      : j.hold && j.status === 'new' ? `<span class="bad-text">Held: it hits a hard filter${j.reason ? ' (<strong>' + esc(j.reason) + '</strong>)' : ''}.</span> The worker does not tailor it until you press FORGE ANYWAY.`
      : j.status === 'queued' ? 'A folder exists: the worker is tailoring it. It lands in READY when the gate ran.'
      : j.jd_available === false ? 'JD fetching from the link you provided failed (' + esc((j.jd_error || 'page unreadable').replace(/: paste it on the dashboard$/, '')) + '). Please paste the JD below; the worker forges the resume once it is saved.'
      : !j.jd_text ? 'CI fetches the JD within minutes of a push; the worker tailors after that.'
      : (j.fit || 0) < floor && !j.priority ? `Fit ${j.fit ?? '?'} is below the floor (${floor}): it waits unless you press FORGE FIRST.`
      : `Qualifies: the worker tailors, builds, scores, screens and writes the cover letter where needed. ${esc(workerLine(false))}.`;
    sheet(`
      <div class="sheet-head"><div class="sh-title">${flag(j.country, 'big')}<div><div class="co">${esc(name)}</div><div class="ttl">${esc(j.title || j.url)}${j.location ? ' · ' + esc(j.location) : ''} · ${esc(roleLabel(j.role))}</div>
        <div class="rarity">${esc(linked ? 'FORGED · ' + linked.status.toUpperCase() : (j.status || 'new').toUpperCase())}${j.hold && open ? ' · HELD' : j.priority && open ? ' · FIRST IN LINE' : ''}${j.pending ? ' · SYNCING' : ''} · ${esc((src.kind || 'manual').replace('_', ' ').toUpperCase())}</div></div></div>
        <div class="sh-right">${gbtn('Close', 'close', 'stone', 'data-close aria-label="Close"', 'xs')}</div></div>
      <div class="grid2">
        <div><h3>What happens next</h3><p class="hint">${plan}</p>
          ${meter('Fit', j.fit || 0, 10, 'var(--cyan)', (j.fit ?? '?') + '/10')}
          ${j.reason && open ? `<p class="hint">Why: ${esc(j.reason)}</p>` : ''}${j.fit_reason ? `<p class="hint">Fit: ${esc(j.fit_reason)}</p>` : ''}
          <p class="hint">Sponsor: ${esc(j.sponsor || 'unknown')}${j.language_req ? ' · language: ' + esc(j.language_req) : ''}${j.found ? ' · found ' + fmtDay(j.found) : ''}${j.queued_at ? ' · queued ' + fmtStamp(j.queued_at) : ''}</p>
          ${j.application_id ? `<p class="hint">Application: <a href="#/app/${encodeURIComponent(j.application_id)}" data-href="#/app/${encodeURIComponent(j.application_id)}">${esc(j.application_id)}</a></p>` : ''}
          <div class="docs">${glink('Job post', 'link', 'stone', j.url, 'sm')}${src.email_url ? glink('Alert mail', 'mail', 'stone', src.email_url, 'sm') : ''}</div></div>
        <div><h3>Job description</h3>
          ${j.jd_text ? `<pre class="jdbox">${esc(j.jd_text.slice(0, 6000))}${j.jd_text.length > 6000 ? '\n…' : ''}</pre>` : (j.jd_available === false ? `<p class="hint"><span class="bad-text">JD fetching from the link you provided failed. Please paste the JD.</span></p>` : `<p class="hint">No JD text yet.</p>`)}
          ${open && (!j.jd_text || j.jd_available === false) ? `<div class="field"><label for="jd-paste">Please paste the JD (≥ 200 characters)</label><textarea id="jd-paste" rows="5" ${dis()}></textarea></div><div class="row-acts">${gbtn('Save JD', 'save', 'cyan', `data-paste ${dis()}`)}</div>` : ''}</div>
      </div>
      ${j.cmdRejected ? `<p class="bad-text">Your last change was rejected by CI: ${esc(j.cmdRejected)}</p>` : ''}
      ${writeHint()}
      <div id="extra"></div>
      <div class="actions">
        ${open ? gbtn('Dismiss', 'close', 'red', `data-dismiss ${dis()}`) : ''}
        ${isParked ? gbtn('Un-park', 'hammer', 'gold', `data-unpark ${dis()}`) : ''}
        ${j.status === 'new' && j.hold && !isParked ? gbtn('Forge anyway', 'hammer', 'gold', `data-unhold ${dis()}`) : ''}
        ${j.status === 'new' && !j.priority && !j.hold && !isParked ? gbtn('Forge first', 'hammer', 'gold', `data-first ${dis()}`) : ''}
        ${byRoutine(j) ? gbtn('Forge anyway', 'hammer', 'gold', `data-forge-anyway="${attr(j.id)}" ${dis()}`) : ['dismissed', 'expired'].includes(j.status) ? gbtn('Back to queue', 'revise', 'gold', `data-revive ${dis()}`) : ''}
        ${open ? gbtn('Mark applied', 'check', 'lime', `data-applied ${dis()}`) : ''}
      </div>`,
    async (e, m) => {
      const extra = m.querySelector('#extra');
      if (e.target.closest('[data-first]')) await act(e, () => command({ op: 'job', id: j.id, priority: true }), 'FORGE FIRST: first in line for the next worker run.');
      else if (e.target.closest('[data-unhold]')) await act(e, () => command({ op: 'job', id: j.id, priority: true }), 'FORGE ANYWAY: the hold is lifted; first in line for the next worker run.');
      else if (e.target.closest('[data-unpark]')) await act(e, () => command({ op: 'job', id: j.id, priority: true }), 'Un-parked: first in line for the next worker run.');
      else if (e.target.closest('[data-revive]')) await act(e, () => command({ op: 'job', id: j.id, status: 'new', dedupe_override: true }), 'Back in the queue.');
      else if (e.target.closest('[data-dismiss]')) {
        const box = m.querySelector('#dismiss-reason');
        if (!box) { extra.innerHTML = '<div class="field"><label for="dismiss-reason">Why? (one line)</label><input id="dismiss-reason" type="text" placeholder="German C1 required / senior / no sponsorship"></div>'; m.querySelector('#dismiss-reason').focus(); return; }
        await act(e, () => command({ op: 'job', id: j.id, status: 'dismissed', reason: box.value.trim() || 'dismissed on the dashboard' }), 'Dismissed. The worker skips it.');
      } else if (e.target.closest('[data-applied]')) {
        const box = m.querySelector('#ap-company');
        if (!box) {
          const countries = State.data.countries || [];
          extra.innerHTML = `<div class="record"><div class="field"><label for="ap-company">Company</label><input id="ap-company" type="text" value="${attr(j.company || '')}"></div>
            <div class="field"><label for="ap-country">Country</label><select id="ap-country">${countries.map(c => `<option value="${attr(c)}" ${c === j.country ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
            <div class="field"><label for="ap-note">Note</label><input id="ap-note" type="text" placeholder="where / how you applied"></div></div>`;
          m.querySelector('#ap-company').focus(); return;
        }
        const company = box.value.trim(), country = m.querySelector('#ap-country').value, note = m.querySelector('#ap-note').value.trim();
        if (!company) { toast('The company name is needed.', true); box.focus(); return; }
        await act(e, () => command({ op: 'job_applied', id: j.id, company, country, note: note || 'applied directly (recorded on the dashboard)' }), `Recorded: applied at ${company}. The card appears in APPLIED after CI.`, { burst: 'LEVEL UP · SENT' });
      } else if (e.target.closest('[data-paste]')) {
        const text = m.querySelector('#jd-paste').value.trim();
        if (text.length < 200) { toast('That is too short to be a JD (200+ characters).', true); return; }
        await act(e, () => command({ op: 'job', id: j.id, jd_text: text }), 'JD saved. The worker forges it.');
      }
    });
  }
  function openAdd() {
    State.sheet = { kind: 'add' };
    const countries = State.data.countries || [], roles = State.data.roles || { DataEngineer: 'Data Engineer' };
    sheet(`<form id="addf"><div class="sheet-head"><div><div class="co">Add a job</div><div class="ttl">It joins the QUEUE; the worker forges the resume. ${esc(workerLine(false))}.</div></div>${gbtn('Close', 'close', 'stone', 'data-close aria-label="Close"', 'xs')}</div>
      <div class="field"><label for="add-url">Job link (LinkedIn, Workday, Greenhouse, any page)</label><input id="add-url" type="url" placeholder="https://www.linkedin.com/jobs/view/…" required ${dis()}></div>
      <div class="field"><label for="add-country">Country (auto from the posting; override here)</label><select id="add-country">${['auto'].concat(countries).map(c => `<option value="${attr(c)}">${c === 'auto' ? 'Auto-detect' : esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="add-role">Role</label><select id="add-role">${Object.entries(roles).map(([k, v]) => `<option value="${attr(k)}">${esc(v)}</option>`).join('')}</select></div>
      <div class="field"><label for="add-jd">JD text (optional; paste it when the link needs a login)</label><textarea id="add-jd" rows="4"></textarea></div>
      <p class="hint">Writes one file to the private repo (tracker/jobs/manual-&lt;time&gt;.json). CI fetches the JD within minutes.</p>
      ${writeHint()}
      <div class="actions"><button type="submit" class="gbtn t-lime" ${dis()}>${ico('add')}<span>Queue it</span></button></div></form>`);
    $('#addf').addEventListener('submit', async e => {
      e.preventDefault();
      const url = $('#add-url').value.trim(), country = $('#add-country').value, role = $('#add-role').value, jd = $('#add-jd').value.trim();
      if (jd && jd.length < 200) { toast('The pasted JD is too short (200+ characters).', true); return; }
      const now = new Date(), id = 'manual-' + now.getTime();
      const job = { id, title: '', company: '', country, location: '', role, url, source: { kind: 'manual' }, found: todayIso(), fit: null, sponsor: 'unknown', language_req: '',
        jd_available: jd ? true : null, reason: 'added from the dashboard', status: 'new', application_id: null, priority: true, queued_at: now.toISOString() };
      if (jd) { job.jd_text = jd; job.jd_source = 'pasted'; }
      await act({ target: e.submitter || e.target }, async () => { await ghPut(`tracker/jobs/${id}.json`, job, `Queue: ${url}`); Pending.add({ op: 'job_add', job }); }, `Queued. ${workerLine(true)}.`, { after: () => { showTab('board'); scrollToLane('queue', true); } });
    });
  }
  function openOriginalDoc(path, kind, title) {
    sheet(`<div class="sheet-head"><div><div class="co">${esc(title)}</div><div class="ttl">Original · ${esc(kind === 'report' ? 'market report' : 'resume PDF')}</div></div>${gbtn('Close', 'close', 'stone', 'data-close aria-label="Close"', 'xs')}</div><div id="viewer" class="viewer" hidden></div>`);
    openDoc(path, kind);
  }

  // ---------------------------------------------------------------- documents inside a sheet
  async function openDoc(path, kind) {
    const viewer = $('#viewer'); if (!viewer) return;
    viewer.hidden = false; viewer.innerHTML = `<p class="hint">Decrypting ${esc(DOC_LABELS[kind] || path)}…</p>`;
    let entry;
    try { entry = await Docs.get(path); } catch (e) {
      const stale = e && (e.name === 'OperationError' || e.status === 404 || /decrypt/i.test(e.message || ''));
      viewer.innerHTML = stale ? `<p class="bad-text">The dashboard was republished since you unlocked it. Reload the page and unlock again to open ${esc(path.split('/').pop())}.</p>`
        : `<p class="bad-text">Could not open ${esc(path)}: ${esc(e.message)}</p>`;
      return;
    }
    const name = path.split('/').pop();
    // HTML never runs in the dashboard origin (M8): the iframe is sandboxed, and NEW TAB opens a script-free wrapper page
    // holding a sandboxed iframe instead of navigating to the blob.
    const newTab = entry.type === 'text/html' ? gbtn('New tab', 'link', 'stone', 'data-newtab', 'xs')
      : `<a class="gbtn t-stone xs" href="${entry.url}" target="_blank" rel="noopener">${ico('link')}<span>New tab</span></a>`;
    const bar = `<div class="viewer-bar"><strong>${esc(DOC_LABELS[kind] || name)}</strong><div class="acts">${newTab}<a class="gbtn t-stone xs" href="${entry.url}" download="${attr(name)}">${ico('save')}<span>Download</span></a>${gbtn('Hide', 'close', 'stone', 'id="viewer-close"', 'xs')}</div></div>`;
    if (entry.type === 'application/pdf' || entry.type === 'text/html') {
      const sandbox = entry.type === 'text/html' ? ' sandbox=""' : '';
      viewer.innerHTML = bar + `<iframe src="${entry.url}" title="${attr(name)}"${sandbox}></iframe><p class="hint">If the preview stays blank (some phones), use NEW TAB or DOWNLOAD.</p>`;
    } else if (entry.type === 'text/markdown') viewer.innerHTML = bar + `<div class="md">${markdown(entry.text)}</div>`;
    else viewer.innerHTML = bar + `<pre class="doc-text">${esc(entry.text || `(${entry.size} bytes)`)}</pre>`;
    $('#viewer-close').addEventListener('click', ev => { ev.stopPropagation(); viewer.hidden = true; viewer.innerHTML = ''; });
    const nt = viewer.querySelector('[data-newtab]'); if (nt) nt.addEventListener('click', ev => { ev.stopPropagation(); openSandboxedTab(entry.url, name); });
    viewer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function openSandboxedTab(url, title) {
    const w = window.open('', '_blank');
    if (!w) { toast('The browser blocked the new tab: use DOWNLOAD.', true); return; }
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src blob:; style-src 'unsafe-inline'">
      <title>${esc(title)}</title><style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%}</style></head>
      <body><iframe sandbox="" src="${attr(url)}" title="${attr(title)}"></iframe></body></html>`);
    w.document.close();
    try { w.opener = null; } catch (e) { /* ignore */ }
  }
  function markdown(src) {
    const lines = String(src || '').replace(/\r/g, '').split('\n');
    const inline = s => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const isBlockStart = l => /^(#{1,6}\s|```|\||\s*>|\s*([-*+]|\d+[.)])\s)/.test(l);
    const out = []; let i = 0, m;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*$/.test(l)) { i++; continue; }
      if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
      if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*$/))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
      if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(l)) {
        const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        let body = rows, html = '<table>';
        if (rows.length > 1 && /^\s*\|?\s*:?-{2,}/.test(rows[1])) { html += `<thead><tr>${cells(rows[0]).map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>`; body = rows.slice(2); }
        out.push(html + `<tbody>${body.map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
      }
      if (/^\s*>/.test(l)) { const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, '')); out.push(`<blockquote>${markdown(buf.join('\n'))}</blockquote>`); continue; }
      if ((m = l.match(/^\s*([-*+]|\d+[.)])\s+/))) {
        const ordered = /\d/.test(m[1]); const items = []; let m2;
        while (i < lines.length && (m2 = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
          items.push(m2[2].replace(/^\[([ xX])\]\s*/, (_, c) => c === ' ' ? '☐ ' : '☑ ')); i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += ' ' + lines[i++].trim();
        }
        out.push(`${ordered ? '<ol>' : '<ul>'}${items.map(t => `<li>${inline(t)}</li>`).join('')}${ordered ? '</ol>' : '</ul>'}`); continue;
      }
      const buf = []; while (i < lines.length && !/^\s*$/.test(lines[i]) && (!buf.length || !isBlockStart(lines[i]))) buf.push(lines[i++]);
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
    return out.join('\n');
  }

  // ---------------------------------------------------------------- writes through the GitHub Contents API (create only)
  const b64utf8 = s => { const bytes = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  async function ghPut(path, obj, message) {
    const s = State.secrets;
    if (!s || !s.github_token) throw new Error('no write token in this bundle');
    const r = await fetch(`https://api.github.com/repos/${s.repo}/contents/${path}`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + s.github_token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ message, content: b64utf8(JSON.stringify(obj, null, 2) + '\n'), branch: s.branch || 'main' }),
    });
    if (!r.ok) { let t = ''; try { t = (await r.json()).message || ''; } catch (e) { /* ignore */ } throw new Error(`GitHub ${r.status}${t ? ': ' + t : ''}`); }
    return r.json();
  }
  // Every dashboard op (tracker/SCHEMA.md): set, job, job_applied, revise, reached_out, original_instruction,
  // general_instruction, notification_read. One new file per command under tracker/commands/.
  const OPS = ['set', 'job', 'job_applied', 'revise', 'reached_out', 'original_instruction', 'general_instruction', 'notification_read'];
  async function command(c) {
    if (!OPS.includes(c.op)) throw new Error('unknown op ' + c.op);
    // cid: unique per command, in the body and the file name; CI reports it back as processed or rejected (M3)
    const cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    c = Object.assign({}, c, { cid });
    const name = `${Date.now()}-${cid}.json`;
    const what = c.id || (c.ids ? `${c.ids.length} notifications` : '') || c.scope || (c.text || '').slice(0, 40);
    await ghPut(`tracker/commands/${name}`, c, `Dashboard: ${c.op} ${what}${c.status ? ' -> ' + c.status : ''}`);
    const p = { cid, op: c.op, id: c.id, ids: c.ids, status: c.status, priority: c.priority, reason: c.reason, contact: c.contact, scope: c.scope, role: c.role };
    if (c.jd_text) p.jd = c.jd_text.slice(0, 200);
    if (c.feedback) p.feedback = c.feedback.slice(0, 600);
    if (c.text) p.text = c.text.slice(0, 600);
    Pending.add(p);
  }
  async function act(e, fn, msg, opts = {}) {
    const btn = e.target && e.target.closest ? e.target.closest('button') : null; if (btn) btn.disabled = true;
    const x = e.clientX || innerWidth / 2, y = e.clientY || innerHeight / 2;
    try {
      await fn();
      if (opts.burst && window.Art) Art.burst(x, y, opts.burst);
      toast(msg);
      closeSheet(true); renderAll(); if (opts.after) opts.after();
      return true;
    } catch (err) {
      if (btn) btn.disabled = false;
      toast('Write failed: ' + err.message, true);
      return false;
    }
  }
  const cardSel = id => `#board .card[data-app="${CSS.escape(id)}"]`;
  const cardRect = id => { const c = $(cardSel(id)); return c ? c.getBoundingClientRect() : null; };
  function flyToQueue(id, from) {
    if (State.tab !== 'board') showTab('board');
    scrollToLane('queue', false);
    const el = $(cardSel(id)); if (!el) return;
    if (!from || (from.width === 0 && from.height === 0)) { const r = el.getBoundingClientRect(); from = { left: r.left + 120, top: r.top + 60 }; }
    if (window.Art) Art.flyFrom(el, from);
  }
  function flashCard(id) { const el = $(cardSel(id)); if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('Copied.'); return; } catch (e) { /* fall back */ }
    const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied.'); } catch (e) { toast('Copy failed: select the text by hand.', true); }
    ta.remove();
  }
  function toast(msg, bad) { $$('.toast').forEach(x => x.remove()); const t = document.createElement('div'); t.className = 'toast frame' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), bad ? 6100 : 3300); }
  function lock() {
    Crypto.forget(); Docs.clear(); Pending.clear(); State.raw = State.data = null; State.secrets = null; closeSheet(false);   // L5: no pending list (ids, notes) survives LOCK
    if (State.scene) State.scene.destroy(); if (State.globe) State.globe.stop(); clearInterval(State.mottoTimer); State.scene = State.globe = null;
    $('#app').hidden = true; $('#lock').hidden = false; $('#pw').value = ''; $('#lock-msg').textContent = ''; $('#lock-msg').className = 'lock-msg';
    history.replaceState(null, '', '#/'); lockScene(); $('#pw').focus();
  }
  function lockScene() { if (window.Art && !State.lockScene) State.lockScene = Art.scene($('#lock-scene'), { buildings: [], parallax: false }); }

  // ---------------------------------------------------------------- unlock
  async function loadData() {
    await Crypto.loadIndex();
    State.raw = JSON.parse(new TextDecoder().decode(await Crypto.decrypt('data.json')));
    State.secrets = null;
    if (Crypto.has('secrets.json')) { try { State.secrets = JSON.parse(new TextDecoder().decode(await Crypto.decrypt('secrets.json'))); } catch (e) { State.secrets = null; } }
  }
  async function unlocked() {
    if (State.lockScene) { State.lockScene.destroy(); State.lockScene = null; }
    $('#lock').hidden = true; $('#app').hidden = false;
    applyPending(); sinceLastVisit(); renderAll(); buildScene(); route();
  }
  async function boot() {
    const msg = $('#lock-msg'), form = $('#lock-form'), btn = $('#pw-btn');
    $$('[data-icon]').forEach(el => { el.outerHTML = ico(el.dataset.icon); });
    try { await Crypto.loadManifest(); } catch (e) { msg.textContent = 'This site has no encrypted bundle yet: ' + e.message; msg.className = 'lock-msg error'; lockScene(); return; }
    if (await Crypto.restore()) { await loadData(); await unlocked(); return; }
    lockScene();
    form.addEventListener('submit', async e => {
      e.preventDefault();
      btn.disabled = true; msg.className = 'lock-msg'; msg.textContent = 'Deriving the key…';
      try {
        await Crypto.deriveKey($('#pw').value);
        if (!(await Crypto.verify())) { Crypto.key = null; msg.textContent = 'Wrong password.'; msg.className = 'lock-msg error'; btn.disabled = false; $('#pw').select(); return; }
        msg.textContent = 'Decrypting…';
        await Crypto.remember(); await loadData(); await unlocked();
      } catch (err) { msg.textContent = 'Could not unlock: ' + err.message; msg.className = 'lock-msg error'; }
      btn.disabled = false;
    });
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', async e => {
    if (!State.data) return;
    if (e.target.closest('[data-lock]')) { lock(); return; }
    if (e.target.closest('[data-add]')) { go('#/add'); return; }
    if (e.target.closest('[data-since-close]')) { $('#since').hidden = true; return; }
    const tab = e.target.closest('#tabs .tab'); if (tab) { go(tab.dataset.tab === 'board' ? '#/' : '#/' + tab.dataset.tab); return; }
    if (e.target.closest('[data-result-all]')) { State.showResult = true; renderBoard(); return; }
    const chip = e.target.closest('#lane-strip [data-lane]'); if (chip) { scrollToLane(chip.dataset.lane, true); return; }
    const unc = e.target.closest('[data-unclose]');
    if (unc) { await act(e, () => command({ op: 'job', id: unc.dataset.unclose, status: 'new', dedupe_override: true }), 'Back in the queue.'); return; }
    const fa = e.target.closest('[data-forge-anyway]');
    if (fa) { await act(e, () => command({ op: 'job', id: fa.dataset.forgeAnyway, status: 'new', priority: true, dedupe_override: true }), 'FORGE ANYWAY: first in line; the worker tailors it whatever the fit.'); return; }
    const crow = e.target.closest('#closed-jobs [data-job], #discarded-jobs [data-job]'); if (crow) { go(`#/job/${encodeURIComponent(crow.dataset.job)}`); return; }
    const card = e.target.closest('#board .card');
    if (card) { if (card.dataset.app) go(`#/app/${encodeURIComponent(card.dataset.app)}`); else if (card.dataset.job) go(`#/job/${encodeURIComponent(card.dataset.job)}`); return; }
    const od = e.target.closest('[data-odoc]'); if (od) { openOriginalDoc(od.dataset.odoc, od.dataset.okind, od.dataset.otitle); return; }
    const oi = e.target.closest('[data-oi]');
    if (oi) {
      const art = oi.closest('[data-orig]'), [country, role] = art.dataset.orig.split('|'), text = art.querySelector('.oi-text').value.trim();
      if (text.length < 5) { toast('Write the instruction first (5+ characters).', true); art.querySelector('.oi-text').focus(); return; }
      const scope = oi.dataset.oi === 'all' ? 'all' : country;
      await act(e, () => command({ op: 'original_instruction', scope, role, text: text.slice(0, 4000) }), scope === 'all' ? 'Instruction for every Original sent to the worker.' : `Instruction for the ${country} Original sent to the worker.`);
      return;
    }
    if (e.target.closest('[data-general]')) {
      const t = $('#gen-text').value.trim();
      if (t.length < 5) { toast('Write the instruction first (5+ characters).', true); $('#gen-text').focus(); return; }
      await act(e, () => command({ op: 'general_instruction', text: t.slice(0, 4000) }), 'General instruction sent to the worker.');
      return;
    }
    const rd = e.target.closest('[data-read]');
    if (rd) { await act(e, () => command({ op: 'notification_read', id: rd.dataset.read }), 'Marked as read.'); return; }
    if (e.target.closest('[data-read-all]')) {
      const ids = State.data.notifications.filter(n => !n.read).map(n => n.id);
      if (ids.length) await act(e, () => command({ op: 'notification_read', ids }), `Marked ${ids.length} as read.`);
      return;
    }
  });
  const tip = $('#tip');
  document.addEventListener('mouseover', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (!t) { tip.hidden = true; return; } tip.textContent = t.dataset.tip; tip.hidden = false; });
  document.addEventListener('mousemove', e => { if (!tip.hidden) { tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; } }, { passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeSheet(true); });
  window.addEventListener('hashchange', route);
  boot();
})();

const WHISPER_URL = 'http://127.0.0.1:8080';

/* Transcriber — standalone, dependency-free local Whisper front-end. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config
  const SAMPLE_RATE = 16000;
  const LIVE_CHUNK_SECONDS = 6;
  const OVERLAP_SECONDS = 0.5;
  const FILE_CHUNK_SECONDS = 30;
  const STORAGE_KEY = 'transcriber.v1';
  const DEFAULT_SPEAKERS = ['Speaker 1', 'Speaker 2'];

  // ---------------------------------------------------------------- utility layer
  function el(tag, attrs, children) {
    const parts = String(tag).split(/([.#])/);
    const name = parts.shift() || 'div';
    const node = document.createElement(name);
    let cls = '';
    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i] === '.') cls += ' ' + parts[i + 1];
      else if (parts[i] === '#') node.id = parts[i + 1];
    }
    if (cls) node.className = cls.trim();

    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) {
      children = attrs;
      attrs = null;
    }
    if (attrs) {
      for (const key in attrs) {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className += ' ' + value;
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key === 'html') node.innerHTML = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'value') node.value = value;
        else if (key === 'checked' || key === 'selected' || key === 'disabled') node[key] = !!value;
        else node.setAttribute(key, value === true ? '' : value);
      }
    }
    if (children !== null && children !== undefined) {
      if (!Array.isArray(children)) children = [children];
      for (const child of children.flat(3)) {
        if (child === null || child === undefined || child === false) continue;
        node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
      }
    }
    return node;
  }

  function svg(id, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    if (cls) s.setAttribute('class', cls);
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + id);
    s.appendChild(use);
    return s;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function debounce(fn, ms) {
    let timer;
    const wrapped = function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, ms);
    };
    wrapped.cancel = function () { clearTimeout(timer); };
    wrapped.flush = function () { clearTimeout(timer); fn.apply(null, arguments); };
    return wrapped;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function fmtClock(ms) {
    const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    if (hours > 0) return hours + ':' + pad2(minutes) + ':' + pad2(seconds);
    return pad2(minutes) + ':' + pad2(seconds);
  }

  function fmtDate(ts) {
    const date = new Date(Number(ts) || Date.now());
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function fmtRelative(ts) {
    const diff = Date.now() - Number(ts || 0);
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return new Date(Number(ts)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  const PALETTE = ['#5eead4', '#f87171', '#fbbf24', '#60a5fa', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#38bdf8', '#c084fc'];

  function colorFor(str) {
    let hash = 0;
    str = String(str || '');
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }

  function initials(str) {
    const parts = String(str || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  // ---------------------------------------------------------------- persistence
  function seedState() {
    const id = uid('tr');
    const now = Date.now();
    return {
      transcripts: [{ id: id, title: 'Untitled', created: now, updated: now, segments: [] }],
      speakers: DEFAULT_SPEAKERS.slice(),
      activeSpeaker: DEFAULT_SPEAKERS[0],
      selectedId: id
    };
  }

  function normalizeState(raw) {
    const out = seedState();
    if (!raw || typeof raw !== 'object') return out;

    if (Array.isArray(raw.transcripts)) {
      const transcripts = raw.transcripts.map(function (t) {
        if (!t || typeof t !== 'object') return null;
        const created = Number(t.created) || Date.now();
        const segments = Array.isArray(t.segments) ? t.segments.map(function (s) {
          if (!s || typeof s !== 'object') return null;
          return {
            id: typeof s.id === 'string' && s.id ? s.id : uid('seg'),
            ts: Number.isFinite(Number(s.ts)) ? Math.max(0, Math.round(Number(s.ts))) : 0,
            speaker: String(s.speaker || 'Speaker 1'),
            text: String(s.text == null ? '' : s.text)
          };
        }).filter(Boolean) : [];
        return {
          id: typeof t.id === 'string' && t.id ? t.id : uid('tr'),
          title: String(t.title || 'Untitled'),
          created: created,
          updated: Number(t.updated) || created,
          segments: segments
        };
      }).filter(Boolean);
      out.transcripts = transcripts;
    }

    const speakers = Array.isArray(raw.speakers) ? raw.speakers
      .filter(function (s) { return typeof s === 'string' && s.trim(); })
      .map(function (s) { return s.trim(); }) : [];
    out.speakers = speakers.length ? Array.from(new Set(speakers)) : DEFAULT_SPEAKERS.slice();
    out.activeSpeaker = out.speakers.indexOf(raw.activeSpeaker) >= 0 ? raw.activeSpeaker : out.speakers[0];
    out.selectedId = out.transcripts.some(function (t) { return t.id === raw.selectedId; })
      ? raw.selectedId
      : (out.transcripts[0] ? out.transcripts[0].id : null);
    return out;
  }

  function loadState() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return seedState();
    try {
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      return seedState();
    }
  }

  let state = loadState();
  let lastSaved = null;
  let searchQuery = '';
  let segCount = 0;
  let editing = false;
  let cancelEditFn = null;
  let backendOnline = null;
  let fileBusy = false;
  let progressText = '';

  function current() {
    if (!state.selectedId) return null;
    for (let i = 0; i < state.transcripts.length; i++) {
      if (state.transcripts[i].id === state.selectedId) return state.transcripts[i];
    }
    return null;
  }

  function findTranscript(id) {
    for (let i = 0; i < state.transcripts.length; i++) {
      if (state.transcripts[i].id === id) return state.transcripts[i];
    }
    return null;
  }

  const save = debounce(saveNow, 250);

  function saveNow() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* unavailable */ }
    lastSaved = Date.now();
    paintSaveState();
  }

  // ---------------------------------------------------------------- DOM refs
  const ui = {
    saveText: document.getElementById('saveText'),
    newBtn: document.getElementById('newBtn'),
    searchInput: document.getElementById('searchInput'),
    transcriptList: document.getElementById('transcriptList'),
    sideCount: document.getElementById('sideCount'),
    ws: document.getElementById('ws'),
    wsEmpty: document.getElementById('wsEmpty'),
    emptyNewBtn: document.getElementById('emptyNewBtn'),
    titleInput: document.getElementById('titleInput'),
    wsMeta: document.getElementById('wsMeta'),
    copyBtn: document.getElementById('copyBtn'),
    mdBtn: document.getElementById('mdBtn'),
    txtBtn: document.getElementById('txtBtn'),
    delBtn: document.getElementById('delBtn'),
    micBtn: document.getElementById('micBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    recDot: document.getElementById('recDot'),
    liveStatus: document.getElementById('liveStatus'),
    clock: document.getElementById('clock'),
    backend: document.getElementById('backend'),
    interim: document.getElementById('interim'),
    fileBtn: document.getElementById('fileBtn'),
    progress: document.getElementById('progress'),
    speakers: document.getElementById('speakers'),
    segments: document.getElementById('segments'),
    addInput: document.getElementById('addInput'),
    addBtn: document.getElementById('addBtn'),
    fileInput: document.getElementById('fileInput'),
    toasts: document.getElementById('toasts'),
    modalRoot: document.getElementById('modalRoot')
  };

  // ---------------------------------------------------------------- toasts / confirm
  function toast(message, opts) {
    opts = opts || {};
    const node = el('div.toast' + (opts.type ? '.' + opts.type : ''));
    if (opts.html) node.innerHTML = message;
    else node.textContent = message;
    node.setAttribute('role', 'status');
    let removed = false;
    const remove = function () {
      if (removed) return;
      removed = true;
      node.classList.add('leaving');
      setTimeout(function () { node.remove(); }, 200);
    };
    node.addEventListener('click', remove);
    ui.toasts.appendChild(node);
    setTimeout(remove, opts.duration || 3200);
  }

  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      let closed = false;
      const close = function (value) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(value);
      };
      const onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
      };
      const cancelBtn = el('button.btn', { type: 'button', text: opts.cancel || 'Cancel' });
      const confirmBtn = el('button.btn' + (opts.danger ? '.danger' : '.primary'), {
        type: 'button',
        text: opts.confirm || 'Confirm'
      });
      cancelBtn.addEventListener('click', function () { close(false); });
      confirmBtn.addEventListener('click', function () { close(true); });

      const box = el('div.modal', { role: 'dialog', 'aria-modal': 'true' }, [
        el('h2', { text: opts.title || 'Are you sure?' }),
        el('p', opts.html ? { html: opts.html } : { text: opts.message || '' }),
        el('div.modal-actions', {}, [cancelBtn, confirmBtn])
      ]);
      const backdrop = el('div.modal-backdrop');
      backdrop.appendChild(box);
      backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(false); });
      ui.modalRoot.appendChild(backdrop);
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () { confirmBtn.focus(); }, 30);
    });
  }

  // ---------------------------------------------------------------- painting
  function paintSaveState() {
    if (!ui.saveText) return;
    if (!lastSaved) { ui.saveText.textContent = 'Saved'; return; }
    const d = new Date(lastSaved);
    ui.saveText.textContent = 'Saved ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function paintBackend() {
    if (!ui.backend) return;
    ui.backend.textContent = backendOnline === null ? 'checking…' : backendOnline ? 'connected' : 'offline';
    ui.backend.className = 'backend-state ' + (backendOnline === null ? 'checking' : backendOnline ? 'ok' : 'bad');
  }

  function setInterim(text) {
    live.interim = text || '';
    if (ui.interim) ui.interim.textContent = live.interim;
  }

  function clockText() {
    if (live.recording) return fmtClock(liveElapsed());
    const t = current();
    const segs = t ? t.segments : [];
    return fmtClock(segs.length ? segs[segs.length - 1].ts : 0);
  }

  function paintLive() {
    if (ui.micBtn) {
      ui.micBtn.classList.toggle('rec', live.recording);
      ui.micBtn.classList.toggle('paused', live.recording && live.paused);
      const use = ui.micBtn.querySelector('use');
      if (use) use.setAttribute('href', live.recording ? '#i-mic-off' : '#i-mic');
      const title = live.recording ? 'Stop recording' : 'Start recording';
      ui.micBtn.title = title;
      ui.micBtn.setAttribute('aria-label', title);
    }
    if (ui.recDot) {
      ui.recDot.classList.toggle('on', live.recording);
      ui.recDot.classList.toggle('paused', !!live.paused);
    }
    if (ui.liveStatus) {
      ui.liveStatus.textContent = !live.recording ? 'Ready' : live.paused ? 'Paused' : 'Listening…';
    }
    if (ui.clock) ui.clock.textContent = clockText();
    if (ui.pauseBtn) {
      ui.pauseBtn.disabled = !live.recording;
      const use = ui.pauseBtn.querySelector('use');
      if (use) use.setAttribute('href', live.paused ? '#i-play' : '#i-pause');
      const label = ui.pauseBtn.querySelector('span');
      if (label) label.textContent = live.paused ? 'Resume' : 'Pause';
      ui.pauseBtn.title = live.paused ? 'Resume recording' : 'Pause recording';
    }
  }

  function paintProgress() {
    if (!ui.progress) return;
    ui.progress.textContent = progressText;
    ui.progress.hidden = !progressText;
  }

  function setProgress(text) {
    progressText = text || '';
    paintProgress();
  }

  function paintMeta() {
    if (!ui.wsMeta) return;
    const t = current();
    if (!t) { ui.wsMeta.textContent = ''; return; }
    const count = t.segments.length;
    ui.wsMeta.textContent = count + (count === 1 ? ' line' : ' lines') + ' · Updated ' + fmtRelative(t.updated);
  }

  function paintSidebarCount() {
    if (ui.sideCount) ui.sideCount.textContent = String(state.transcripts.length);
  }

  function paintList() {
    const list = ui.transcriptList;
    if (!list) return;
    paintSidebarCount();
    list.innerHTML = '';

    const q = searchQuery.trim().toLowerCase();
    const items = state.transcripts.filter(function (t) {
      if (!q) return true;
      if (String(t.title || '').toLowerCase().indexOf(q) >= 0) return true;
      return t.segments.some(function (s) { return String(s.text || '').toLowerCase().indexOf(q) >= 0; });
    }).slice().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); });

    if (!items.length) {
      list.appendChild(el('div.list-empty', {
        text: state.transcripts.length ? 'No transcripts match that search.' : 'No transcripts yet — create one to get started.'
      }));
      return;
    }

    items.forEach(function (t) {
      const del = el('button.t-del', { type: 'button', title: 'Delete transcript', 'aria-label': 'Delete transcript' });
      del.appendChild(svg('trash'));

      const count = t.segments.length;
      const row = el('div.t-item' + (t.id === state.selectedId ? '.active' : ''), {
        role: 'button',
        tabindex: '0',
        title: t.title || 'Untitled'
      }, [
        el('div.t-body', {}, [
          el('span.t-title', { text: t.title || 'Untitled' }),
          el('span.t-meta', { text: count + (count === 1 ? ' line' : ' lines') + ' · ' + fmtRelative(t.updated) })
        ]),
        del
      ]);

      row.addEventListener('click', function () { openTranscript(t.id); });
      row.addEventListener('keydown', function (e) {
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTranscript(t.id); }
      });
      del.addEventListener('click', function (e) { e.stopPropagation(); deleteTranscript(t.id); });
      list.appendChild(row);
    });
  }

  function paintSpeakers() {
    const row = ui.speakers;
    if (!row) return;
    row.innerHTML = '';

    state.speakers.forEach(function (name) {
      const chip = el('button.chip' + (name === state.activeSpeaker ? '.on' : ''), {
        type: 'button',
        text: name,
        title: 'Speak as ' + name
      });
      chip.style.setProperty('--spk', colorFor(name));
      chip.addEventListener('click', function () {
        state.activeSpeaker = name;
        save();
        paintSpeakers();
      });
      row.appendChild(chip);
    });

    const add = el('button.chip.add', { type: 'button', title: 'Add a speaker' });
    add.appendChild(svg('plus'));
    add.appendChild(el('span', { text: 'add speaker' }));
    add.addEventListener('click', addSpeaker);
    row.appendChild(add);
  }

  function segRow(t, seg) {
    const row = el('div.seg', { dataset: { id: seg.id } });
    row.appendChild(el('span.seg-time', { text: fmtClock(seg.ts), title: 'Timestamp' }));

    const color = colorFor(seg.speaker);
    const chip = el('button.seg-speaker', {
      type: 'button',
      text: seg.speaker || 'Speaker 1',
      title: 'Click to change speaker'
    });
    chip.style.setProperty('--spk', color);
    chip.addEventListener('click', function () { cycleSpeaker(t, seg); });
    row.appendChild(chip);

    const text = el('div.seg-text', { text: seg.text || '', title: 'Click to edit' });
    text.addEventListener('click', function () { beginEdit(t, seg, text); });
    row.appendChild(text);

    const del = el('button.seg-del', { type: 'button', title: 'Remove line', 'aria-label': 'Remove line' });
    del.appendChild(svg('close'));
    del.addEventListener('click', function () {
      t.segments = t.segments.filter(function (s) { return s.id !== seg.id; });
      t.updated = Date.now();
      save();
      paintSegments();
      paintList();
      paintMeta();
    });
    row.appendChild(del);
    return row;
  }

  function paintSegments(forceBottom) {
    const list = ui.segments;
    if (!list || editing) return;

    const t = current();
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    const previous = segCount;
    list.innerHTML = '';

    if (!t || !t.segments.length) {
      list.appendChild(el('div.seg-empty', { text: 'Nothing yet — press the mic or type below.' }));
      segCount = 0;
      return;
    }

    t.segments.forEach(function (seg) { list.appendChild(segRow(t, seg)); });
    segCount = t.segments.length;

    const grew = segCount > previous;
    if (forceBottom || (grew && nearBottom)) {
      list.scrollTop = list.scrollHeight;
    }
  }

  function paintWorkspace() {
    cancelActiveEdit();
    const t = current();
    if (!t) {
      ui.ws.hidden = true;
      ui.wsEmpty.hidden = false;
      return;
    }
    ui.ws.hidden = false;
    ui.wsEmpty.hidden = true;
    ui.titleInput.value = t.title || '';
    segCount = 0;
    paintMeta();
    paintSpeakers();
    paintSegments(true);
    paintLive();
  }

  function renderAll() {
    paintList();
    paintWorkspace();
    paintBackend();
    paintProgress();
    paintSaveState();
  }

  // ---------------------------------------------------------------- segment editing
  function beginEdit(t, seg, node) {
    if (editing || !node.isConnected) return;
    editing = true;
    const ta = el('textarea.seg-edit', { rows: 2, value: seg.text || '' });
    node.replaceWith(ta);
    ta.focus();
    try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* ignore */ }

    let done = false;
    const finish = function (saveIt) {
      if (done) return;
      done = true;
      editing = false;
      cancelEditFn = null;
      const value = ta.value.trim();
      if (saveIt && value && value !== seg.text) {
        seg.text = value;
        t.updated = Date.now();
        save();
      }
      if (ta.isConnected) paintSegments();
      paintList();
      paintMeta();
    };

    cancelEditFn = function () { finish(false); };

    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ta.addEventListener('blur', function () { finish(true); });
  }

  function cancelActiveEdit() {
    if (cancelEditFn) {
      const fn = cancelEditFn;
      cancelEditFn = null;
      fn();
    }
    editing = false;
  }

  function cycleSpeaker(t, seg) {
    if (!state.speakers.length) return;
    const index = state.speakers.indexOf(seg.speaker);
    seg.speaker = state.speakers[(index + 1) % state.speakers.length];
    t.updated = Date.now();
    save();
    paintSegments();
    paintList();
  }

  function addSpeaker() {
    const raw = window.prompt('Name for the new speaker:');
    if (raw === null) return;
    const name = raw.trim();
    if (!name) { toast('Speaker name cannot be empty.', { type: 'error' }); return; }
    if (state.speakers.indexOf(name) < 0) state.speakers.push(name);
    state.activeSpeaker = name;
    save();
    paintSpeakers();
    toast('Added “' + name + '”.', { type: 'success' });
  }

  // ---------------------------------------------------------------- transcript actions
  function flushPendingTitle() {
    try { saveTitle.flush(); } catch (e) { /* not initialised yet */ }
  }

  function openTranscript(id) {
    if (!findTranscript(id)) return;
    flushPendingTitle();
    if (live.recording && live.transcriptId !== id) stopRecording();
    if (id === state.selectedId) return;
    state.selectedId = id;
    save();
    paintList();
    paintWorkspace();
  }

  function newTranscript() {
    flushPendingTitle();
    if (live.recording) stopRecording();
    searchQuery = '';
    if (ui.searchInput) ui.searchInput.value = '';
    const now = Date.now();
    const t = { id: uid('tr'), title: 'Untitled', created: now, updated: now, segments: [] };
    state.transcripts.unshift(t);
    state.selectedId = t.id;
    saveNow();
    renderAll();
    ui.titleInput.focus();
    ui.titleInput.select();
  }

  async function deleteTranscript(id) {
    flushPendingTitle();
    const t = findTranscript(id);
    if (!t) return;
    const ok = await confirmDialog({
      title: 'Delete transcript?',
      message: '“' + (t.title || 'Untitled') + '” and all of its lines will be deleted. This cannot be undone.',
      confirm: 'Delete',
      danger: true
    });
    if (!ok) return;

    if (live.recording && live.transcriptId === id) stopRecording();
    state.transcripts = state.transcripts.filter(function (x) { return x.id !== id; });
    if (state.selectedId === id) {
      state.selectedId = state.transcripts[0] ? state.transcripts[0].id : null;
    }
    saveNow();
    renderAll();
    toast('Transcript deleted.');
  }

  function addLine() {
    const t = current();
    if (!t) return;
    const text = ui.addInput.value.trim();
    if (!text) { ui.addInput.focus(); return; }
    const last = t.segments.length ? t.segments[t.segments.length - 1].ts : 0;
    const ts = live.recording && live.transcriptId === t.id ? liveElapsed() : last;
    t.segments.push({
      id: uid('seg'),
      ts: Math.max(0, Math.round(ts)),
      speaker: state.activeSpeaker,
      text: text
    });
    t.updated = Date.now();
    save();
    ui.addInput.value = '';
    paintSegments(true);
    paintList();
    paintMeta();
    ui.addInput.focus();
  }

  // ---------------------------------------------------------------- backend
  async function checkBackend() {
    let ok = false;
    try {
      const res = await fetch(WHISPER_URL + '/health', { cache: 'no-store' });
      ok = !!(res && res.ok);
    } catch (e) {
      ok = false;
    }
    backendOnline = ok;
    paintBackend();
    return ok;
  }

  async function whisperTranscribe(wav) {
    let res;
    try {
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav');
      res = await fetch(WHISPER_URL + '/inference', { method: 'POST', body: form });
    } catch (e) {
      backendOnline = false;
      paintBackend();
      throw e;
    }
    if (!res || !res.ok) {
      backendOnline = false;
      paintBackend();
      throw new Error('Whisper HTTP ' + (res ? res.status : '?'));
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      backendOnline = false;
      paintBackend();
      throw new Error('Whisper returned invalid JSON');
    }
    backendOnline = true;
    paintBackend();
    return data && typeof data.text === 'string' ? data.text : '';
  }

  // ---------------------------------------------------------------- audio helpers
  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  function encodeWav(samplesInt16, sampleRate) {
    const count = samplesInt16.length;
    const buffer = new ArrayBuffer(44 + count * 2);
    const view = new DataView(buffer);
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + count * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);                 // PCM
    view.setUint16(22, 1, true);                 // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);    // byte rate
    view.setUint16(32, 2, true);                 // block align
    view.setUint16(34, 16, true);                // bits per sample
    writeString(view, 36, 'data');
    view.setUint32(40, count * 2, true);
    let offset = 44;
    for (let i = 0; i < count; i++, offset += 2) view.setInt16(offset, samplesInt16[i], true);
    return buffer;
  }

  function floatToInt16(input) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function resampleTo16k(input, fromRate) {
    if (fromRate === SAMPLE_RATE) return input;
    const ratio = fromRate / SAMPLE_RATE;
    const length = Math.max(1, Math.round(input.length / ratio));
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(input.length - 1, i0 + 1);
      const frac = pos - i0;
      out[i] = input[i0] + (input[i1] - input[i0]) * frac;
    }
    return out;
  }

  function concatFloat32(parts) {
    let total = 0;
    parts.forEach(function (p) { total += p.length; });
    const out = new Float32Array(total);
    let offset = 0;
    parts.forEach(function (p) { out.set(p, offset); offset += p.length; });
    return out;
  }

  function downmix(audioBuffer) {
    const channels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    const out = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) out[i] += data[i];
    }
    if (channels > 1) {
      for (let i = 0; i < length; i++) out[i] /= channels;
    }
    return out;
  }

  function wordTokens(s) {
    return String(s || '').match(/\S+/g) || [];
  }

  function normToken(t) {
    return String(t).toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  }

  // Removes words at the start of `next` that repeat the tail of `prev`
  // (the 0.5 s audio overlap between live chunks).
  function dedupeOverlap(prev, next) {
    if (!prev || !next) return next;
    const pw = wordTokens(prev).map(normToken);
    const nw = wordTokens(next);
    const nn = nw.map(normToken);
    const max = Math.min(pw.length, nn.length, 10);
    let k = 0;
    for (let n = max; n >= 1; n--) {
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (!nn[i] || pw[pw.length - n + i] !== nn[i]) { ok = false; break; }
      }
      if (ok) { k = n; break; }
    }
    if (!k) return next;
    let seen = 0;
    let idx = 0;
    for (; idx < nw.length; idx++) {
      if (nn[idx]) seen++;
      if (seen >= k) { idx++; break; }
    }
    return nw.slice(idx).join(' ').trim();
  }

  // ---------------------------------------------------------------- live engine
  const live = {
    recording: false,
    paused: false,
    transcriptId: null,
    startedAt: 0,
    resumedAt: 0,
    baseElapsed: 0,
    interim: ''
  };

  const capture = {
    stream: null,
    ctx: null,
    source: null,
    processor: null,
    rate: 0,
    blocks: [],
    overlap: null,
    sinceFlush: 0,
    totalSamples: 0,
    queue: Promise.resolve(),
    session: null
  };

  function liveElapsed() {
    return live.baseElapsed + (live.recording && !live.paused ? Date.now() - live.resumedAt : 0);
  }

  function updateSessionInterim(session) {
    if (!live.recording || capture.session !== session) {
      setInterim('');
      return;
    }
    setInterim(session.pending ? 'Transcribing…' : (session.lastText || ''));
  }

  function pendingInc(session) {
    if (!session) return;
    session.pending = (session.pending || 0) + 1;
    updateSessionInterim(session);
  }

  function pendingDec(session) {
    if (!session) return;
    session.pending = Math.max(0, (session.pending || 0) - 1);
    updateSessionInterim(session);
  }

  function appendChunkText(session, text, ts, speaker) {
    const t = findTranscript(session.id);
    if (!t) return;
    let clean = String(text || '').trim();
    if (!clean) return;
    clean = dedupeOverlap(session.prevText, clean);
    if (!clean) return;

    session.prevText = clean;
    session.lastText = clean;
    t.segments.push({
      id: uid('seg'),
      ts: Math.max(0, Math.round(ts)),
      speaker: speaker || state.activeSpeaker,
      text: clean
    });
    t.updated = Date.now();
    save();
    paintSegments();
    paintList();
    paintMeta();
  }

  function backendFailed() {
    backendOnline = false;
    paintBackend();
    if (live.recording) {
      live.recording = false;
      live.paused = false;
      stopCapture();
      setInterim('');
      paintLive();
    }
    toast('Whisper backend not running — start the server', { type: 'error', duration: 5000 });
  }

  function flushChunk() {
    if (!capture.ctx || !capture.blocks.length || !capture.rate) return;
    const session = capture.session;
    const parts = [];
    if (capture.overlap && capture.overlap.length) parts.push(capture.overlap);
    capture.blocks.forEach(function (b) { parts.push(b); });
    const all = concatFloat32(parts);
    const startSec = Math.max(0, (capture.totalSamples - all.length) / capture.rate);
    const wav = encodeWav(floatToInt16(resampleTo16k(all, capture.rate)), SAMPLE_RATE);

    const keep = Math.max(0, Math.min(Math.round(capture.rate * OVERLAP_SECONDS), all.length));
    capture.overlap = all.slice(all.length - keep);
    capture.blocks = [];
    capture.sinceFlush = 0;

    if (!session) return;
    const speaker = state.activeSpeaker;
    pendingInc(session);
    capture.queue = capture.queue.then(async function () {
      try {
        const text = await whisperTranscribe(wav);
        appendChunkText(session, text, startSec * 1000, speaker);
      } catch (e) {
        backendFailed();
      } finally {
        pendingDec(session);
      }
    });
  }

  function stopCapture() {
    try { if (capture.processor) capture.processor.disconnect(); } catch (e) { /* ignore */ }
    try { if (capture.source) capture.source.disconnect(); } catch (e) { /* ignore */ }
    try {
      if (capture.stream) capture.stream.getTracks().forEach(function (tr) { tr.stop(); });
    } catch (e) { /* ignore */ }
    const ctx = capture.ctx;
    capture.stream = null;
    capture.ctx = null;
    capture.source = null;
    capture.processor = null;
    capture.rate = 0;
    capture.blocks = [];
    capture.overlap = null;
    capture.sinceFlush = 0;
    capture.totalSamples = 0;
    if (ctx && typeof ctx.close === 'function') {
      try { ctx.close(); } catch (e) { /* ignore */ }
    }
  }

  async function startRecording(transcriptId) {
    const t = findTranscript(transcriptId);
    if (!t) return;
    if (fileBusy) { toast('Wait for the file transcription to finish.'); return; }
    if (live.recording) {
      if (live.transcriptId === transcriptId) return;
      stopRecording();
    }

    const media = navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
      toast('Microphone capture is not available in this browser.', { type: 'error' });
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      toast('Audio capture is not available in this browser.', { type: 'error' });
      return;
    }

    live.transcriptId = transcriptId;
    live.recording = true;
    live.paused = false;
    live.startedAt = Date.now();
    live.resumedAt = live.startedAt;
    live.baseElapsed = 0;
    capture.blocks = [];
    capture.overlap = null;
    capture.sinceFlush = 0;
    capture.totalSamples = 0;
    capture.queue = Promise.resolve();
    capture.session = { id: transcriptId, prevText: '', lastText: '', pending: 0 };
    setInterim('');
    paintLive();

    let stream = null;
    let ctx = null;
    try {
      ctx = new AudioCtx();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        try { await ctx.resume(); } catch (e) { /* ignore */ }
      }
      stream = await media.getUserMedia({ audio: true });
    } catch (err) {
      try { if (stream) stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) { /* ignore */ }
      try { if (ctx && typeof ctx.close === 'function') ctx.close(); } catch (e) { /* ignore */ }
      live.recording = false;
      live.paused = false;
      paintLive();
      toast(err && err.name === 'NotAllowedError' ? 'Microphone permission denied.' : 'Could not access the microphone.', { type: 'error' });
      return;
    }

    if (!live.recording || live.transcriptId !== transcriptId) {
      try { stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) { /* ignore */ }
      try { if (ctx && typeof ctx.close === 'function') ctx.close(); } catch (e) { /* ignore */ }
      return;
    }

    try {
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      if (!processor) throw new Error('ScriptProcessor unavailable');

      capture.stream = stream;
      capture.ctx = ctx;
      capture.source = source;
      capture.processor = processor;
      capture.rate = ctx.sampleRate;

      processor.onaudioprocess = function (e) {
        if (!live.recording || live.paused || !capture.ctx) return;
        const input = e.inputBuffer;
        const channels = input.numberOfChannels;
        const length = input.length;
        let mono;
        if (channels === 1) {
          mono = new Float32Array(input.getChannelData(0));
        } else {
          mono = new Float32Array(length);
          for (let c = 0; c < channels; c++) {
            const data = input.getChannelData(c);
            for (let i = 0; i < length; i++) mono[i] += data[i];
          }
          for (let i = 0; i < length; i++) mono[i] /= channels;
        }
        capture.blocks.push(mono);
        capture.totalSamples += length;
        capture.sinceFlush += length;
        if (capture.sinceFlush >= capture.rate * LIVE_CHUNK_SECONDS) flushChunk();
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      checkBackend();
    } catch (err) {
      live.recording = false;
      live.paused = false;
      try { stream.getTracks().forEach(function (tr) { tr.stop(); }); } catch (e) { /* ignore */ }
      try { if (ctx && typeof ctx.close === 'function') ctx.close(); } catch (e) { /* ignore */ }
      stopCapture();
      paintLive();
      toast('Could not start audio capture.', { type: 'error' });
    }
  }

  function stopRecording() {
    if (live.recording && capture.blocks.length) {
      try { flushChunk(); } catch (e) { /* ignore */ }
    }
    live.recording = false;
    live.paused = false;
    stopCapture();
    setInterim('');
    paintLive();
    paintMeta();
    paintList();
  }

  function pauseRecording() {
    if (!live.recording || live.paused) return;
    live.baseElapsed += Date.now() - live.resumedAt;
    live.paused = true;
    paintLive();
  }

  function resumeRecording() {
    if (!live.recording || !live.paused) return;
    live.resumedAt = Date.now();
    live.paused = false;
    paintLive();
  }

  // ---------------------------------------------------------------- file transcription
  function readFileBuffer(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('read failed')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function decodeAudio(ctx, buffer) {
    return new Promise(function (resolve, reject) {
      const maybe = ctx.decodeAudioData(buffer, resolve, reject);
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
    });
  }

  async function transcribeFile(file) {
    if (!file || fileBusy) return;
    if (live.recording) { toast('Stop the live recorder first.', { type: 'error' }); return; }
    const t = current();
    if (!t) return;

    fileBusy = true;
    if (ui.fileBtn) ui.fileBtn.disabled = true;
    let ctx = null;
    let backendError = false;
    setProgress('Reading file…');

    try {
      const buffer = await readFileBuffer(file);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('AudioContext unavailable');
      ctx = new AudioCtx();
      const audio = await decodeAudio(ctx, buffer);
      const mono = downmix(audio);
      const pcm = resampleTo16k(mono, audio.sampleRate);
      if (!pcm.length) throw new Error('empty audio');

      const chunkLength = SAMPLE_RATE * FILE_CHUNK_SECONDS;
      const total = Math.max(1, Math.ceil(pcm.length / chunkLength));

      for (let i = 0; i < total; i++) {
        const start = i * chunkLength;
        const end = Math.min(pcm.length, start + chunkLength);
        const slice = pcm.subarray(start, end);
        if (!slice.length) continue;

        setProgress('Transcribing ' + (i + 1) + '/' + total + '…');
        const wav = encodeWav(floatToInt16(slice), SAMPLE_RATE);
        let text;
        try {
          text = await whisperTranscribe(wav);
        } catch (e) {
          backendError = true;
          backendOnline = false;
          paintBackend();
          throw e;
        }

        const clean = String(text || '').trim();
        if (clean) {
          const active = findTranscript(t.id);
          if (!active) break;
          active.segments.push({
            id: uid('seg'),
            ts: i * FILE_CHUNK_SECONDS * 1000,
            speaker: state.activeSpeaker,
            text: clean
          });
          active.updated = Date.now();
          save();
          paintSegments();
          paintList();
          paintMeta();
        }
      }
      toast('Transcription complete.', { type: 'success' });
    } catch (e) {
      if (backendError) toast('Whisper backend not running — start the server', { type: 'error', duration: 5000 });
      else toast('Could not decode that audio file.', { type: 'error' });
    } finally {
      try { if (ctx && typeof ctx.close === 'function') ctx.close(); } catch (e) { /* ignore */ }
      fileBusy = false;
      if (ui.fileBtn) ui.fileBtn.disabled = false;
      setProgress('');
    }
  }

  function pickFile() {
    if (fileBusy) return;
    if (live.recording) { toast('Stop the live recorder first.', { type: 'error' }); return; }
    ui.fileInput.value = '';
    ui.fileInput.click();
  }

  // ---------------------------------------------------------------- export
  function toText(t) {
    const lines = [t.title || 'Untitled', fmtDate(t.created || Date.now()), ''];
    (t.segments || []).forEach(function (seg) {
      lines.push('[' + fmtClock(seg.ts) + '] ' + (seg.speaker || 'Speaker 1') + ': ' + (seg.text || ''));
    });
    return lines.join('\n') + '\n';
  }

  function toMarkdown(t) {
    const lines = ['# ' + (t.title || 'Untitled'), '', '_' + fmtDate(t.created || Date.now()) + '_', ''];
    (t.segments || []).forEach(function (seg) {
      lines.push('**' + (seg.speaker || 'Speaker 1') + '** `' + fmtClock(seg.ts) + '` ' + (seg.text || ''));
    });
    return lines.join('\n') + '\n';
  }

  function slugify(text) {
    return String(text || 'transcript').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'transcript';
  }

  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function copyText(text, message) {
    const ok = function () { toast(message || 'Copied to clipboard.', { type: 'success' }); };
    const fallback = function () {
      const ta = el('textarea', { style: { position: 'fixed', left: '-9999px', top: '0', opacity: '0' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let copied = false;
      try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
      ta.remove();
      toast(copied ? (message || 'Copied to clipboard.') : 'Copy failed — select the text manually.', { type: copied ? 'success' : 'error' });
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(ok).catch(fallback);
    } else {
      fallback();
    }
  }

  // ---------------------------------------------------------------- wiring
  const saveTitle = debounce(function () {
    const t = current();
    if (!t) return;
    const value = ui.titleInput.value.trim() || 'Untitled';
    if (value !== t.title) {
      t.title = value;
      t.updated = Date.now();
      save();
      paintList();
      paintMeta();
    }
  }, 350);

  ui.titleInput.addEventListener('input', saveTitle);
  ui.titleInput.addEventListener('blur', function () {
    saveTitle.flush();
    const t = current();
    if (t) ui.titleInput.value = t.title || 'Untitled';
  });
  ui.titleInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveTitle.flush(); ui.titleInput.blur(); }
  });

  ui.searchInput.addEventListener('input', debounce(function () {
    searchQuery = ui.searchInput.value;
    paintList();
  }, 90));

  ui.newBtn.addEventListener('click', newTranscript);
  ui.emptyNewBtn.addEventListener('click', newTranscript);

  ui.micBtn.addEventListener('click', function () {
    if (live.recording) { stopRecording(); return; }
    const t = current();
    if (!t) return;
    startRecording(t.id);
  });

  ui.pauseBtn.addEventListener('click', function () {
    if (!live.recording) return;
    if (live.paused) resumeRecording();
    else pauseRecording();
  });

  ui.fileBtn.addEventListener('click', pickFile);
  ui.fileInput.addEventListener('change', function () {
    const file = ui.fileInput.files && ui.fileInput.files[0];
    if (file) transcribeFile(file);
    ui.fileInput.value = '';
  });

  ui.copyBtn.addEventListener('click', function () {
    const t = current();
    if (!t) return;
    copyText(toText(t), 'Transcript copied to clipboard.');
  });

  ui.mdBtn.addEventListener('click', function () {
    const t = current();
    if (!t) return;
    downloadText(toMarkdown(t), slugify(t.title) + '.md', 'text/markdown;charset=utf-8');
    toast('Markdown exported.', { type: 'success' });
  });

  ui.txtBtn.addEventListener('click', function () {
    const t = current();
    if (!t) return;
    downloadText(toText(t), slugify(t.title) + '.txt', 'text/plain;charset=utf-8');
    toast('Text file exported.', { type: 'success' });
  });

  ui.delBtn.addEventListener('click', function () {
    const t = current();
    if (t) deleteTranscript(t.id);
  });

  ui.addBtn.addEventListener('click', addLine);
  ui.addInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addLine(); }
  });

  // ---------------------------------------------------------------- init
  if (!ui.transcriptList) {
    // The markup is missing; there is nothing sensible to do.
    return;
  }

  // Seed/persist the current shape on first run.
  saveNow();
  renderAll();
  paintLive();
  checkBackend();

  // Keep the elapsed clock warm even when nothing else changes.
  setInterval(function () {
    if (ui.clock) ui.clock.textContent = clockText();
  }, 500);

  // Refresh relative timestamps once a minute.
  setInterval(function () {
    if (document.visibilityState === 'visible' && !editing) paintList();
  }, 60000);

  // Backend availability poll (the only other network call besides inference).
  setInterval(checkBackend, 20000);

  window.addEventListener('beforeunload', function () {
    flushPendingTitle();
    saveNow();
    if (live.recording) {
      live.recording = false;
      try { stopCapture(); } catch (e) { /* ignore */ }
    }
  });
})();

let downloading = false;
let eventSource = null;
let currentSessionId = null;

// Preview & Debounce state
let previewTimer = null;
let previewController = null;
let lastPreviewUrl = '';

// Console optimization state
const MAX_LOG_LINES = 500;
let pendingLogs = [];
let logFlushScheduled = false;
let autoScrollLog = true;

const STORAGE_KEY = 'ytdlp_gui_settings_v1';

// ── Fetch environment status on startup ──
async function loadEnvStatus() {
    try {
        const res = await fetch('/status');
        const info = await res.json();

        const verBadge = document.getElementById('badge-version');
        if (verBadge && info.ytdlp_version) {
            verBadge.textContent = `yt-dlp ${info.ytdlp_version}`;
            verBadge.classList.add('ok');
        }

        const ffBadge = document.getElementById('badge-ffmpeg');
        if (ffBadge) {
            ffBadge.classList.toggle('ok', !!info.has_ffmpeg);
            ffBadge.classList.toggle('missing', !info.has_ffmpeg);
            ffBadge.title = info.has_ffmpeg
                ? 'FFmpeg detectado en el sistema'
                : 'FFmpeg no encontrado en PATH (necesario para unir vídeo/audio y convertir formatos)';
        }

        const denoBadge = document.getElementById('badge-deno');
        if (denoBadge) {
            denoBadge.classList.toggle('ok', !!info.has_deno);
            denoBadge.classList.toggle('warn', !info.has_deno);
            denoBadge.title = info.has_deno
                ? 'Deno detectado en el sistema'
                : 'Deno no encontrado en PATH (recomendado para resolver retos JS de YouTube)';
        }

        const cookiesBadge = document.getElementById('badge-cookies');
        if (cookiesBadge) {
            cookiesBadge.classList.toggle('ok', !!info.has_cookies);
            cookiesBadge.classList.toggle('warn', !info.has_cookies);
            cookiesBadge.title = info.has_cookies
                ? 'Archivo www.youtube.com_cookies.txt activo'
                : 'Sin archivo www.youtube.com_cookies.txt (opcional, útil para vídeos con restricción)';
        }

        const outInput = document.getElementById('output_dir');
        if (outInput && info.default_dir && !outInput.value) {
            outInput.placeholder = `Default: ${info.default_dir}`;
        }
    } catch (e) {
        console.warn('Could not load status info:', e);
    }
}

// ── Persistence (localStorage) ──
const SETTING_IDS = [
    'media_type', 'audio_format', 'audio_quality', 'video_format', 'video_quality', 'video_codec',
    'embed_metadata', 'embed_thumbnail', 'square_thumbnail', 'is_playlist', 'number_playlist',
    'use_archive', 'write_subs', 'write_auto_subs', 'embed_subs',
    'sub_langs', 'archive_file', 'output_dir'
];

function saveSettings() {
    try {
        const data = {};
        SETTING_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            data[id] = el.type === 'checkbox' ? el.checked : el.value;
        });
        const controlsCol = document.querySelector('.controls-col');
        if (controlsCol && controlsCol.style.width) {
            data._splitter_width = controlsCol.style.width;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('Could not save settings:', e);
    }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);

        SETTING_IDS.forEach(id => {
            if (!(id in data)) return;
            const el = document.getElementById(id);
            if (!el) return;
            if (el.type === 'checkbox') {
                el.checked = !!data[id];
                const card = el.closest('.check-card');
                if (card) card.classList.toggle('active', el.checked);
            } else {
                el.value = data[id];
            }
        });

        if (data.media_type) {
            document.querySelectorAll('.mode-tab').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === data.media_type);
            });
        }

        if (data._splitter_width && window.innerWidth > 860) {
            const controlsCol = document.querySelector('.controls-col');
            if (controlsCol) controlsCol.style.width = data._splitter_width;
        }
    } catch (e) {
        console.warn('Could not load saved settings:', e);
    }
}

function resetSettings() {
    localStorage.removeItem(STORAGE_KEY);
    document.getElementById('audio_format').value = 'mp3';
    document.getElementById('audio_quality').value = '0';
    document.getElementById('video_format').value = 'mp4';
    document.getElementById('video_quality').value = '1080';
    document.getElementById('video_codec').value = 'av1';

    const defaultChecks = {
        embed_metadata: true,
        embed_thumbnail: true,
        square_thumbnail: true,
        is_playlist: false,
        number_playlist: false,
        use_archive: false,
        write_subs: true,
        write_auto_subs: true,
        embed_subs: true,
    };

    Object.entries(defaultChecks).forEach(([id, val]) => {
        const cb = document.getElementById(id);
        if (cb) {
            cb.checked = val;
            const card = cb.closest('.check-card');
            if (card) card.classList.toggle('active', val);
        }
    });

    document.getElementById('sub_langs').value = 'es.*,en.*';
    document.getElementById('archive_file').value = '';
    document.getElementById('output_dir').value = '';
    document.querySelector('.controls-col').style.width = '';

    selectMediaMode('audio');
    addLog('Settings restored to defaults', 'info');
}

// ── Initialize checkbox cards & change listeners ──
document.querySelectorAll('.check-card').forEach(card => {
    const cb = card.querySelector('input[type="checkbox"]');
    if (!cb) return;

    card.classList.toggle('active', cb.checked);

    cb.addEventListener('change', () => {
        card.classList.toggle('active', cb.checked);
        updateDependentOptions();
        saveSettings();
    });
});

['audio_format', 'audio_quality', 'video_format', 'video_quality', 'video_codec', 'sub_langs', 'archive_file', 'output_dir'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveSettings);
});

// ── Media mode tabs & dependent options ──
function selectMediaMode(mode) {
    const select = document.getElementById('media_type');
    select.value = mode;

    document.querySelectorAll('.mode-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    updateMediaOptions();
    saveSettings();
}

function updateMediaOptions() {
    const mediaType = document.getElementById('media_type').value;
    const isAudioOnly = mediaType === 'audio';
    const isVideoMode = mediaType === 'video' || mediaType === 'both';

    document.getElementById('audio-format-field').style.display  = isAudioOnly ? '' : 'none';
    document.getElementById('audio-quality-field').style.display = isAudioOnly ? '' : 'none';

    document.getElementById('video-format-field').style.display  = isVideoMode ? '' : 'none';
    document.getElementById('video-quality-field').style.display = isVideoMode ? '' : 'none';
    document.getElementById('video-codec-field').style.display   = isVideoMode ? '' : 'none';

    const hint = document.getElementById('media-mode-hint');
    if (hint) {
        if (mediaType === 'audio') hint.textContent = 'Extract audio stream only';
        else if (mediaType === 'both') hint.textContent = 'Best video + audio merged';
        else hint.textContent = 'Video stream only (no audio track)';
    }

    updateDependentOptions();
}

function updateDependentOptions() {
    const mediaType = document.getElementById('media_type').value;
    const embedThumb = document.getElementById('embed_thumbnail').checked;
    const isPlaylist = document.getElementById('is_playlist').checked;
    const useArchive = document.getElementById('use_archive').checked;
    const writeSubs = document.getElementById('write_subs').checked;
    const writeAutoSubs = document.getElementById('write_auto_subs').checked;
    const anySubs = writeSubs || writeAutoSubs;

    document.getElementById('chk-square-thumb').style.display =
        (mediaType === 'audio' && embedThumb) ? '' : 'none';

    document.getElementById('archive-field').style.display = useArchive ? '' : 'none';
    document.getElementById('chk-index').classList.toggle('dimmed', !isPlaylist);

    document.getElementById('subs-langs-field').style.display = anySubs ? '' : 'none';
    document.getElementById('chk-embedsubs').style.display =
        (anySubs && mediaType !== 'audio') ? '' : 'none';
}

// ── Live Media Preview & Auto Playlist Detection ──
function checkPlaylistUrl(url) {
    if (!url) return;
    if (/[?&]list=[^&]+/.test(url)) {
        const cb = document.getElementById('is_playlist');
        if (cb && !cb.checked && url.includes('/playlist?')) {
            cb.checked = true;
            const card = cb.closest('.check-card');
            if (card) card.classList.add('active');
            updateDependentOptions();
            saveSettings();
            addLog('ℹ Playlist link detected — Playlist mode enabled', 'info');
        }
    }
}

function triggerPreview(force = false) {
    const url = document.getElementById('url').value.trim();
    const previewEl = document.getElementById('media-preview');

    if (!url || !/^https?:\/\//i.test(url)) {
        previewEl.style.display = 'none';
        lastPreviewUrl = '';
        return;
    }

    checkPlaylistUrl(url);

    if (!force && url === lastPreviewUrl) return;

    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => fetchMediaPreview(url), force ? 0 : 450);
}

async function fetchMediaPreview(url) {
    if (previewController) {
        previewController.abort();
    }
    previewController = new AbortController();
    lastPreviewUrl = url;

    const previewEl = document.getElementById('media-preview');
    const titleEl = document.getElementById('preview-title');
    const uploaderEl = document.getElementById('preview-uploader');
    const thumbEl = document.getElementById('preview-thumb');
    const durEl = document.getElementById('preview-duration');
    const badgeEl = document.getElementById('preview-badge');

    previewEl.style.display = 'flex';
    previewEl.classList.add('loading');
    titleEl.textContent = 'Fetching media info...';
    uploaderEl.textContent = url;
    durEl.style.display = 'none';
    badgeEl.textContent = 'LOADING';
    badgeEl.classList.remove('playlist');

    try {
        const res = await fetch('/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal: previewController.signal,
        });
        const info = await res.json();
        previewEl.classList.remove('loading');

        if (!res.ok || info.error) {
            previewEl.style.display = 'none';
            return;
        }

        titleEl.textContent = info.title || 'Untitled';
        uploaderEl.textContent = info.uploader || 'Unknown channel';

        if (info.thumbnail) {
            thumbEl.src = info.thumbnail;
            thumbEl.style.display = 'block';
        } else {
            thumbEl.style.display = 'none';
        }

        if (info.duration) {
            durEl.textContent = info.duration;
            durEl.style.display = 'block';
        } else {
            durEl.style.display = 'none';
        }

        const platformPrefix = info.platform ? `${info.platform.toUpperCase()} • ` : '';
        if (info.is_playlist) {
            badgeEl.textContent = info.playlist_count
                ? `${platformPrefix}PLAYLIST • ${info.playlist_count} ITEMS`
                : `${platformPrefix}PLAYLIST`;
            badgeEl.classList.add('playlist');
        } else {
            badgeEl.textContent = `${platformPrefix}VIDEO`;
            badgeEl.classList.remove('playlist');
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            previewEl.classList.remove('loading');
            previewEl.style.display = 'none';
        }
    }
}

const urlInput = document.getElementById('url');
urlInput.addEventListener('input', () => triggerPreview(false));
urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !downloading) {
        e.preventDefault();
        startDownload();
    }
});

// ── Drag & Drop URL support ──
(() => {
    const overlay = document.getElementById('drop-overlay');
    let dragDepth = 0;

    window.addEventListener('dragenter', e => {
        e.preventDefault();
        dragDepth++;
        overlay.classList.add('active');
    });

    window.addEventListener('dragover', e => {
        e.preventDefault();
    });

    window.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) overlay.classList.remove('active');
    });

    window.addEventListener('drop', e => {
        e.preventDefault();
        dragDepth = 0;
        overlay.classList.remove('active');

        const droppedUrl = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
        if (droppedUrl && /^https?:\/\//i.test(droppedUrl)) {
            urlInput.value = droppedUrl;
            triggerPreview(true);
            addLog('Dropped URL loaded', 'info');
        }
    });
})();

// ── Resizable Splitter ──
(() => {
    const splitter = document.getElementById('splitter');
    const mainLayout = document.querySelector('.main-layout');
    const controlsCol = document.querySelector('.controls-col');

    const MIN_WIDTH = 320;
    const MIN_RIGHT = 240;
    let isResizing = false;

    splitter.addEventListener('mousedown', () => {
        if (window.innerWidth <= 860) return;
        isResizing = true;
        splitter.classList.add('active');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const mainRect = mainLayout.getBoundingClientRect();
        const leftX = e.clientX - mainRect.left;
        const mainWidth = mainRect.width;

        const newLeftWidth = Math.max(MIN_WIDTH, Math.min(leftX, mainWidth - MIN_RIGHT - 5));
        controlsCol.style.width = newLeftWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            splitter.classList.remove('active');
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
            saveSettings();
        }
    });
})();

// ── URL helpers ──
function clearUrl() {
    urlInput.value = '';
    document.getElementById('media-preview').style.display = 'none';
    lastPreviewUrl = '';
    urlInput.focus();
}

async function pasteUrl() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            urlInput.value = text.trim();
            urlInput.focus();
            triggerPreview(true);
        }
    } catch (err) {
        addLog('⚠ Could not read clipboard automatically (use Ctrl+V)', 'warn');
    }
}

// ── Browse & Open folder ──
async function browseFolder() {
    try {
        const res = await fetch('/browse');
        const data = await res.json();
        if (data.folder) {
            document.getElementById('output_dir').value = data.folder;
            saveSettings();
        } else if (data.error) {
            addLog('⚠ Error opening folder browser: ' + data.error, 'warn');
        }
    } catch (err) {
        console.error('Error opening folder browser:', err);
    }
}

async function openOutputFolder() {
    const folder = document.getElementById('output_dir').value.trim();
    try {
        const res = await fetch('/open-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder })
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            addLog('⚠ ' + (data.error || 'Could not open folder'), 'warn');
        }
    } catch (err) {
        addLog('⚠ Error opening folder: ' + err.message, 'warn');
    }
}

// ── UPDATE TOOL ──
async function updateTool() {
    if (downloading) return;

    const btn = document.getElementById('btn-update');
    btn.disabled = true;
    btn.innerHTML = '<span class="update-icon">↻</span> UPDATING...';

    addLog('Updating yt-dlp & yt-dlp-ejs via pip...', 'info');
    setStatus('running');

    try {
        const res = await fetch('/update', { method: 'POST' });
        const data = await res.json();
        if (data.error) {
            addLog('✗ ' + data.error, 'error');
            setStatus('error');
            resetUpdateBtn();
            return;
        }

        currentSessionId = data.session_id;
        const es = new EventSource('/progress/' + data.session_id);
        eventSource = es;

        es.onmessage = e => {
            const msg = JSON.parse(e.data);
            let terminate = false;
            switch (msg.type) {
                case 'log':
                    addLog(msg.msg);
                    break;
                case 'done':
                    addLog(msg.msg, 'done');
                    setStatus('done');
                    if (msg.version) {
                        const verBadge = document.getElementById('badge-version');
                        if (verBadge) verBadge.textContent = `yt-dlp ${msg.version}`;
                    }
                    terminate = true;
                    break;
                case 'cancelled':
                    addLog(msg.msg, 'warn');
                    setStatus('idle');
                    terminate = true;
                    break;
                case 'error':
                    addLog('✗ ' + msg.msg, 'error');
                    setStatus('error');
                    terminate = true;
                    break;
                case 'end':
                    terminate = true;
                    break;
            }
            if (terminate) {
                es.close();
                resetUpdateBtn();
                eventSource = null;
                currentSessionId = null;
            }
        };
        es.onerror = () => {
            addLog('Connection to server lost', 'error');
            setStatus('error');
            es.close();
            resetUpdateBtn();
            eventSource = null;
            currentSessionId = null;
        };

    } catch (err) {
        addLog('Error: ' + err.message, 'error');
        setStatus('error');
        resetUpdateBtn();
    }
}

function resetUpdateBtn() {
    const btn = document.getElementById('btn-update');
    btn.disabled = false;
    btn.innerHTML = '<span class="update-icon">↻</span> UPDATE TOOL';
}

// ── Console Log Helpers (Batched & Capped DOM) ──
const logEl = document.getElementById('log');
const scrollBtn = document.getElementById('btn-scroll-bottom');

logEl.addEventListener('scroll', () => {
    const distanceFromBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight;
    autoScrollLog = distanceFromBottom < 32;
    scrollBtn.style.display = autoScrollLog ? 'none' : 'block';
});

function scrollToLogBottom() {
    autoScrollLog = true;
    logEl.scrollTop = logEl.scrollHeight;
    scrollBtn.style.display = 'none';
}

function addLog(msg, type = 'default') {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    pendingLogs.push({ time, msg, type });

    if (!logFlushScheduled) {
        logFlushScheduled = true;
        requestAnimationFrame(flushLogs);
    }
}

function flushLogs() {
    logFlushScheduled = false;
    if (!pendingLogs.length) return;

    const empty = logEl.querySelector('.log-empty');
    if (empty) empty.remove();

    const frag = document.createDocumentFragment();
    for (const item of pendingLogs) {
        const line = document.createElement('div');
        line.className = 'log-line';
        line.innerHTML = `<span class="log-time">${item.time}</span><span class="log-msg type-${item.type}">${escHtml(item.msg)}</span>`;
        frag.appendChild(line);
    }
    pendingLogs = [];
    logEl.appendChild(frag);

    while (logEl.children.length > MAX_LOG_LINES) {
        logEl.removeChild(logEl.firstElementChild);
    }

    if (autoScrollLog) {
        logEl.scrollTop = logEl.scrollHeight;
    }
}

async function copyLog() {
    const lines = Array.from(logEl.querySelectorAll('.log-line')).map(el => {
        const t = el.querySelector('.log-time')?.textContent || '';
        const m = el.querySelector('.log-msg')?.textContent || '';
        return `${t} ${m}`;
    });
    if (!lines.length) return;

    try {
        await navigator.clipboard.writeText(lines.join('\n'));
        const btn = document.getElementById('btn-copy-log');
        const prev = btn.textContent;
        btn.textContent = 'copied!';
        setTimeout(() => { btn.textContent = prev; }, 1200);
    } catch (e) {
        addLog('⚠ Could not copy log to clipboard', 'warn');
    }
}

function clearLog() {
    pendingLogs = [];
    logEl.innerHTML =
        '<div class="log-empty"><span class="log-arrow">←</span>Paste a URL, choose your options and press <strong>DOWNLOAD</strong></div>';
    document.getElementById('progress-section').classList.remove('visible');
    scrollBtn.style.display = 'none';
    autoScrollLog = true;
    setStatus('idle');
}

function escHtml(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setStatus(s) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-label');
    dot.className = 'status-dot' + (s !== 'idle' ? ' ' + s : '');
    if (label) {
        const map = { idle: '(idle)', running: '(running)', done: '(completed)', error: '(error)' };
        label.textContent = map[s] || '(idle)';
    }
}

function setProgress(percent, speed, eta, filename) {
    const pct = parseFloat(percent) || 0;
    document.getElementById('progress-bar').style.width = Math.min(100, Math.max(0, pct)) + '%';
    document.getElementById('prog-percent').textContent = percent;
    document.getElementById('prog-speed').textContent = speed;
    document.getElementById('prog-eta').textContent = eta;
    if (filename) document.getElementById('prog-filename').textContent = filename;
    document.getElementById('progress-section').classList.add('visible');
}

function setDownloading(state) {
    downloading = state;
    const btnD = document.getElementById('btn-download');
    const btnS = document.getElementById('btn-stop');
    btnD.disabled = state;
    btnD.textContent = state ? '⏳ DOWNLOADING...' : '⬇ DOWNLOAD';
    btnS.style.display = state ? 'block' : 'none';
}

// ── Download ──
async function startDownload() {
    const url = urlInput.value.trim();
    if (!url) {
        addLog('⚠ Enter a URL first', 'warn');
        urlInput.focus();
        return;
    }

    const mediaType = document.getElementById('media_type').value;

    setDownloading(true);
    setStatus('running');
    addLog(`Starting download [${mediaType.toUpperCase()}]...`, 'info');
    addLog('URL: ' + url);

    const payload = {
        url,
        media_type:       mediaType,
        audio_only:       mediaType === 'audio',
        video_format:     document.getElementById('video_format').value,
        video_quality:    document.getElementById('video_quality').value,
        video_codec:      document.getElementById('video_codec').value,
        audio_format:     document.getElementById('audio_format').value,
        audio_quality:    document.getElementById('audio_quality').value,
        embed_metadata:   document.getElementById('embed_metadata').checked,
        embed_thumbnail:  document.getElementById('embed_thumbnail').checked,
        square_thumbnail: document.getElementById('square_thumbnail').checked,
        write_subs:       document.getElementById('write_subs').checked,
        write_auto_subs:  document.getElementById('write_auto_subs').checked,
        embed_subs:       document.getElementById('embed_subs').checked,
        sub_langs:        document.getElementById('sub_langs').value.trim(),
        is_playlist:      document.getElementById('is_playlist').checked,
        number_playlist:  document.getElementById('number_playlist').checked,
        output_dir:       document.getElementById('output_dir').value.trim(),
        use_archive:      document.getElementById('use_archive').checked,
        archive_file:     document.getElementById('archive_file').value.trim(),
    };

    try {
        const res = await fetch('/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.error) {
            addLog('Error: ' + data.error, 'error');
            setDownloading(false);
            setStatus('error');
            return;
        }

        currentSessionId = data.session_id;
        eventSource = new EventSource('/progress/' + data.session_id);
        eventSource.onmessage = e => {
            const msg = JSON.parse(e.data);
            switch (msg.type) {
                case 'progress':
                    setProgress(msg.percent, msg.speed, msg.eta, msg.filename);
                    break;
                case 'finished':
                    addLog('✓ Stream downloaded: ' + msg.filename, 'finish');
                    break;
                case 'log':
                    addLog(msg.msg);
                    break;
                case 'cancelled':
                    addLog(msg.msg, 'warn');
                    setStatus('idle');
                    break;
                case 'error':
                    addLog('✗ ' + msg.msg, 'error');
                    setStatus('error');
                    break;
                case 'done':
                    addLog(msg.msg || '✓ All done', 'done');
                    setStatus('done');
                    break;
                case 'end':
                    setDownloading(false);
                    if (eventSource) {
                        eventSource.close();
                        eventSource = null;
                    }
                    currentSessionId = null;
                    break;
            }
        };
        eventSource.onerror = () => {
            addLog('Connection to server lost', 'error');
            setDownloading(false);
            setStatus('error');
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            currentSessionId = null;
        };
    } catch (err) {
        addLog('Connection error: ' + err.message, 'error');
        setDownloading(false);
        setStatus('error');
    }
}

async function stopDownload() {
    const sid = currentSessionId;
    if (sid) {
        try {
            await fetch('/stop/' + encodeURIComponent(sid), { method: 'POST' });
        } catch (e) {
            console.warn('Error sending stop signal:', e);
        }
    }
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    currentSessionId = null;
    addLog('⚠ Download stopped by user', 'warn');
    setDownloading(false);
    setStatus('idle');
}

// ── Startup initialization ──
loadSettings();
updateMediaOptions();
loadEnvStatus();

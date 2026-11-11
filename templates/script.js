let downloading = false;
let eventSource = null;
let currentSessionId = null;

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

// ── Initialize checkbox cards ──
document.querySelectorAll('.check-card').forEach(card => {
    const cb = card.querySelector('input[type="checkbox"]');
    if (!cb) return;

    card.classList.toggle('active', cb.checked);

    cb.addEventListener('change', () => {
        card.classList.toggle('active', cb.checked);
        updateDependentOptions();
    });
});

// ── Media mode tabs & dependent options ──
function selectMediaMode(mode) {
    const select = document.getElementById('media_type');
    select.value = mode;

    document.querySelectorAll('.mode-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    updateMediaOptions();
}

function updateMediaOptions() {
    const mediaType = document.getElementById('media_type').value;
    const isAudioOnly = mediaType === 'audio';
    const isVideoMode = mediaType === 'video' || mediaType === 'both';

    // Show audio extraction settings only in Audio-Only mode
    document.getElementById('audio-format-field').style.display  = isAudioOnly ? '' : 'none';
    document.getElementById('audio-quality-field').style.display = isAudioOnly ? '' : 'none';

    // Show video container, resolution and codec in Video-Only and Audio+Video modes
    document.getElementById('video-format-field').style.display  = isVideoMode ? '' : 'none';
    document.getElementById('video-quality-field').style.display = isVideoMode ? '' : 'none';
    document.getElementById('video-codec-field').style.display   = isVideoMode ? '' : 'none';

    // Hint text
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

    // Square cover only applies to audio-only when embedding thumbnail
    document.getElementById('chk-square-thumb').style.display =
        (mediaType === 'audio' && embedThumb) ? '' : 'none';

    // Archive file path input
    document.getElementById('archive-field').style.display = useArchive ? '' : 'none';

    // Dim numeric playlist option when Playlist is unchecked
    document.getElementById('chk-index').classList.toggle('dimmed', !isPlaylist);

    // Subtitle language input & Embed subs visibility
    document.getElementById('subs-langs-field').style.display = anySubs ? '' : 'none';
    document.getElementById('chk-embedsubs').style.display =
        (anySubs && mediaType !== 'audio') ? '' : 'none';
}

// Initialize on load
updateMediaOptions();
loadEnvStatus();

// Press Enter in URL input to start download
document.getElementById('url').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !downloading) {
        e.preventDefault();
        startDownload();
    }
});

// ── Resizable Splitter ──
(() => {
    const splitter = document.getElementById('splitter');
    const mainLayout = document.querySelector('.main-layout');
    const controlsCol = document.querySelector('.controls-col');

    const MIN_WIDTH = 300;
    const MIN_RIGHT = 220;
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
        }
    });
})();

// ── URL helpers ──
function clearUrl() {
    const input = document.getElementById('url');
    input.value = '';
    input.focus();
}

async function pasteUrl() {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            const input = document.getElementById('url');
            input.value = text.trim();
            input.focus();
        }
    } catch (err) {
        addLog('⚠ Could not read clipboard automatically (use Ctrl+V)', 'warn');
    }
}

// ── Browse folder ──
async function browseFolder() {
    try {
        const res = await fetch('/browse');
        const data = await res.json();
        if (data.folder) {
            document.getElementById('output_dir').value = data.folder;
        } else if (data.error) {
            addLog('⚠ Error opening folder browser: ' + data.error, 'warn');
        }
    } catch (err) {
        console.error('Error opening folder browser:', err);
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

// ── Log helpers ──
function addLog(msg, type = 'default') {
    const log = document.getElementById('log');
    const empty = log.querySelector('.log-empty');
    if (empty) empty.remove();

    const now = new Date();
    const time = now.toTimeString().slice(0, 8);

    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="log-time">${time}</span><span class="log-msg type-${type}">${escHtml(msg)}</span>`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

function clearLog() {
    document.getElementById('log').innerHTML =
        '<div class="log-empty"><span class="log-arrow">←</span>Paste a URL, choose your options and press <strong>DOWNLOAD</strong></div>';
    document.getElementById('progress-section').classList.remove('visible');
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
    const url = document.getElementById('url').value.trim();
    if (!url) {
        addLog('⚠ Enter a URL first', 'warn');
        document.getElementById('url').focus();
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

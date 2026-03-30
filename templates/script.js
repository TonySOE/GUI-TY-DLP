let downloading = false;
let eventSource = null;

// ── Initialize checkbox cards ──
document.querySelectorAll('.check-card').forEach(card => {
    const cb = card.querySelector('input[type="checkbox"]');
    if (!cb) return;

    // Sync initial state
    card.classList.toggle('active', cb.checked);

    cb.addEventListener('change', () => {
        card.classList.toggle('active', cb.checked);
        if (cb.id === 'use_archive') {
            document.getElementById('archive-field').style.display = cb.checked ? '' : 'none';
        }
    });
});

// ── Media type selector ──
function updateMediaOptions() {
    const mediaType = document.getElementById('media_type').value;
    const showAudioOptions = mediaType !== 'video';
    const showVideoOptions = mediaType !== 'audio';

    document.getElementById('audio-format-field').style.display  = showAudioOptions ? '' : 'none';
    document.getElementById('audio-quality-field').style.display = showAudioOptions ? '' : 'none';
    document.getElementById('video-format-field').style.display  = showVideoOptions ? '' : 'none';
    document.getElementById('video-quality-field').style.display = showVideoOptions ? '' : 'none';
    document.getElementById('video-codec-field').style.display   = showVideoOptions ? '' : 'none';
}

// Initialize on load
updateMediaOptions();

// ── Archive toggle ──
function toggleArchive(el) {
    document.getElementById('archive-field').style.display = el.checked ? '' : 'none';
}

// ── Resizable Splitter ──
(() => {
    const splitter = document.getElementById('splitter');
    const mainLayout = document.querySelector('.main-layout');
    const controlsCol = document.querySelector('.controls-col');
    const consoleCol = document.querySelector('.console-col');
    
    const MIN_WIDTH = 280;  // Mínimo de 280px para panel izquierdo
    const MIN_RIGHT = 150;  // Mínimo de 150px para panel derecho
    let isResizing = false;
    
    splitter.addEventListener('mousedown', (e) => {
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
        
        // Respect minimum width constraints
        const newLeftWidth = Math.max(MIN_WIDTH, Math.min(leftX, mainWidth - MIN_RIGHT - 5));
        
        controlsCol.style.width = newLeftWidth + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            splitter.classList.remove('active');
            document.body.style.userSelect = 'auto';
            document.body.style.cursor = 'auto';
        }
    });
})();

// ── URL clear ──
function clearUrl() {
    document.getElementById('url').value = '';
    document.getElementById('url').focus();
}

// ── Browse folder ──
async function browseFolder() {
    try {
        const res = await fetch('/browse');
        const data = await res.json();
        if (data.folder) {
            document.getElementById('output_dir').value = data.folder;
        }
    } catch (err) {
        console.error('Error opening folder browser:', err);
    }
}

// ── UPDATE TOOL ──
async function updateTool() {
    const btn = document.getElementById('btn-update');
    btn.disabled = true;
    btn.innerHTML = '<span class="update-icon">↻</span> UPDATING...';

    addLog('Updating yt-dlp...', 'info');
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

        const es = new EventSource('/progress/' + data.session_id);
        eventSource = es; // Assign to global var for stopping

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
            }
        };
        es.onerror = () => {
            addLog('Connection to server lost', 'error');
            setStatus('error');
            es.close();
            resetUpdateBtn();
            eventSource = null;
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
        '<div class="log-empty"><span class="log-arrow">←</span>Configure and press <strong>DOWNLOAD</strong></div>';
    document.getElementById('progress-section').classList.remove('visible');
    setStatus('idle');
}

function escHtml(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setStatus(s) {
    const dot = document.getElementById('status-dot');
    dot.className = 'status-dot' + (s !== 'idle' ? ' ' + s : '');
}

function setProgress(percent, speed, eta, filename) {
    const pct = parseFloat(percent) || 0;
    document.getElementById('progress-bar').style.width = pct + '%';
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
    if (!url) { addLog('⚠ Enter a URL first', 'warn'); return; }

    setDownloading(true);
    setStatus('running');
    addLog('Starting download...', 'info');
    addLog('URL: ' + url);

    const mediaType = document.getElementById('media_type').value;

    const payload = {
        url,
        audio_only:      mediaType === 'audio',
        video_format:    document.getElementById('video_format').value,
        video_quality:   document.getElementById('video_quality').value,
        video_codec:     document.getElementById('video_codec').value,
        audio_format:    document.getElementById('audio_format').value,
        audio_quality:   document.getElementById('audio_quality').value,
        embed_metadata:  document.getElementById('embed_metadata').checked,
        embed_thumbnail: document.getElementById('embed_thumbnail').checked,
        write_subs:      document.getElementById('write_subs').checked,
        write_auto_subs: document.getElementById('write_auto_subs').checked,
        embed_subs:      document.getElementById('embed_subs').checked,
        sub_langs:       document.getElementById('sub_langs').value.trim(),
        is_playlist:     document.getElementById('is_playlist').checked,
        number_playlist: document.getElementById('number_playlist').checked,
        output_dir:      document.getElementById('output_dir').value.trim(),
        use_archive:     document.getElementById('use_archive').checked,
        archive_file:    document.getElementById('archive_file').value.trim(),
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

        eventSource = new EventSource('/progress/' + data.session_id);
        eventSource.onmessage = e => {
            const msg = JSON.parse(e.data);
            switch (msg.type) {
                case 'progress':
                    setProgress(msg.percent, msg.speed, msg.eta, msg.filename);
                    break;
                case 'finished':
                    addLog('✓ File ready: ' + msg.filename, 'finish');
                    break;
                case 'log':
                    addLog(msg.msg);
                    break;
                case 'error':
                    addLog('✗ ' + msg.msg, 'error');
                    setStatus('error');
                    break;
                case 'done':
                    addLog('✓ All done', 'done');
                    setStatus('done');
                    break;
                case 'end':
                    setDownloading(false);
                    eventSource.close();
                    eventSource = null;
                    break;
            }
        };
        eventSource.onerror = () => {
            addLog('Connection to server lost', 'error');
            setDownloading(false);
            setStatus('error');
            eventSource.close();
            eventSource = null;
        };
    } catch (err) {
        addLog('Connection error: ' + err.message, 'error');
        setDownloading(false);
        setStatus('error');
    }
}

function stopDownload() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    addLog('Download interrupted by user', 'warn');
    setDownloading(false);
    setStatus('idle');
}
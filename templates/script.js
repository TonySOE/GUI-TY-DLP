let mode = 'video';
let downloading = false;
let eventSource = null;
// ── Checkbox interactivo ──
document.querySelectorAll('.check-item').forEach(item => {
    const cb = item.querySelector('input[type="checkbox"]');
    if (cb.checked) item.classList.add('active');
    item.addEventListener('click', () => {
        item.classList.toggle('active');
    });
    cb.addEventListener('change', () => {
        item.classList.toggle('active', cb.checked);
    });
});

function setMode(m) {
    mode = m;
    document.getElementById('btn-video').classList.toggle('active', m === 'video');
    document.getElementById('btn-audio').classList.toggle('active', m === 'audio');
    document.getElementById('video-opts').style.display = m === 'video' ? '' : 'none';
    document.getElementById('audio-opts').style.display = m === 'audio' ? '' : 'none';
}

function clearUrl() {
    document.getElementById('url').value = '';
    document.getElementById('url').focus();
}

function toggleArchive(el) {
    document.getElementById('archive-field').style.display = el.checked ? '' : 'none';
}

async function browseFolder() {
    try {
        const res = await fetch('/browse');
        const data = await res.json();
        if (data.folder) {
            document.getElementById('output_dir').value = data.folder;
        }
    } catch (err) {
        console.error('Error al abrir el explorador:', err);
    }
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
    document.getElementById('log').innerHTML = '<div class="log-empty"><span class="arrow">←</span>Configura y presiona <strong>DESCARGAR</strong></div>';
    document.getElementById('progress-section').classList.remove('visible');
    setStatus('idle');
}

function escHtml(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function setStatus(s) {
    const dot = document.getElementById('status-dot');
    dot.className = 'status-indicator' + (s !== 'idle' ? ' ' + s : '');
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
    btnD.textContent = state ? '⏳ DESCARGANDO...' : '⬇ DESCARGAR';
    btnS.style.display = state ? 'block' : 'none';
}

// ── Descarga ──
async function startDownload() {
    const url = document.getElementById('url').value.trim();
    if (!url) { addLog('⚠ Ingresa una URL primero', 'warn'); return; }

    setDownloading(true);
    setStatus('running');
    addLog('Iniciando descarga...', 'info');
    addLog('URL: ' + url, 'default');

    const payload = {
        url,
        audio_only: mode === 'audio',
        video_quality: document.getElementById('video_quality').value,
        audio_format: document.getElementById('audio_format').value,
        audio_quality: document.getElementById('audio_quality').value,
        embed_metadata: document.getElementById('embed_metadata').checked,
        embed_thumbnail: document.getElementById('embed_thumbnail').checked,
        write_subs: document.getElementById('write_subs').checked,
        write_auto_subs: document.getElementById('write_auto_subs').checked,
        embed_subs: document.getElementById('embed_subs').checked,
        sub_langs: document.getElementById('sub_langs').value.trim(),
        is_playlist: document.getElementById('is_playlist').checked,
        number_playlist: document.getElementById('number_playlist').checked,
        output_dir: document.getElementById('output_dir').value.trim(),
        use_archive: document.getElementById('use_archive').checked,
        archive_file: document.getElementById('archive_file').value.trim(),
    };

    try {
        const res = await fetch('/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.error) { addLog('Error: ' + data.error, 'error'); setDownloading(false); setStatus('error'); return; }

        // SSE para progreso
        eventSource = new EventSource('/progress/' + data.session_id);
        eventSource.onmessage = e => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'progress') {
                setProgress(msg.percent, msg.speed, msg.eta, msg.filename);
            } else if (msg.type === 'finished') {
                addLog('✓ Archivo listo: ' + msg.filename, 'finish');
            } else if (msg.type === 'log') {
                addLog(msg.msg);
            } else if (msg.type === 'error') {
                addLog('✗ ' + msg.msg, 'error');
            } else if (msg.type === 'done') {
                addLog('✓ Todo completado', 'done');
                setStatus('done');
                setDownloading(false);
                eventSource.close();
            } else if (msg.type === 'end') {
                setDownloading(false);
                eventSource.close();
            }
        };
        eventSource.onerror = () => {
            addLog('Conexión con el servidor perdida', 'error');
            setDownloading(false);
            setStatus('error');
            eventSource.close();
        };
    } catch (err) {
        addLog('Error al conectar: ' + err.message, 'error');
        setDownloading(false);
        setStatus('error');
    }
}

function stopDownload() {
    if (eventSource) eventSource.close();
    addLog('Descarga interrumpida por el usuario', 'warn');
    setDownloading(false);
    setStatus('idle');
}

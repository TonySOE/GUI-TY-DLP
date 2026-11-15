from flask import Flask, render_template, request, Response, jsonify
import yt_dlp
from yt_dlp.postprocessor.common import PostProcessor
from yt_dlp.postprocessor.embedthumbnail import EmbedThumbnailPP
from PIL import Image
import importlib
import threading
import queue
import json
import os
import re
import shutil
import subprocess
import sys


class SquareThumbnailPP(PostProcessor):
    """Recorta cada miniatura descargada a un cuadrado centrado (1:1).
    Debe ejecutarse ANTES que EmbedThumbnail para que lo que se incruste
    en el archivo ya sea cuadrado y no el 16:9 original de YouTube."""

    def run(self, info):
        for thumb in info.get('thumbnails') or []:
            filepath = thumb.get('filepath')
            if not filepath or not os.path.exists(filepath):
                continue
            try:
                with Image.open(filepath) as img:
                    w, h = img.size
                    side = min(w, h)
                    left = (w - side) // 2
                    top = (h - side) // 2
                    cropped = img.crop((left, top, left + side, top + side))
                    if cropped.mode in ('RGBA', 'P') and filepath.lower().endswith(('.jpg', '.jpeg')):
                        cropped = cropped.convert('RGB')
                    cropped.save(filepath)
            except Exception as e:
                self.report_warning(f'No se pudo recortar la portada a cuadrado: {e}')
        return [], info


# Expresión regular para limpiar los códigos de color ANSI
ANSI_ESCAPE = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')


def clean_ansi(text):
    return ANSI_ESCAPE.sub('', text) if isinstance(text, str) else text


def format_duration(seconds):
    if not seconds or not isinstance(seconds, (int, float)):
        return ''
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f'{h}:{m:02d}:{s:02d}'
    return f'{m:02d}:{s:02d}'


app = Flask(__name__, static_folder='templates', static_url_path='/')

# Colas de progreso y eventos de cancelación por sesión
progress_queues = {}
cancel_events = {}
active_procs = {}

COOKIES_FILES = ('www.youtube.com_cookies.txt', 'cookies.txt')


def get_cookies_file():
    """Devuelve el primer archivo de cookies válido disponible en la raíz."""
    for path in COOKIES_FILES:
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            return path
    return None


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/status')
def status_info():
    """Devuelve versión de yt-dlp y estado de herramientas del entorno."""
    cookies_path = get_cookies_file()
    has_cookies = cookies_path is not None
    has_ffmpeg = shutil.which('ffmpeg') is not None
    has_deno = shutil.which('deno') is not None
    version = getattr(yt_dlp.version, '__version__', 'unknown')
    return jsonify({
        'ytdlp_version': version,
        'has_cookies': has_cookies,
        'cookies_file': cookies_path or '',
        'has_ffmpeg': has_ffmpeg,
        'has_deno': has_deno,
        'default_dir': os.path.join(os.path.expanduser('~'), 'Downloads'),
    })


@app.route('/info', methods=['POST'])
def fetch_info():
    """Obtiene metadatos rápidos (título, miniatura, canal, duración, plataforma, playlist) sin descargar."""
    data = request.json or {}
    url = data.get('url', '').strip()
    if not url:
        return jsonify({'error': 'Empty URL'}), 400

    opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'extract_flat': 'in_playlist',
        'noplaylist': False,
        'remote_components': {'ejs:github'},
    }
    cookies_path = get_cookies_file()
    if cookies_path:
        opts['cookiefile'] = cookies_path
    if shutil.which('deno'):
        opts['js_runtimes'] = {'deno': {}}

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                return jsonify({'error': 'Could not extract info'}), 404

            is_playlist = info.get('_type') == 'playlist' or 'entries' in info
            entries = list(info.get('entries') or []) if is_playlist else []
            playlist_count = info.get('playlist_count') or len(entries)

            # Elegir la mejor miniatura disponible
            thumb = info.get('thumbnail')
            if not thumb and info.get('thumbnails'):
                thumbs = [t.get('url') for t in info['thumbnails'] if t.get('url')]
                if thumbs:
                    thumb = thumbs[-1]
            if not thumb and entries:
                first = entries[0] or {}
                thumb = first.get('thumbnail')
                if not thumb and first.get('thumbnails'):
                    t_list = [t.get('url') for t in first['thumbnails'] if t.get('url')]
                    if t_list:
                        thumb = t_list[-1]

            uploader = (
                info.get('uploader')
                or info.get('channel')
                or info.get('artist')
                or (entries[0].get('uploader') if entries and isinstance(entries[0], dict) else '')
                or ''
            )

            platform = (
                info.get('extractor_key')
                or info.get('extractor')
                or info.get('webpage_url_domain')
                or 'Media'
            )

            duration_sec = info.get('duration')
            return jsonify({
                'title': info.get('title') or 'Untitled',
                'uploader': uploader,
                'duration': format_duration(duration_sec),
                'thumbnail': thumb or '',
                'platform': str(platform).replace('Tab', ''),
                'is_playlist': bool(is_playlist),
                'playlist_count': playlist_count if is_playlist else 0,
            })
    except Exception as e:
        return jsonify({'error': clean_ansi(str(e))}), 400


@app.route('/open-folder', methods=['POST'])
def open_folder():
    """Abre la carpeta de descargas en el explorador del sistema."""
    data = request.json or {}
    folder = data.get('folder', '').strip()
    if not folder or folder == '.':
        folder = os.path.join(os.path.expanduser('~'), 'Downloads')

    folder = os.path.abspath(os.path.expanduser(folder))
    if not os.path.isdir(folder):
        parent = os.path.dirname(folder)
        if os.path.isdir(parent):
            folder = parent
        else:
            return jsonify({'error': f'Folder does not exist: {folder}'}), 404

    try:
        if sys.platform == 'win32':
            os.startfile(folder)
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', folder])
        else:
            subprocess.Popen(['xdg-open', folder])
        return jsonify({'opened': folder})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/browse')
def browse():
    """Abre el selector de carpetas en un proceso aislado para evitar errores de hilo con Tkinter."""
    script = (
        "import tkinter as tk\n"
        "from tkinter import filedialog\n"
        "root = tk.Tk()\n"
        "root.attributes('-topmost', True)\n"
        "root.withdraw()\n"
        "folder = filedialog.askdirectory(title='Selecciona la carpeta de destino')\n"
        "root.destroy()\n"
        "print(folder or '', end='')\n"
    )
    try:
        res = subprocess.run(
            [sys.executable, '-c', script],
            capture_output=True,
            text=True,
            timeout=120
        )
        folder = res.stdout.strip()
        return jsonify({'folder': folder})
    except Exception as e:
        return jsonify({'folder': '', 'error': str(e)}), 500


@app.route('/stop/<session_id>', methods=['POST'])
def stop_session(session_id):
    """Solicita la cancelación inmediata de una descarga o actualización en curso."""
    ev = cancel_events.get(session_id)
    if ev:
        ev.set()

    proc = active_procs.get(session_id)
    if proc and proc.poll() is None:
        try:
            proc.terminate()
        except Exception:
            pass

    return jsonify({'stopped': True})


@app.route('/update', methods=['POST'])
def update_ytdlp():
    """Actualiza yt-dlp y yt-dlp-ejs vía pip y transmite la salida por SSE."""
    session_id = 'update_' + str(threading.get_ident()) + '_' + str(id(request))
    q = queue.Queue()
    cancel_ev = threading.Event()
    progress_queues[session_id] = q
    cancel_events[session_id] = cancel_ev

    def run_update():
        try:
            cmd = [sys.executable, '-m', 'pip', 'install', '--upgrade', 'yt-dlp', 'yt-dlp-ejs']
            q.put(json.dumps({'type': 'log', 'msg': f'Running: {" ".join(cmd)}'}))
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )
            active_procs[session_id] = proc
            for line in proc.stdout:
                if cancel_ev.is_set():
                    proc.terminate()
                    break
                line = line.strip()
                if line:
                    q.put(json.dumps({'type': 'log', 'msg': line}))
            proc.wait()

            if cancel_ev.is_set():
                q.put(json.dumps({'type': 'cancelled', 'msg': '⚠ Update cancelled by user'}))
            elif proc.returncode == 0:
                try:
                    importlib.reload(yt_dlp.version)
                    importlib.reload(yt_dlp)
                except Exception:
                    pass
                new_ver = getattr(yt_dlp.version, '__version__', '')
                q.put(json.dumps({
                    'type': 'done',
                    'msg': f'✓ yt-dlp updated successfully ({new_ver})',
                    'version': new_ver
                }))
            else:
                q.put(json.dumps({'type': 'error', 'msg': 'Error updating yt-dlp (exit code ' + str(proc.returncode) + ')'}))
        except Exception as e:
            q.put(json.dumps({'type': 'error', 'msg': str(e)}))
        finally:
            active_procs.pop(session_id, None)
            cancel_events.pop(session_id, None)
            q.put(None)

    t = threading.Thread(target=run_update, daemon=True)
    t.start()
    return jsonify({'session_id': session_id})


@app.route('/download', methods=['POST'])
def download():
    data = request.json or {}
    url = data.get('url', '').strip()

    if not url:
        return jsonify({'error': 'URL vacía'}), 400

    session_id = f'dl_{threading.get_ident()}_{id(data)}'
    q = queue.Queue()
    cancel_ev = threading.Event()
    progress_queues[session_id] = q
    cancel_events[session_id] = cancel_ev

    def run_download():
        current = {'title': None}

        def progress_hook(d):
            if cancel_ev.is_set():
                raise yt_dlp.utils.DownloadCancelled('Cancelled by user')

            info = d.get('info_dict', {})
            if info.get('title'):
                current['title'] = info['title']

            if d['status'] == 'downloading':
                msg = {
                    'type': 'progress',
                    'percent':  clean_ansi(d.get('_percent_str', '0%')).strip(),
                    'speed':    clean_ansi(d.get('_speed_str',   '—')).strip(),
                    'eta':      clean_ansi(d.get('_eta_str',     '—')).strip(),
                    'filename': os.path.basename(d.get('filename', '')),
                }
                q.put(json.dumps(msg))
            elif d['status'] == 'finished':
                q.put(json.dumps({
                    'type': 'finished',
                    'filename': os.path.basename(d.get('filename', ''))
                }))
            elif d['status'] == 'error':
                q.put(json.dumps({'type': 'error', 'msg': str(d.get('error', 'Unknown error'))}))

        opts = build_options(data)
        opts['progress_hooks'] = [progress_hook]

        class QueueLogger:
            def debug(self, msg):
                if cancel_ev.is_set():
                    raise yt_dlp.utils.DownloadCancelled('Cancelled by user')
                if msg.startswith('[debug]'):
                    return
                q.put(json.dumps({'type': 'log', 'msg': clean_ansi(msg)}))

            def warning(self, msg):
                q.put(json.dumps({'type': 'log', 'msg': f'⚠ {clean_ansi(msg)}'}))

            def error(self, msg):
                if cancel_ev.is_set():
                    return
                title_hint = f' → "{current["title"]}"' if current['title'] else ''
                current['title'] = None
                q.put(json.dumps({'type': 'error', 'msg': clean_ansi(msg) + title_hint}))

        opts['logger'] = QueueLogger()

        media_type = data.get('media_type', 'audio' if data.get('audio_only') else 'both')

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                if data.get('embed_thumbnail'):
                    # Se añaden a mano para garantizar el orden: recortar primero, incrustar después.
                    if data.get('square_thumbnail') and media_type == 'audio':
                        ydl.add_post_processor(SquareThumbnailPP(ydl), when='post_process')
                    ydl.add_post_processor(EmbedThumbnailPP(ydl, already_have_thumbnail=False), when='post_process')
                ydl.download([url])

            if cancel_ev.is_set():
                q.put(json.dumps({'type': 'cancelled', 'msg': '⚠ Download stopped by user'}))
            else:
                q.put(json.dumps({'type': 'done', 'msg': '✓ Download complete'}))
        except yt_dlp.utils.DownloadCancelled:
            q.put(json.dumps({'type': 'cancelled', 'msg': '⚠ Download stopped by user'}))
        except Exception as e:
            if cancel_ev.is_set():
                q.put(json.dumps({'type': 'cancelled', 'msg': '⚠ Download stopped by user'}))
            else:
                q.put(json.dumps({'type': 'error', 'msg': clean_ansi(str(e))}))
        finally:
            cancel_events.pop(session_id, None)
            q.put(None)

    t = threading.Thread(target=run_download, daemon=True)
    t.start()
    return jsonify({'session_id': session_id})


@app.route('/progress/<session_id>')
def progress(session_id):
    q = progress_queues.get(session_id)
    if not q:
        return Response(
            'data: ' + json.dumps({'type': 'error', 'msg': 'Session not found'}) + '\n\n',
            mimetype='text/event-stream'
        )

    def generate():
        try:
            while True:
                try:
                    msg = q.get(timeout=120)
                except queue.Empty:
                    yield 'data: ' + json.dumps({'type': 'error', 'msg': 'Timeout waiting for progress'}) + '\n\n'
                    break
                if msg is None:
                    yield 'data: ' + json.dumps({'type': 'end'}) + '\n\n'
                    break
                yield f'data: {msg}\n\n'
        finally:
            progress_queues.pop(session_id, None)

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


def build_options(data):
    opts = {
        'noplaylist': not data.get('is_playlist', False),
        'ignoreerrors': 'only_download',
        'remote_components': {'ejs:github'},
    }

    # Usar cookies solo si existe algún archivo válido (www.youtube.com_cookies.txt o cookies.txt)
    cookies_path = get_cookies_file()
    if cookies_path:
        opts['cookiefile'] = cookies_path

    # Usar Deno si está disponible en PATH
    if shutil.which('deno'):
        opts['js_runtimes'] = {'deno': {}}

    # — Output path —
    output_dir = data.get('output_dir', '').strip()
    if not output_dir or output_dir == '.':
        output_dir = os.path.join(os.path.expanduser('~'), 'Downloads')

    if data.get('is_playlist'):
        if data.get('number_playlist'):
            template = '%(playlist_title)s/%(playlist_index)02d - %(title)s.%(ext)s'
        else:
            template = '%(playlist_title)s/%(title)s.%(ext)s'
    else:
        template = '%(title)s.%(ext)s'

    opts['outtmpl'] = os.path.join(output_dir, template)

    postprocessors = []

    media_type = data.get('media_type')
    if not media_type:
        media_type = 'audio' if data.get('audio_only') else 'both'

    # — Modo 1: Solo Audio —
    if media_type == 'audio':
        opts['format'] = 'bestaudio/best'
        postprocessors.append({
            'key': 'FFmpegExtractAudio',
            'preferredcodec':   data.get('audio_format', 'mp3'),
            'preferredquality': str(data.get('audio_quality', '0')),
        })

    # — Modo 2: Solo Video (sin pista de audio) —
    elif media_type == 'video':
        resolution = data.get('video_quality', 'best')
        codec_key  = data.get('video_codec', 'any')
        video_fmt  = data.get('video_format', 'mp4')

        codec_map = {'av1': 'av01', 'vp9': 'vp09', 'h264': 'avc1'}
        sort_params = []
        if codec_key in codec_map:
            sort_params.append(f'vcodec:{codec_map[codec_key]}')
        if resolution != 'best':
            sort_params.append(f'res:{resolution}')

        if sort_params:
            opts['format_sort'] = sort_params
            opts['format'] = 'bestvideo/best'
        else:
            if resolution != 'best':
                opts['format'] = f'bestvideo[height<={resolution}]/best[height<={resolution}]'
            else:
                opts['format'] = 'bestvideo/best'

        postprocessors.append({
            'key': 'FFmpegVideoRemuxer',
            'preferedformat': video_fmt,
        })
        # Garantiza que si el sitio (ej. TikTok/Twitter/Instagram) entrega un stream
        # con audio integrado al hacer fallback a /best, se elimine la pista de audio (-an).
        opts['postprocessor_args'] = {'videoremuxer': ['-an']}

    # — Modo 3: Audio + Video (combinados) —
    else:
        resolution = data.get('video_quality', 'best')
        codec_key  = data.get('video_codec', 'any')
        video_fmt  = data.get('video_format', 'mp4')

        codec_map = {'av1': 'av01', 'vp9': 'vp09', 'h264': 'avc1'}
        sort_params = []
        if codec_key in codec_map:
            sort_params.append(f'vcodec:{codec_map[codec_key]}')
        if resolution != 'best':
            sort_params.append(f'res:{resolution}')

        if sort_params:
            opts['format_sort'] = sort_params
            opts['format'] = 'bestvideo+bestaudio/best'
        else:
            format_map = {
                'best': 'bestvideo+bestaudio/best',
                '2160': 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
                '1080': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
                '720':  'bestvideo[height<=720]+bestaudio/best[height<=720]',
                '480':  'bestvideo[height<=480]+bestaudio/best[height<=480]',
                '360':  'bestvideo[height<=360]+bestaudio/best[height<=360]',
            }
            opts['format'] = format_map.get(resolution, 'bestvideo+bestaudio/best')

        opts['merge_output_format'] = video_fmt

    # — Metadata —
    if data.get('embed_metadata'):
        postprocessors.append({'key': 'FFmpegMetadata', 'add_metadata': True})

    # — Thumbnail —
    if data.get('embed_thumbnail'):
        opts['writethumbnail'] = True

    # — Subtitles —
    if data.get('write_subs'):
        opts['writesubtitles'] = True
    if data.get('write_auto_subs'):
        opts['writeautomaticsub'] = True

    if data.get('write_subs') or data.get('write_auto_subs'):
        opts['subtitlesformat'] = 'srt'
        postprocessors.append({'key': 'FFmpegSubtitlesConvertor', 'format': 'srt'})

        if data.get('embed_subs') and media_type != 'audio':
            opts['embedsubtitles'] = True

        sub_langs = data.get('sub_langs', '').strip()
        if sub_langs:
            opts['subtitleslangs'] = [l.strip() for l in sub_langs.split(',') if l.strip()]

    # — Archive —
    if data.get('use_archive'):
        archive_path = data.get('archive_file', '').strip() or os.path.join(output_dir, 'archive.txt')
        opts['download_archive'] = archive_path

    if postprocessors:
        opts['postprocessors'] = postprocessors

    return opts


if __name__ == '__main__':
    print("=" * 50)
    print("  yt-dlp GUI  →  http://localhost:5000")
    print("=" * 50)
    app.run(debug=False, threaded=True, port=5000)

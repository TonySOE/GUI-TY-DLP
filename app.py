from flask import Flask, render_template, request, Response, jsonify
import yt_dlp
import threading
import queue
import json
import os
import re
import subprocess

# Expresión regular para limpiar los códigos de color ANSI
ANSI_ESCAPE = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
def clean_ansi(text):
    return ANSI_ESCAPE.sub('', text) if isinstance(text, str) else text

app = Flask(__name__, static_folder='templates', static_url_path='/')

# Cola de progreso por sesión (uso local, un usuario a la vez)
progress_queues = {}

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/browse')
def browse():
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.attributes("-topmost", True)
    root.withdraw()
    folder = filedialog.askdirectory(title="Selecciona la carpeta de destino")
    root.destroy()
    return jsonify({'folder': folder})


@app.route('/update', methods=['POST'])
def update_ytdlp():
    """Run yt-dlp -U and stream output via SSE."""
    session_id = 'update_' + str(threading.get_ident())
    q = queue.Queue()
    progress_queues[session_id] = q

    def run_update():
        try:
            proc = subprocess.Popen(
                ['yt-dlp', '-U'],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True
            )
            for line in proc.stdout:
                line = line.strip()
                if line:
                    q.put(json.dumps({'type': 'log', 'msg': line}))
            proc.wait()
            if proc.returncode == 0:
                q.put(json.dumps({'type': 'done', 'msg': '✓ yt-dlp updated successfully'}))
            else:
                q.put(json.dumps({'type': 'error', 'msg': 'Error updating yt-dlp'}))
        except FileNotFoundError:
            q.put(json.dumps({'type': 'error', 'msg': 'yt-dlp not found in PATH'}))
        except Exception as e:
            q.put(json.dumps({'type': 'error', 'msg': str(e)}))
        finally:
            q.put(None)

    t = threading.Thread(target=run_update, daemon=True)
    t.start()
    return jsonify({'session_id': session_id})


@app.route('/download', methods=['POST'])
def download():
    data = request.json
    url = data.get('url', '').strip()

    if not url:
        return jsonify({'error': 'URL vacía'}), 400

    session_id = str(threading.get_ident()) + str(id(data))
    q = queue.Queue()
    progress_queues[session_id] = q

    def run_download():
        current = {'title': None}

        def progress_hook(d):
            info = d.get('info_dict', {})
            if info.get('title'):
                current['title'] = info['title']

            if d['status'] == 'downloading':
                msg = {
                    'type': 'progress',
                    'percent':  clean_ansi(d.get('_percent_str', '?%')).strip(),
                    'speed':    clean_ansi(d.get('_speed_str',   '?')).strip(),
                    'eta':      clean_ansi(d.get('_eta_str',     '?')).strip(),
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
                if msg.startswith('[debug]'):
                    return
                q.put(json.dumps({'type': 'log', 'msg': msg}))
            def warning(self, msg):
                q.put(json.dumps({'type': 'log', 'msg': f'⚠ {msg}'}))
            def error(self, msg):
                title_hint = f' → "{current["title"]}"' if current['title'] else ''
                current['title'] = None
                q.put(json.dumps({'type': 'error', 'msg': msg + title_hint}))

        opts['logger'] = QueueLogger()

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
            q.put(json.dumps({'type': 'done', 'msg': '✓ Download complete'}))
        except Exception as e:
            q.put(json.dumps({'type': 'error', 'msg': str(e)}))
        finally:
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
        while True:
            try:
                msg = q.get(timeout=60)
            except queue.Empty:
                yield 'data: ' + json.dumps({'type': 'error', 'msg': 'Timeout'}) + '\n\n'
                break
            if msg is None:
                yield 'data: ' + json.dumps({'type': 'end'}) + '\n\n'
                break
            yield f'data: {msg}\n\n'
        progress_queues.pop(session_id, None)

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


def build_options(data):
    opts = {
        'noplaylist': not data.get('is_playlist', False),
        'ignoreerrors': True,
    }

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

    # — Audio mode —
    if data.get('audio_only'):
        opts['format'] = 'bestaudio/best'
        postprocessors.append({
            'key': 'FFmpegExtractAudio',
            'preferredcodec':   data.get('audio_format', 'mp3'),
            'preferredquality': str(data.get('audio_quality', '0')),
        })
    else:
        # Video quality + codec sort
        resolution  = data.get('video_quality', 'best')
        codec_key   = data.get('video_codec', 'any')
        video_fmt   = data.get('video_format', 'mp4')

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

        # Container format
        opts['merge_output_format'] = video_fmt

    # — Metadata —
    if data.get('embed_metadata'):
        postprocessors.append({'key': 'FFmpegMetadata', 'add_metadata': True})

    # — Thumbnail —
    if data.get('embed_thumbnail'):
        opts['writethumbnail'] = True
        postprocessors.append({'key': 'EmbedThumbnail', 'already_have_thumbnail': False})

    # — Subtitles —
    if data.get('write_subs'):
        opts['writesubtitles'] = True
    if data.get('write_auto_subs'):
        opts['writeautomaticsub'] = True

    if data.get('write_subs') or data.get('write_auto_subs'):
        opts['subtitlesformat'] = 'srt'
        postprocessors.append({'key': 'FFmpegSubtitlesConvertor', 'format': 'srt'})

    if data.get('embed_subs'):
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
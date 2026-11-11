# GUI-TY-DLP

<<<<<<< Updated upstream
A little project with the objective of using `yt-dlp` with a local graphical user interface via your web browser. 

This tool allows you to easily download videos, audio, and playlists from supported sites using a modern, dark-themed UI, without needing to memorize complex command-line arguments.

## Features
- **Easy to Use:** Clean, responsive web interface.
- **Format & Quality Selection:** Choose between video/audio only, select codecs (AV1, VP9, H264), and set specific resolutions.
- **Advanced yt-dlp Options:** Support for embedding metadata, thumbnails, subtitles, and handling playlists.
- **Real-time Feedback:** Live progress bar, speed/ETA metrics, and a built-in console log via Server-Sent Events (SSE).
- **One-Click Update:** Easily update the underlying `yt-dlp` core directly from the UI.

## How to Start (Windows)
Simply double-click the `start.bat` file. 
It will automatically:
1. Check if Python is installed.
2. Install any missing dependencies from `requirements.txt`.
3. Open your default web browser to `http://localhost:5000`.
4. Start the local Flask server.

## Project Structure & File Descriptions

- **`app.py`**  
  The backend of the application built with Flask (Python). It handles the API routes, processes the user options to generate `yt-dlp` commands, runs the downloads in background threads, and streams the real-time console output and progress back to the browser.

- **`templates/index.html`**  
  The main HTML document. It defines the layout and structure of the Graphical User Interface, including the control panels, form inputs, and the real-time console view.

- **`templates/styles.css`**  
  The stylesheet that gives the application its modern, dark-themed look. It handles the responsive design, the custom checkboxes, the layout splitting, and the console styling.

- **`templates/script.js`**  
  The frontend JavaScript logic. It makes the interface interactive (like showing/hiding options based on the media type selected), handles form submissions, communicates with the Flask backend, and parses the live progress data to update the UI (progress bar and console logs).

- **`iniciar.bat`**  
  A convenient Windows batch script designed to initialize the project environment and run the application with a single click.

- **`requirements.txt`** *(Generated/Used by the script)*  
  Contains the Python dependencies required for the project to run (primarily `Flask` and `yt-dlp`).

## 🛠️ Requirements
- Python 3.8 or higher
- An active internet connection

---
*Disclaimer: This is a tool built for personal use.*
=======
Interfaz gráfica web local para **yt-dlp**, construida con **Flask** y **Vanilla JS** (Server-Sent Events) para descargar audio y vídeo de forma sencilla desde el navegador.

## Características

- **3 modos de descarga**:
  - **Audio Only**: extrae la pista de audio en `mp3`, `flac`, `m4a`, `opus` o `wav` con selección de calidad VBR.
  - **Audio + Video**: descarga y combina la mejor pista de vídeo y audio en `mp4`, `mkv` o `webm`, eligiendo resolución (hasta 4K) y códec (`AV1`, `VP9`, `H.264`).
  - **Video Only (Muted)**: descarga únicamente el flujo de vídeo sin pista de audio.
- **Post-procesamiento inteligente**:
  - Incrustación de metadatos (`FFmpegMetadata`) y carátulas (`EmbedThumbnailPP`).
  - Recorte automático de carátulas **1:1 (cuadradas)** centradas con Pillow para archivos de música.
  - Descarga, conversión a `.srt` e incrustación de subtítulos manuales y autogenerados.
  - Soporte para listas de reproducción con numeración opcional (`01 -`, `02 -`) y registro de descargas (`archive.txt`).
- **Consola en tiempo real**: barra de progreso con velocidad, ETA, logs en vivo, botón **STOP** con cancelación real en el servidor y actualizador integrado de `yt-dlp`.
- **Indicadores de entorno**: verifica automáticamente en la cabecera si `FFmpeg`, `Deno` y `www.youtube.com_cookies.txt` están activos.

## Requisitos

1. **Python 3.8+**
2. **FFmpeg** instalado y disponible en el `PATH` del sistema (necesario para unir pistas de vídeo/audio, convertir formatos e incrustar carátulas).
3. *(Recomendado)* **Deno** en el `PATH` del sistema para resolver desafíos JS de YouTube.
4. *(Opcional)* Archivo `www.youtube.com_cookies.txt` en la raíz del proyecto para vídeos con restricción de edad o sesión.

## Uso rápido

En Windows, haz doble clic en **`iniciar.bat`**, o ejecuta manualmente en una terminal:

```bash
pip install -r requirements.txt
python app.py
```

Luego abre [http://localhost:5000](http://localhost:5000) en tu navegador.
>>>>>>> Stashed changes

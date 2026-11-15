# GUI-TY-DLP

A local graphical user interface for **`yt-dlp`** accessible via your web browser, built with **Flask** and **Vanilla JS** (Server-Sent Events).

This tool allows you to easily download videos, audio, and playlists using a modern dark-themed UI without memorizing complex command-line arguments.

## Features

- **3 Download Modes:**
  - **Audio Only:** Extract audio in `mp3`, `flac`, `m4a`, `opus`, or `wav` with VBR quality selection.
  - **Audio + Video:** Download and merge the best video and audio streams into `mp4`, `mkv`, or `webm`, choosing resolution (up to 4K) and preferred codec (`AV1`, `VP9`, `H.264`).
  - **Video Only (Muted):** Download only the video stream without an audio track.
- **Smart Post-Processing:**
  - Embed metadata (`FFmpegMetadata`) and cover thumbnails (`EmbedThumbnailPP`).
  - Automatic **1:1 square cover cropping** via Pillow for audio files.
  - Download, convert to `.srt`, and optionally mux manual and auto-generated subtitles.
  - Playlist support with optional track numbering (`01 -`, `02 -`) and download archive history (`archive.txt`).
- **Real-time Console & Controls:** Live progress bar, speed/ETA metrics, real-time console log via Server-Sent Events (SSE), a **STOP** button that cancels active downloads on the server, and one-click `yt-dlp` updates.
- **Environment Status Badges:** Automatically checks and displays in the header whether `FFmpeg`, `Deno`, and `www.youtube.com_cookies.txt` are available.

## How to Start (Windows)

Simply double-click `start.bat` (or `iniciar.bat`). It will automatically:
1. Check if Python is installed.
2. Verify and install any missing dependencies from `requirements.txt`.
3. Open your default web browser to `http://localhost:5000`.
4. Start the local Flask server.

## Project Structure

- **`app.py`** — Flask backend handling API routes, `yt-dlp` configuration, custom `SquareThumbnailPP` post-processor, background download threads, cancellation events, and SSE streaming.
- **`templates/index.html`** — Main HTML layout for the graphical user interface.
- **`templates/styles.css`** — Dark-themed responsive stylesheet.
- **`templates/script.js`** — Frontend logic for mode switching, SSE progress/log streaming, clipboard paste, and server communication.
- **`start.bat` / `iniciar.bat`** — Windows batch scripts to initialize dependencies and launch the app with a double-click.
- **`requirements.txt`** — Python dependencies (`Flask`, `yt-dlp`, `yt-dlp-ejs`, `Pillow`).

## Requirements

- **Python 3.8+**
- **FFmpeg** installed and available in your system `PATH` (required for merging streams, extracting audio, and embedding thumbnails).
- *(Recommended)* **Deno** in your system `PATH` to solve YouTube JS challenges.
- *(Optional)* Your own `www.youtube.com_cookies.txt` (or `cookies.txt`) in the project root for age-restricted, private, or channel-members-only videos.

## Cookies Setup (Optional)

This repository **does not** include a cookies file for security and privacy reasons (it is ignored in `.gitignore`). Each user must export their own cookies if they need to download age-restricted or members-only videos:

1. Install a browser extension to export cookies in Netscape format (for example, **Get cookies.txt LOCALLY** for Chrome/Edge/Brave or **cookies.txt** for Firefox).
2. *(Recommended)* Open an **Incognito/Private** window, log in to YouTube, export the cookies, and immediately close the incognito window (without clicking "Sign out") so the session stays valid longer.
3. Save the exported file as `www.youtube.com_cookies.txt` (or `cookies.txt`) in the root folder of this project.

> **Security Warning:** Never share or upload your `cookies.txt` file. It contains your active session tokens, which grant access to your account.

---
*Disclaimer: This tool is built for personal use.*

# GUI-TY-DLP

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
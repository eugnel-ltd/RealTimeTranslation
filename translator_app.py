import tkinter as tk
from tkinter import ttk, scrolledtext
import os
import json
from dotenv import load_dotenv
import azure.cognitiveservices.speech as speechsdk
import threading
import queue

# Load environment variables
load_dotenv()

SETTINGS_FILE = "settings.json"

class _RecognitionSession:
    def __init__(self, input_language, output_language, second_output_language):
        self.input_language = input_language
        self.target_languages = tuple(
            language for language in (output_language, second_output_language)
            if language and language.strip()
        )
        self.stop_event = threading.Event()


class TranslatorApp:
    def __init__(self, root):
        print("Initializing GUI...")
        self.root = root
        self.root.title("Real-Time Speech Translator")
        
        # Make the window always on top and semi-transparent
        self.root.wm_attributes("-topmost", True)
        self.root.wm_attributes("-alpha", 0.95)
        
        # Dark background and bright text for a modern look
        self.root.configure(bg="#1E1E1E")
        self.root.geometry("700x500")
        
        self.is_running = False
        self.recognition_thread = None
        self._active_session = None
        self._recognizer_lock = threading.Lock()
        self._events = queue.Queue()
        self._closed = False
        self._event_timer = None
        self._button_timer = None
        
        # Load settings (input_language, output_language, second_output_language)
        self.load_settings()
        
        # Create main UI
        self.create_main_ui()
        
        # Handle window close
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
        self._event_timer = self.root.after(50, self._drain_events)
        
    def load_settings(self):
        # Default settings if no file found
        default_settings = {
            "input_language": "en-US",
            "output_language": "yue",
            "second_output_language": ""
        }
        
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.input_language = data.get("input_language", default_settings["input_language"])
                self.output_language = data.get("output_language", default_settings["output_language"])
                self.second_output_language = data.get("second_output_language", default_settings["second_output_language"])
            except:
                self.input_language = default_settings["input_language"]
                self.output_language = default_settings["output_language"]
                self.second_output_language = default_settings["second_output_language"]
        else:
            self.input_language = default_settings["input_language"]
            self.output_language = default_settings["output_language"]
            self.second_output_language = default_settings["second_output_language"]
        
    def save_settings(self):
        data = {
            "input_language": self.input_language,
            "output_language": self.output_language,
            "second_output_language": self.second_output_language
        }
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        
    def create_main_ui(self):
        # Style configuration for ttk
        style = ttk.Style(self.root)
        style.configure("TButton", background="#3C3C3C", foreground="#FFFFFF", padding=6)
        style.configure("TLabel", background="#1E1E1E", foreground="#FFFFFF")
        style.configure("TFrame", background="#1E1E1E")
        
        # Top control frame
        control_frame = ttk.Frame(self.root)
        control_frame.pack(side=tk.TOP, fill=tk.X, pady=10, padx=10)
        
        # Start / Stop Button
        self.start_button = ttk.Button(control_frame, text="Start", command=self.toggle_recognition)
        self.start_button.pack(side=tk.LEFT, padx=(0,10))
        
        # Clear History Button
        self.clear_button = ttk.Button(control_frame, text="Clear History", command=self.clear_history)
        self.clear_button.pack(side=tk.LEFT, padx=(0,10))
        
        # Settings icon (gear)
        # Using a unicode gear icon "⚙️", or ASCII fallback
        settings_button = ttk.Button(control_frame, text="⚙️", command=self.open_settings_window)
        settings_button.pack(side=tk.RIGHT)
        
        # Transcription display
        self.recognition_text = scrolledtext.ScrolledText(
            self.root, 
            height=10,
            wrap=tk.WORD, 
            font=("Helvetica", 16), 
            bg="#2D2D2D", 
            fg="#FFFFFF",
            borderwidth=0, 
            highlightthickness=0
        )
        self.recognition_text.pack(fill="both", expand=True, padx=20, pady=20)
        
    def toggle_recognition(self):
        if self.is_running:
            self.stop_recognition()
        else:
            self.start_recognition()
    
    def start_recognition(self):
        if self.is_running or self._closed:
            return
        session = _RecognitionSession(
            self.input_language, self.output_language, self.second_output_language
        )
        self._active_session = session
        try:
            self.is_running = True
            self.start_button.configure(text="Stop", state="disabled")
            self.recognition_text.mark_set("current_recognition_start", tk.END)
            self.recognition_thread = threading.Thread(
                target=self.recognition_thread_func, args=(session,), daemon=True
            )
            self.recognition_thread.start()
            self._button_timer = self.root.after(100, self._enable_start_button, session)
        except Exception as error:
            session.stop_event.set()
            self._active_session = None
            self.is_running = False
            self.update_display(f"Error starting recognition: {error}\n", "error")
            self.start_button.configure(text="Start", state="normal")

    def _enable_start_button(self, session):
        if not self._closed and session is self._active_session:
            self._button_timer = None
            self.start_button.configure(state="normal")

    def _queue_event(self, session, kind, *data):
        # SDK callbacks and workers never call Tk, including root.after.
        if not self._closed:
            self._events.put((session, kind, data))

    def _drain_events(self):
        self._event_timer = None
        if self._closed:
            return
        # Bound each turn so a busy recognizer cannot starve the Tk main loop.
        for _ in range(100):
            try:
                session, kind, data = self._events.get_nowait()
            except queue.Empty:
                break
            if session is not self._active_session:
                continue
            if kind == "result":
                original, translations, status = data
                self.update_bilingual_display(
                    original, translations, status, session.input_language
                )
            elif kind == "error":
                self.update_display(data[0], "error")
            elif kind == "finished":
                self._active_session = None
                self.is_running = False
                self.start_button.configure(text="Start", state="normal")
        self._event_timer = self.root.after(50, self._drain_events)

    def recognition_thread_func(self, session):
        # A replacement may wait for old SDK cleanup, without blocking Tk or
        # sharing a recognizer. A stopped waiting session never opens the mic.
        with self._recognizer_lock:
            recognizer = None
            try:
                if session.stop_event.is_set():
                    return
                key = os.getenv('SPEECH_KEY')
                region = os.getenv('SPEECH_REGION')
                if not key or not region:
                    raise ValueError("Speech credentials not found. Please check your .env file.")
                speech_config = speechsdk.translation.SpeechTranslationConfig(
                    subscription=key, region=region
                )
                speech_config.speech_recognition_language = session.input_language
                for language in session.target_languages:
                    speech_config.add_target_language(language)
                if session.stop_event.is_set():
                    return
                audio_config = speechsdk.audio.AudioConfig(use_default_microphone=True)
                recognizer = speechsdk.translation.TranslationRecognizer(
                    translation_config=speech_config, audio_config=audio_config
                )

                def handle_recognizing(event):
                    result = event.result
                    if not session.stop_event.is_set() and result.reason == speechsdk.ResultReason.TranslatingSpeech:
                        self._queue_event(
                            session, "result", result.text, dict(result.translations.items()), "recognizing"
                        )

                def handle_recognized(event):
                    if session.stop_event.is_set():
                        return
                    result = event.result
                    if result.reason == speechsdk.ResultReason.TranslatedSpeech:
                        self._queue_event(
                            session, "result", result.text, dict(result.translations.items()), "final"
                        )
                    elif result.reason == speechsdk.ResultReason.NoMatch:
                        self._queue_event(session, "error", "No speech could be recognized.\n")

                def handle_canceled(event):
                    if session.stop_event.is_set():
                        return
                    if event.reason == speechsdk.CancellationReason.Error:
                        self._queue_event(session, "error", f"CANCELED: Error={event.error_details}\n")
                    session.stop_event.set()

                recognizer.recognizing.connect(handle_recognizing)
                recognizer.recognized.connect(handle_recognized)
                recognizer.canceled.connect(handle_canceled)
                recognizer.session_stopped.connect(lambda _event: session.stop_event.set())
                if session.stop_event.is_set():
                    return
                recognizer.start_continuous_recognition()
                session.stop_event.wait()
            except Exception as error:
                self._queue_event(session, "error", f"Recognition error: {error}\n")
            finally:
                session.stop_event.set()
                if recognizer is not None:
                    try:
                        recognizer.stop_continuous_recognition()
                    except Exception as error:
                        self._queue_event(session, "error", f"Error stopping recognition: {error}\n")
                self._queue_event(session, "finished")

    def stop_recognition(self):
        session = self._active_session
        self._active_session = None
        self.is_running = False
        if session is not None:
            session.stop_event.set()
        if self._button_timer is not None:
            self.root.after_cancel(self._button_timer)
            self._button_timer = None
        if not self._closed:
            self.start_button.configure(text="Start", state="normal")

    def on_closing(self):
        if self._closed:
            return
        self._closed = True
        self.stop_recognition()
        if self._event_timer is not None:
            self.root.after_cancel(self._event_timer)
            self._event_timer = None
        # SDK startup/cleanup can block; daemon workers finish without Tk.
        self.root.destroy()

    def update_bilingual_display(self, original_text, translations, status, input_language=None):
        text_block = f"Original ({input_language or self.input_language}): {original_text}"
        for lang, trans in translations.items():
            text_block += f"\nTranslation ({lang}): {trans}"

        if self.recognition_text.tag_ranges("current_recognition"):
            self.recognition_text.delete("current_recognition.first", "current_recognition.last")
            self.recognition_text.tag_remove("current_recognition", "1.0", tk.END)
        content = self.recognition_text.get("1.0", "end-1c")
        if content and not content.endswith("\n"):
            self.recognition_text.insert(tk.END, "\n")
        # Tk's end index includes its mandatory trailing newline. Use the
        # actual content end so the provisional tag covers the inserted words.
        start_index = self.recognition_text.index("end-1c")
        self.recognition_text.insert(tk.END, text_block)
        if status == "recognizing":
            end_index = self.recognition_text.index("end-1c")
            self.recognition_text.tag_add("current_recognition", start_index, end_index)
        else:
            self.recognition_text.insert(tk.END, "\n")
        self.recognition_text.see(tk.END)

    def update_display(self, text, status):
        # For simple error messages or direct inserts
        content = self.recognition_text.get("1.0", tk.END).strip()
        lines = content.splitlines()
        
        if status == "error":
            self.recognition_text.insert(tk.END, "\n" + text)
        else:
            # Just append text
            if lines:
                self.recognition_text.insert(tk.END, "\n" + text)
            else:
                self.recognition_text.insert(tk.END, text)
        
        self.recognition_text.see(tk.END)
        
    def clear_history(self):
        self.recognition_text.delete(1.0, tk.END)
    
    def open_settings_window(self):
        # Use Entry widgets instead of Comboboxes
        settings_win = tk.Toplevel(self.root)
        settings_win.title("Settings")
        settings_win.geometry("300x250")
        settings_win.transient(self.root)
        settings_win.grab_set()
        
        ttk.Label(settings_win, text="Input Language (e.g., en-US):").pack(pady=5)
        input_entry = ttk.Entry(settings_win)
        input_entry.insert(0, self.input_language)
        input_entry.pack(pady=5)
        
        ttk.Label(settings_win, text="Output Language (e.g., yue):").pack(pady=5)
        output_entry = ttk.Entry(settings_win)
        output_entry.insert(0, self.output_language)
        output_entry.pack(pady=5)
        
        ttk.Label(settings_win, text="Second Output Language (optional, e.g., ja):").pack(pady=5)
        second_output_entry = ttk.Entry(settings_win)
        second_output_entry.insert(0, self.second_output_language)
        second_output_entry.pack(pady=5)
        
        def apply_settings():
            self.input_language = input_entry.get()
            self.output_language = output_entry.get()
            self.second_output_language = second_output_entry.get()
            self.save_settings()
            settings_win.destroy()
        
        apply_button = ttk.Button(settings_win, text="Save & Close", command=apply_settings)
        apply_button.pack(pady=10)

if __name__ == "__main__":
    root = tk.Tk()
    app = TranslatorApp(root)
    root.mainloop()
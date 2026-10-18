"""Headless desktop behavior tests: stdlib only, no SDK, key or microphone."""
import importlib.util
import os
from pathlib import Path
import sys
import threading
import time
import types
import unittest
from unittest.mock import patch


class Signal:
    def connect(self, callback):
        self.callback = callback

    def emit(self, event):
        self.callback(event)


class Recognizer:
    def __init__(self, backend):
        self.backend = backend
        self.start_entered = threading.Event()
        self.start_gate = threading.Event()
        self.stop_entered = threading.Event()
        self.stop_gate = threading.Event()
        self.stop_gate.set()
        self.stop_calls = 0
        if not backend.block_start:
            self.start_gate.set()
        for name in ('recognizing', 'recognized', 'canceled', 'session_started', 'session_stopped'):
            setattr(self, name, Signal())

    def start_continuous_recognition(self):
        self.start_entered.set()
        self.start_gate.wait(5)

    def stop_continuous_recognition(self):
        self.stop_calls += 1
        self.stop_entered.set()
        self.stop_gate.wait(5)


class Backend:
    def __init__(self):
        self.block_start = False
        self.recognizers = []
        self.condition = threading.Condition()
        self.config_calls = 0
        self.sdk = types.ModuleType('azure.cognitiveservices.speech')
        self.sdk.ResultReason = types.SimpleNamespace(TranslatingSpeech=1, TranslatedSpeech=2, NoMatch=3, Canceled=5)
        self.sdk.CancellationReason = types.SimpleNamespace(Error=4, EndOfStream=6)
        self.sdk.audio = types.SimpleNamespace(AudioConfig=lambda **_: object())
        self.sdk.translation = types.SimpleNamespace(SpeechTranslationConfig=self.config,
                                                     TranslationRecognizer=self.recognizer)

    def config(self, **_):
        self.config_calls += 1
        return types.SimpleNamespace(add_target_language=lambda _: None)

    def recognizer(self, **_):
        item = Recognizer(self)
        with self.condition:
            self.recognizers.append(item)
            self.condition.notify_all()
        return item

    def wait_for_recognizer(self, index=0):
        with self.condition:
            if not self.condition.wait_for(lambda: len(self.recognizers) > index, timeout=3):
                raise AssertionError('The requested recognition session did not reach the SDK')
            item = self.recognizers[index]
        if not item.start_entered.wait(3):
            raise AssertionError('The recognizer did not reach its start barrier')
        return item

    def release(self):
        for item in self.recognizers:
            item.start_gate.set()
            item.stop_gate.set()


def load_module(backend):
    tk = types.ModuleType('tkinter')
    tk.END = 'end'
    tk.TclError = RuntimeError
    tk.ttk = types.ModuleType('tkinter.ttk')
    tk.scrolledtext = types.ModuleType('tkinter.scrolledtext')
    dotenv = types.ModuleType('dotenv')
    dotenv.load_dotenv = lambda: None
    azure = types.ModuleType('azure')
    azure.cognitiveservices = types.ModuleType('azure.cognitiveservices')
    azure.cognitiveservices.speech = backend.sdk
    modules = {'tkinter': tk, 'tkinter.ttk': tk.ttk, 'tkinter.scrolledtext': tk.scrolledtext,
               'dotenv': dotenv, 'azure': azure, 'azure.cognitiveservices': azure.cognitiveservices,
               'azure.cognitiveservices.speech': backend.sdk}
    path = Path(__file__).resolve().parents[1] / 'translator_app.py'
    with patch.dict(sys.modules, modules):
        spec = importlib.util.spec_from_file_location('desktop_under_test', path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    return module


class Root:
    def __init__(self):
        self.owner = threading.get_ident()
        self.closed = False
        self.violations = []
        self.pending = {}
        self.sequence = 0
        self.lock = threading.Lock()

    def check(self, operation):
        if threading.get_ident() != self.owner:
            self.violations.append('Worker called Tk: ' + operation)
        if self.closed:
            self.violations.append('Tk called after destruction: ' + operation)

    def title(self, *_, **__):
        self.check('title')

    wm_attributes = configure = geometry = protocol = title

    def after(self, delay, callback, *args):
        self.check('after')
        with self.lock:
            self.sequence += 1
            key = self.sequence
            self.pending[key] = (callback, args)
        return key

    def after_cancel(self, key):
        self.check('after_cancel')
        with self.lock:
            self.pending.pop(key, None)

    def pump(self):
        # Run one main-loop turn; callbacks scheduled by it belong to a later turn.
        with self.lock:
            turn = list(self.pending.items())
        for key, _ in turn:
            with self.lock:
                current = self.pending.pop(key, None)
            if current:
                callback, args = current
                callback(*args)

    def destroy(self):
        self.check('destroy')
        self.closed = True


class Text:
    def __init__(self, root):
        self.root = root
        self.content = ''
        self.tags = {}

    def index(self, where):
        self.root.check('text.index')
        return str(len(self.content)) if self.content else '1.0'

    def _position(self, value):
        if value in ('end', 'end-1c'):
            return len(self.content)
        if value.endswith('.first'):
            return self.tags[value[:-6]][0]
        if value.endswith('.last'):
            return self.tags[value[:-5]][1]
        return 0 if value == '1.0' else int(value)

    def tag_ranges(self, tag):
        self.root.check('text.tag_ranges')
        return self.tags.get(tag, ())

    def delete(self, start, end):
        self.root.check('text.delete')
        a, b = self._position(str(start)), self._position(str(end))
        self.content = self.content[:a] + self.content[b:]
        self.tags.clear()

    def insert(self, where, text):
        self.root.check('text.insert')
        position = self._position(where)
        self.content = self.content[:position] + text + self.content[position:]

    def tag_add(self, tag, start, end):
        self.root.check('text.tag_add')
        self.tags[tag] = (self._position(start), self._position(end))

    def tag_remove(self, tag, *_):
        self.root.check('text.tag_remove')
        self.tags.pop(tag, None)

    def mark_set(self, *_):
        self.root.check('text.mark_set')

    def see(self, *_):
        self.root.check('text.see')

    def get(self, *_):
        self.root.check('text.get')
        return self.content


class Button:
    def __init__(self, root):
        self.root = root
        self.values = {'text': 'Start', 'state': 'normal'}

    def configure(self, **values):
        self.root.check('button.configure')
        self.values.update(values)


class DesktopTests(unittest.TestCase):
    def setUp(self):
        self.backend = Backend()
        self.module = load_module(self.backend)
        self.root = Root()
        self.threads = []
        self.credentials = patch.dict(os.environ, {'SPEECH_KEY': 'test-placeholder', 'SPEECH_REGION': 'test-region'})
        self.credentials.start()

        def settings(app):
            app.input_language = 'en-US'
            app.output_language = 'ja'
            app.second_output_language = ''

        def ui(app):
            app.recognition_text = Text(self.root)
            app.start_button = Button(self.root)

        with patch.object(self.module.TranslatorApp, 'load_settings', settings), \
                patch.object(self.module.TranslatorApp, 'create_main_ui', ui):
            self.app = self.module.TranslatorApp(self.root)

    def tearDown(self):
        if not self.root.closed:
            self.app.on_closing()
        self.backend.release()
        for item in self.threads:
            item.join(3)
        self.credentials.stop()

    def start(self):
        self.app.start_recognition()
        self.threads.append(self.app.recognition_thread)

    def pump_until(self, predicate):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            self.root.pump()
            if predicate():
                return
            threading.Event().wait(0.005)
        self.fail('The desktop main loop did not reach the requested state')

    def result(self, text, final=True):
        reason = self.backend.sdk.ResultReason.TranslatedSpeech if final else self.backend.sdk.ResultReason.TranslatingSpeech
        return types.SimpleNamespace(result=types.SimpleNamespace(reason=reason, text=text, translations={'ja': text + ' translated'}))

    def cancellation(self):
        return types.SimpleNamespace(reason=self.backend.sdk.CancellationReason.Error,
                                     error_details='Authentication failed',
                                     result=types.SimpleNamespace(reason=self.backend.sdk.ResultReason.Canceled))

    def test_final_result_is_retained_without_an_interim_result(self):
        self.app.update_bilingual_display('Complete sentence.', {'ja': 'Final translation.'}, 'final')
        self.assertIn('Complete sentence.', self.app.recognition_text.content,
                      'Final-only recognition must retain its transcript')
        self.assertIn('Final translation.', self.app.recognition_text.content)

    def test_changed_final_replaces_the_interim_words_and_translations(self):
        self.app.update_bilingual_display('Draft fragment', {'ja': 'Draft translation'}, 'recognizing')
        self.app.update_bilingual_display('Complete sentence.', {'ja': 'Final translation.'}, 'final')
        content = self.app.recognition_text.content
        self.assertIn('Complete sentence.', content, 'The final transcript must replace stale interim words')
        self.assertIn('Final translation.', content)
        self.assertNotIn('Draft fragment', content)
        self.assertNotIn('Draft translation', content)

    def test_later_final_preserves_previous_final_history(self):
        self.app.update_bilingual_display('Earlier sentence.', {'ja': 'Earlier translation.'}, 'final')
        self.app.update_bilingual_display('Draft', {'ja': 'Draft'}, 'recognizing')
        self.app.update_bilingual_display('Later sentence.', {'ja': 'Later translation.'}, 'final')
        content = self.app.recognition_text.content
        self.assertIn('Earlier sentence.', content)
        self.assertIn('Later sentence.', content)
        self.assertNotIn('Draft', content)

    def test_cancellation_displays_the_provider_error_from_the_event(self):
        self.start()
        recognizer = self.backend.wait_for_recognizer()
        recognizer.canceled.emit(self.cancellation())
        self.pump_until(lambda: not self.app.is_running)
        self.assertIn('Authentication failed', self.app.recognition_text.content,
                      'Azure cancellation error_details must reach the existing error display')

    def test_worker_and_sdk_callbacks_never_invoke_tk(self):
        self.start()
        recognizer = self.backend.wait_for_recognizer()
        caller = threading.Thread(target=lambda: recognizer.recognizing.emit(self.result('Worker transcript', final=False)))
        caller.start()
        caller.join(3)
        self.pump_until(lambda: 'Worker transcript' in self.app.recognition_text.content)
        self.assertEqual([], self.root.violations, 'Only the main Tk thread may call Tk APIs')

    def test_stop_restart_and_late_callbacks_cannot_change_the_new_session(self):
        self.backend.block_start = True
        self.start()
        old = self.backend.wait_for_recognizer()
        self.app.stop_recognition()
        self.backend.block_start = False
        self.start()
        old.start_gate.set()
        current = self.backend.wait_for_recognizer(1)
        self.assertTrue(old.stop_entered.wait(3), 'Stopped startup must clean up its own recognizer')
        self.root.pump()
        self.assertTrue(self.app.is_running, 'The old worker must not reset replacement session state')
        self.assertEqual('Stop', self.app.start_button.values['text'])
        self.assertEqual(0, current.stop_calls, 'The old session must not stop the replacement recognizer')
        old.recognized.emit(self.result('Obsolete result'))
        old.canceled.emit(self.cancellation())
        self.root.pump()
        self.assertTrue(self.app.is_running, 'Stale cancellation must not stop the current session')
        self.assertNotIn('Obsolete result', self.app.recognition_text.content)
        self.assertNotIn('Authentication failed', self.app.recognition_text.content)
        current.recognized.emit(self.result('Current result'))
        self.pump_until(lambda: 'Current result' in self.app.recognition_text.content)
        self.assertEqual(1, old.stop_calls)

    def test_close_is_bounded_during_sdk_start_and_cancels_tk_callbacks(self):
        self.backend.block_start = True
        self.start()
        recognizer = self.backend.wait_for_recognizer()
        before = time.monotonic()
        self.app.on_closing()
        self.assertLess(time.monotonic() - before, 0.25, 'Window close must not join blocked SDK startup')
        recognizer.start_gate.set()
        self.assertTrue(recognizer.stop_entered.wait(3))
        self.app.recognition_thread.join(3)
        self.assertFalse(self.app.recognition_thread.is_alive())
        self.assertEqual({}, self.root.pending, 'Close must cancel callbacks scheduled for destroyed widgets')
        self.assertEqual([], self.root.violations, 'Workers must never call Tk after window destruction')

    def test_close_is_bounded_during_sdk_stop(self):
        self.start()
        recognizer = self.backend.wait_for_recognizer()
        recognizer.stop_gate.clear()
        self.app.stop_recognition()
        self.assertTrue(recognizer.stop_entered.wait(3))
        before = time.monotonic()
        self.app.on_closing()
        self.assertLess(time.monotonic() - before, 0.25, 'Window close must not join blocked SDK cleanup')
        recognizer.stop_gate.set()
        self.app.recognition_thread.join(3)
        self.assertEqual([], self.root.violations)

    def test_missing_credentials_are_checked_before_creating_sdk_config(self):
        with patch.dict(os.environ, {}, clear=True):
            self.start()
            self.app.recognition_thread.join(3)
            self.root.pump()
        self.assertEqual(0, self.backend.config_calls, 'Missing credentials must be rejected before SDK construction')
        self.assertIn('Speech credentials not found', self.app.recognition_text.content)

    def test_session_results_keep_the_language_captured_when_started(self):
        self.start()
        recognizer = self.backend.wait_for_recognizer()
        self.app.input_language = 'de-DE'
        recognizer.recognized.emit(self.result('Original session'))
        self.pump_until(lambda: 'Original session' in self.app.recognition_text.content)
        self.assertIn('Original (en-US)', self.app.recognition_text.content,
                      'Settings changes must not relabel an existing session')
        self.assertNotIn('Original (de-DE)', self.app.recognition_text.content)


if __name__ == '__main__':
    unittest.main()

"""Desktop settings regressions; every file lives in a temporary directory."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

if __package__:
    from .test_desktop import Backend, Button, Root, Text, load_module
else:
    from test_desktop import Backend, Button, Root, Text, load_module


FIELDS = ('input_language', 'output_language', 'second_output_language')
DEFAULTS = ('en-US', 'yue', '')


class DesktopSettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'settings.json'
        self.backend = Backend()
        self.module = load_module(self.backend)
        self.module.SETTINGS_FILE = str(self.path)
        self.apps = []
        self.credentials = patch.dict(os.environ, {'SPEECH_KEY': 'test-placeholder', 'SPEECH_REGION': 'test-region'})
        self.credentials.start()
        self.addCleanup(self.credentials.stop)

    def tearDown(self):
        for app in self.apps:
            app.on_closing()
        self.backend.release()
        for app in self.apps:
            if app.recognition_thread is not None:
                app.recognition_thread.join(3)

    def create_app(self, payload=None, raw=None):
        if raw is not None:
            self.path.write_text(raw, encoding='utf-8')
        elif payload is not None:
            self.path.write_text(json.dumps(payload), encoding='utf-8')
        root = Root()

        def ui(app):
            app.recognition_text = Text(root)
            app.start_button = Button(root)

        with patch.object(self.module.TranslatorApp, 'create_main_ui', ui):
            app = self.module.TranslatorApp(root)
        self.apps.append(app)
        return app

    def state(self, app):
        return tuple(getattr(app, name) for name in FIELDS)

    def choose(self, app, values=('fr-FR', 'de', 'ja')):
        for name, value in zip(FIELDS, values):
            setattr(app, name, value)

    def test_invalid_language_types_fall_back_independently(self):
        valid = {'input_language': 'fr-FR', 'output_language': 'de', 'second_output_language': 'ja'}
        for index, field in enumerate(FIELDS):
            for bad in (None, 42, False, [], {}, ['ja']):
                with self.subTest(field=field, value=bad):
                    data = {**valid, field: bad}
                    app = self.create_app(data)
                    expected = list(valid.values())
                    expected[index] = DEFAULTS[index]
                    self.assertEqual(tuple(expected), self.state(app),
                                     'Invalid persisted fields must not discard the other valid languages')

    def test_blank_required_languages_use_defaults_and_optional_is_empty(self):
        app = self.create_app({'input_language': '  ', 'output_language': '', 'second_output_language': '  '})
        self.assertEqual(DEFAULTS, self.state(app), 'Blank required language choices must remain usable')

    def test_valid_language_strings_survive_loading(self):
        values = ('zh-HK', 'zh-Hant', 'en')
        app = self.create_app(dict(zip(FIELDS, values)))
        self.assertEqual(values, self.state(app))

    def test_missing_malformed_and_nonobject_files_keep_startup_usable(self):
        self.assertEqual(DEFAULTS, self.state(self.create_app()))
        for raw in ('{broken', '[]', 'null', '42'):
            with self.subTest(raw=raw):
                self.assertEqual(DEFAULTS, self.state(self.create_app(raw=raw)))

    def test_unreadable_settings_keep_startup_usable(self):
        self.path.write_text('{}', encoding='utf-8')
        with patch('builtins.open', side_effect=PermissionError('read denied')):
            app = self.create_app()
        self.assertEqual(DEFAULTS, self.state(app))

    def test_invalid_saved_types_cannot_crash_recognition_start(self):
        app = self.create_app({'input_language': None, 'output_language': 42, 'second_output_language': []})
        app.start_recognition()
        recognizer = self.backend.wait_for_recognizer()
        self.assertTrue(recognizer.start_entered.is_set(), 'Recovered settings must allow recognition to start')
        app.stop_recognition()

    def test_successful_save_replaces_a_sibling_file_with_complete_json(self):
        app = self.create_app(dict(zip(FIELDS, DEFAULTS)))
        self.choose(app)
        real_replace = os.replace
        with patch.object(self.module.os, 'replace', wraps=real_replace) as replace:
            self.assertTrue(app.save_settings())
        replace.assert_called_once()
        source, target = map(Path, replace.call_args.args)
        self.assertEqual(self.path.parent, source.parent, 'Atomic replacement must stay on the same filesystem')
        self.assertEqual(self.path, target)
        self.assertFalse(source.exists(), 'Successful replacement must leave no temporary file')
        self.assertEqual(dict(zip(FIELDS, self.state(app))), json.loads(self.path.read_text()))
        self.assertEqual([self.path], list(self.path.parent.iterdir()))

    def test_failed_replace_preserves_disk_and_current_memory_choices(self):
        app = self.create_app(dict(zip(FIELDS, DEFAULTS)))
        original = self.path.read_bytes()
        self.choose(app)
        with patch.object(self.module.os, 'replace', side_effect=PermissionError('replace denied')):
            self.assertFalse(app.save_settings(), 'A failed save must be reported without escaping the callback')
        self.assertEqual(original, self.path.read_bytes(), 'Failed replacement must preserve the last valid settings')
        self.assertEqual(('fr-FR', 'de', 'ja'), self.state(app), 'Current choices must remain usable in memory')
        self.assertIn('Error saving settings', app.recognition_text.content)
        self.assertEqual([self.path], list(self.path.parent.iterdir()), 'Failed replacement must clean up temporary files')

    def test_partial_write_failure_preserves_last_valid_file(self):
        app = self.create_app(dict(zip(FIELDS, DEFAULTS)))
        original = self.path.read_bytes()
        self.choose(app)

        def fail_write(data, stream, **kwargs):
            stream.write('{"partial":')
            raise OSError('disk full')

        with patch.object(self.module.json, 'dump', side_effect=fail_write):
            self.assertFalse(app.save_settings())
        self.assertEqual(original, self.path.read_bytes(), 'A partial write must never truncate the destination')
        self.assertEqual(('fr-FR', 'de', 'ja'), self.state(app))
        self.assertEqual([self.path], list(self.path.parent.iterdir()))
        self.assertIn('Error saving settings', app.recognition_text.content)

    def test_failed_save_leaves_current_choices_ready_for_recognition(self):
        app = self.create_app(dict(zip(FIELDS, DEFAULTS)))
        self.choose(app)
        with patch.object(self.module.os, 'replace', side_effect=OSError('read-only directory')):
            app.save_settings()
        app.start_recognition()
        self.backend.wait_for_recognizer()
        self.assertTrue(app.is_running)
        self.assertEqual(('fr-FR', 'de', 'ja'), self.state(app))
        app.stop_recognition()

    def test_settings_dialog_save_failure_uses_existing_error_area(self):
        app = self.create_app(dict(zip(FIELDS, DEFAULTS)))
        original = self.path.read_bytes()
        entries = []
        buttons = []

        class Widget:
            def __init__(self, *args, **kwargs):
                self.command = kwargs.get('command')
            def pack(self, *args, **kwargs):
                pass

        class Entry(Widget):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                entries.append(self)
            def insert(self, index, value):
                self.value = value
            def get(self):
                return self.value

        class Window:
            closed = False
            def title(self, *args):
                pass
            geometry = transient = grab_set = title
            def destroy(self):
                self.closed = True

        window = Window()

        def button(*args, **kwargs):
            value = Widget(*args, **kwargs)
            buttons.append(value)
            return value

        with patch.object(self.module.tk, 'Toplevel', lambda root: window, create=True), \
                patch.object(self.module.ttk, 'Label', Widget, create=True), \
                patch.object(self.module.ttk, 'Entry', Entry, create=True), \
                patch.object(self.module.ttk, 'Button', button, create=True):
            app.open_settings_window()
            for entry, value in zip(entries, ('fr-FR', 'de', 'ja')):
                entry.value = value
            with patch.object(self.module.json, 'dump', side_effect=OSError('disk full')):
                buttons[0].command()
        self.assertTrue(window.closed, 'Save & Close must still finish after a handled persistence failure')
        self.assertEqual(('fr-FR', 'de', 'ja'), self.state(app))
        self.assertEqual(original, self.path.read_bytes())
        self.assertIn('Error saving settings', app.recognition_text.content)


if __name__ == '__main__':
    unittest.main()

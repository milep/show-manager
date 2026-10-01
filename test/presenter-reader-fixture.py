# Executed by Vitest after the exact shipped reader source, in an isolated process.
import tempfile
import unittest
from unittest.mock import patch


class ReaderTests(unittest.TestCase):
    def event(self, code, value=1, kind=1, age=0):
        now = time.time() - age
        seconds = int(now)
        return (seconds, int((now - seconds) * 1000000), kind, code, value)

    def test_captured_buttons_repeats_releases_and_unmapped_keys(self):
        keys = Keys()
        def press(code, value=1, kind=1, age=0):
            return keys.action(self.event(code, value, kind, age), time.time())
        self.assertIsNone(press(63))  # F5 without the captured Shift is not Play.
        press(63, 0)
        self.assertIsNone(press(42))
        self.assertEqual(press(63), 'play')
        self.assertIsNone(press(63, 2))
        self.assertIsNone(press(63))
        self.assertIsNone(press(63, 0))
        press(42, 0)
        self.assertEqual(press(48), 'pause')
        self.assertIsNone(press(48, 0))
        self.assertEqual(press(109), 'next')
        self.assertIsNone(press(109, 2))
        self.assertIsNone(press(109))
        self.assertIsNone(press(109, 0))
        for code in (57, 28, 164, 165, 166, 62, 108):
            self.assertIsNone(press(code))
        self.assertIsNone(press(109, age=10))  # Otherwise valid stale press.
        press(109, 0)
        self.assertIsNone(press(3, kind=0))  # Lost kernel events invalidate chord state.
        self.assertIsNone(press(48))
        press(0, kind=0)
        self.assertIsNone(press(63))

    def test_plain_tab_chain_and_alt_tab_windows_are_distinct(self):
        keys = Keys()
        def press(code, value=1):
            return keys.action(self.event(code, value), time.time())
        self.assertEqual(press(15), 'start-pippalot')
        self.assertIsNone(press(15, 2))
        self.assertIsNone(press(15))
        self.assertIsNone(press(15, 0))
        self.assertIsNone(press(56))
        self.assertEqual(press(15), 'pause-tv-off')
        self.assertIsNone(press(15, 2))
        self.assertIsNone(press(15))
        self.assertIsNone(press(15, 0))
        # Captured Alt remains held 1.45s after Tab-up. Release never dispatches.
        self.assertIsNone(press(56, 0))
        self.assertEqual(press(15), 'start-pippalot')
        press(15, 0)
        for modifier in (42, 54, 100, 29, 97, 125, 126):
            press(modifier)
            self.assertIsNone(press(15))  # Modified Tab must not become Chain.
            press(15, 0)
            press(modifier, 0)

    def test_stable_usb_identity_and_multiple_interfaces(self):
        with tempfile.TemporaryDirectory(prefix='hasacool-fixture-') as root:
            root = Path(root)
            sys_root = root / 'input'
            sys_root.mkdir()
            usb = root / 'usb'
            usb.mkdir()
            for name, value in [('idVendor', '3151'), ('idProduct', '3021'), ('serial', 'b120300001')]:
                (usb / name).write_text(value)
            for number in (27, 91):
                device = usb / ('interface' + str(number)) / 'input'
                device.mkdir(parents=True)
                (device / 'name').write_text('Smart 2.4G Receiver\n')
                entry = sys_root / ('event' + str(number))
                entry.mkdir()
                (entry / 'device').symlink_to(device)
            expected = {str(root / 'dev' / 'event27'), str(root / 'dev' / 'event91')}
            self.assertEqual(set(receiver_nodes(sys_root, root / 'dev')), expected)
            for field, wrong in [('idVendor', '9999'), ('idProduct', '3022'), ('serial', 'other')]:
                original = (usb / field).read_text()
                (usb / field).write_text(wrong)
                self.assertEqual(receiver_nodes(sys_root, root / 'dev'), [])
                (usb / field).write_text(original)
            (usb / 'interface27' / 'input' / 'name').write_text('Other keyboard')
            self.assertEqual(receiver_nodes(sys_root, root / 'dev'), [str(root / 'dev' / 'event91')])
            (usb / 'serial').unlink()
            self.assertEqual(receiver_nodes(sys_root, root / 'dev'), [])

    def test_open_drains_old_events_and_readonly_nonblocking(self):
        with patch.object(os, 'open', return_value=77) as opened, \
             patch.object(os, 'read', side_effect=[b'old-event', BlockingIOError()]):
            self.assertEqual(open_node('/fixture/event27'), 77)
            opened.assert_called_once_with('/fixture/event27', os.O_RDONLY | os.O_NONBLOCK)
        with patch.object(os, 'open', side_effect=PermissionError()):
            with self.assertRaises(PermissionError):
                open_node('/fixture/event27')

    def test_duplicate_chords_and_next_debounced_in_stream_then_eof_cleanup(self):
        chord = [self.event(42), self.event(63), self.event(63, 0), self.event(42, 0)]
        nxt = [self.event(109), self.event(109, 2), self.event(109, 0)]
        data = b''.join(EVENT.pack(*e) for e in chord + nxt)
        clock = iter([0, 0, 1.0, 1.01, 1.093, 1.1, 1.4, 1.4])
        with patch('__main__.receiver_nodes', return_value=['fixture']), \
             patch('__main__.open_node', return_value=77), \
             patch.object(time, 'monotonic', side_effect=lambda: next(clock)), \
             patch.object(select, 'select', side_effect=[([77], [], []), ([77], [], []), ([0], [], [])]), \
             patch.object(os, 'read', side_effect=[data, data, b'']), \
             patch.object(os, 'close') as closed, patch('builtins.print') as output:
            run()
            frames = [json.loads(call.args[0]) for call in output.call_args_list]
            self.assertEqual([f['action'] for f in frames], ['play', 'next'])
            self.assertTrue(all(f['type'] == 'hasacool' and f['version'] == 1 for f in frames))
            closed.assert_called_once_with(77)

    def test_absent_unreadable_and_lease_expiry_are_quiet(self):
        for nodes in ([], ['fixture']):
            clock = iter([0, 0, 1, 2, 2, 11])
            with patch('__main__.receiver_nodes', return_value=nodes), \
                 patch('__main__.open_node', side_effect=PermissionError()), \
                 patch.object(time, 'monotonic', side_effect=lambda: next(clock)), \
                 patch.object(select, 'select', return_value=([], [], [])), \
                 patch('builtins.print') as output:
                run()
                output.assert_not_called()

    def test_reader_fd_is_closed_on_lease_expiry(self):
        clock = iter([0, 0, 1, 11])
        with patch('__main__.receiver_nodes', return_value=['fixture']), \
             patch('__main__.open_node', return_value=77), \
             patch.object(time, 'monotonic', side_effect=lambda: next(clock)), \
             patch.object(select, 'select', return_value=([], [], [])), \
             patch.object(os, 'close') as closed, patch('builtins.print') as output:
            run()
            closed.assert_called_once_with(77)
            output.assert_not_called()

    def test_device_read_failure_is_closed_then_reopened_without_actions(self):
        clock = iter([0, 0, 1, 2, 3, 3])
        with patch('__main__.receiver_nodes', return_value=['fixture']), \
             patch('__main__.open_node', side_effect=[77, 78]) as opened, \
             patch.object(time, 'monotonic', side_effect=lambda: next(clock)), \
             patch.object(select, 'select', side_effect=[([77], [], []), ([0], [], [])]), \
             patch.object(os, 'read', side_effect=[OSError('fixture ENODEV'), b'']), \
             patch.object(os, 'close') as closed, patch('builtins.print') as output:
            run()
            self.assertEqual(opened.call_count, 2)
            self.assertEqual([c.args[0] for c in closed.call_args_list], [77, 78])
            output.assert_not_called()

    def test_usb_detach_and_reattach_do_not_dispatch(self):
        clock = iter([0, 0, 1, 2, 3, 4, 5, 6, 7, 8])
        with patch('__main__.receiver_nodes', side_effect=[['fixture'], [], ['fixture']]), \
             patch('__main__.open_node', side_effect=[77, 78]) as opened, \
             patch.object(time, 'monotonic', side_effect=lambda: next(clock)), \
             patch.object(select, 'select', side_effect=[([], [], []), ([], [], []), ([0], [], [])]), \
             patch.object(os, 'read', return_value=b''), \
             patch.object(os, 'close') as closed, patch('builtins.print') as output:
            run()
            self.assertEqual(opened.call_count, 2)
            self.assertEqual([c.args[0] for c in closed.call_args_list], [77, 78])
            output.assert_not_called()


unittest.main(argv=['presenter-reader-fixture'], verbosity=2)

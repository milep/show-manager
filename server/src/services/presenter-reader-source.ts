// Kept as source so tsc ships the reader without a separate Pi install or build asset.
export const presenterReaderSource = String.raw`
import glob
import json
import os
import select
import struct
import sys
import time
from pathlib import Path

EVENT = struct.Struct('@llHHi')
DEBOUNCE = 0.3
LEASE_SECONDS = 10


def receiver_nodes(sys_root='/sys/class/input', dev_root='/dev/input'):
    nodes = []
    for entry in glob.glob(str(Path(sys_root) / 'event*')):
        device = (Path(entry) / 'device').resolve()
        try:
            if (device / 'name').read_text().strip() != 'Smart 2.4G Receiver':
                continue
            for parent in [device, *device.parents]:
                if (parent / 'idVendor').exists():
                    if ((parent / 'idVendor').read_text().strip().lower() == '3151'
                            and (parent / 'idProduct').read_text().strip().lower() == '3021'
                            and (parent / 'serial').read_text().strip() == 'b120300001'):
                        nodes.append(str(Path(dev_root) / Path(entry).name))
                    break
        except OSError:
            continue
    return nodes


class Keys:
    def __init__(self):
        self.down = set()
        self.dropped = False

    def action(self, event, now):
        seconds, micros, kind, code, value = event
        if kind == 0 and code == 3:  # SYN_DROPPED: state is no longer trustworthy.
            self.down.clear()
            self.dropped = True
        elif kind == 0 and code == 0:
            self.dropped = False
        if kind != 1 or self.dropped:
            return None
        if value == 0:
            self.down.discard(code)
            return None
        if value != 1 or code in self.down:
            return None
        self.down.add(code)
        if not 0 <= now - (seconds + micros / 1000000) <= 0.5:
            return None
        if code == 63 and 42 in self.down:
            return 'play'
        if code == 48:
            return 'pause'
        if code == 109:
            return 'next'
        if code == 15:
            if 56 in self.down:
                return 'pause-tv-off'
            if not self.down.intersection({42, 54, 56, 100, 29, 97, 125, 126}):
                return 'start-pippalot'
        return None


def open_node(node):
    fd = os.open(node, os.O_RDONLY | os.O_NONBLOCK)
    try:
        # Discard startup backlog. Reattach must never replay a prior press.
        while os.read(fd, EVENT.size * 64):
            pass
    except BlockingIOError:
        return fd
    except BaseException:
        os.close(fd)
        raise
    os.close(fd)
    raise OSError('input node closed')


def run():
    readers = {}
    last_action = {}
    last_scan = 0
    last_lease = time.monotonic()
    try:
        while time.monotonic() - last_lease < LEASE_SECONDS:
            mono = time.monotonic()
            if mono - last_scan >= 1:
                nodes = set(receiver_nodes())
                for node in list(readers):
                    if node not in nodes:
                        os.close(readers.pop(node)[0])
                for node in nodes - readers.keys():
                    try:
                        readers[node] = (open_node(node), Keys(), b'')
                    except OSError:
                        pass  # Missing/unreadable USB is retried without playback changes.
                last_scan = mono
            ready, _, _ = select.select([0, *[r[0] for r in readers.values()]], [], [], 0.25)
            if 0 in ready:
                if not os.read(0, 4096):
                    return
                last_lease = time.monotonic()
            for node, (fd, keys, buffered) in list(readers.items()):
                if fd not in ready:
                    continue
                try:
                    data = os.read(fd, EVENT.size * 64)
                    if not data:
                        raise OSError('input node closed')
                    buffered += data
                    while len(buffered) >= EVENT.size:
                        event = EVENT.unpack(buffered[:EVENT.size])
                        buffered = buffered[EVENT.size:]
                        action = keys.action(event, time.time())
                        if action and mono - last_action.get(action, -DEBOUNCE) >= DEBOUNCE:
                            last_action[action] = mono
                            print(json.dumps({'type': 'hasacool', 'version': 1,
                                              'action': action, 'at': int(time.time() * 1000)}), flush=True)
                    readers[node] = (fd, keys, buffered)
                except OSError:
                    os.close(fd)
                    readers.pop(node)
    finally:
        for fd, _, _ in readers.values():
            os.close(fd)


if __name__ == '__main__':
    run()
`;

# helper.py
import sys, struct, json, os
from pathlib import Path

def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4: return None
    msg_len = struct.unpack('<I', raw_len)[0]
    return json.loads(sys.stdin.buffer.read(msg_len).decode('utf-8'))

def send_message(obj):
    b = json.dumps(obj).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(b)))
    sys.stdout.buffer.write(b)
    sys.stdout.buffer.flush()

def main():
    while True:
        msg = read_message()
        if msg is None: break

        tid      = str(msg.get('ticketId'))
        loc      = msg.get('location')
        base_dir = (Path.home() / 'Downloads') if loc=='DOWNLOADS' else Path('V:/Tickets')
        folder   = base_dir / tid

        already = folder.exists()
        try:
            if not already:
                os.makedirs(folder)
            send_message({
                'success': True,
                'path': str(folder),
                'alreadyExisted': already
            })
        except Exception as e:
            send_message({
                'success': False,
                'error': str(e)
            })

if __name__ == '__main__':
    main()

# AGENTS.md

## Cursor Cloud specific instructions

### Product

**Globe Traceroute** — single Node.js app: Express serves `public/`, runs `traceroute`, geocodes hops via ipinfo.io, streams results over Socket.IO to a Three.js globe UI.

### Services

| Service | Required | Notes |
|---------|----------|--------|
| Node server (`npm start`) | Yes | Default `http://localhost:3000` (`PORT` env overrides) |
| `traceroute` CLI | Yes (for real hop data) | Not bundled; install once per VM (e.g. `sudo apt-get install -y traceroute`) |
| Outbound network | Yes | Targets like `1.1.1.1` |
| ipinfo.io, unpkg (Three.js), Wikimedia (Earth texture) | Optional | Browser/server fetch at runtime; private IPs use hardcoded geo fallback |

### Commands

See `package.json` scripts:

- **Install deps:** `npm install`
- **Run (prod):** `npm start` → `node server.js`
- **Run (dev):** `npm run dev` → nodemon

There is no `lint` or `test` script in this repo.

### Running the server in Cloud Agent VMs

Use tmux so the process stays up across shell sessions:

```bash
SESSION_NAME="globe-traceroute"
tmux -f /exec-daemon/tmux.portal.conf has-session -t "=$SESSION_NAME" 2>/dev/null \
  || tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "$SESSION_NAME" -c "/workspace" -- "${SHELL:-bash}" -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t "$SESSION_NAME:0.0" 'cd /workspace && npm start' C-m
```

### Verifying without a browser

Socket.IO client is not an npm dependency. Quick backend check:

```bash
pip install 'python-socketio[client]'
python3 -c "
import socketio
sio = socketio.Client()
@sio.event
def connect(): sio.emit('request-traceroute', {'target': '1.1.1.1'})
@sio.on('traceroute')
def on_traceroute(d):
    print(len(d.get('hops', [])), 'hops'); sio.disconnect()
sio.connect('http://localhost:3000'); sio.wait()
"
```

### Linux note

`traceroute` on Linux produces output the server parser handles (verified in Cloud VMs). macOS-style indented continuation lines are also supported.

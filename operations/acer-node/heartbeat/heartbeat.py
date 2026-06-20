from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime, timezone
import json
import socket

HOST = "0.0.0.0"
PORT = 5050

class HeartbeatHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        now = datetime.now(timezone.utc).isoformat()
        hostname = socket.gethostname()

        data = {
            "status": "alive",
            "service": "acer-node-heartbeat",
            "hostname": hostname,
            "time_utc": now,
            "message": "Acer Node heartbeat is running."
        }

        body = json.dumps(data, indent=2).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print("[%s] %s" % (datetime.now(timezone.utc).isoformat(), format % args))

if __name__ == "__main__":
    print(f"Starting Acer Node Heartbeat on {HOST}:{PORT}")
    server = HTTPServer((HOST, PORT), HeartbeatHandler)
    server.serve_forever()

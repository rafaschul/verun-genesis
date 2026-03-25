import http.server, os, sys
os.chdir(os.path.join(os.path.dirname(__file__), "public"))
handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(("", 4202), handler)
print("Serving verun-genesis on http://localhost:4202", flush=True)
httpd.serve_forever()

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from threading import Thread


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    product = Path(__file__).resolve().parents[2]
    fixture = product / "fixtures/starlight/dist"
    with TemporaryDirectory(prefix="access-browser-") as folder:
        root = Path(folder) / "site"
        shutil.copytree(fixture, root)
        shutil.copy(Path(__file__).with_name("interaction-check.mjs"), root)
        page = root / "index.html"
        markup = page.read_text().replace('data-host="example.org"', 'data-host="127.0.0.1"')
        markup = markup.replace(
            'data-summaries="{}"',
            'data-summaries="{&quot;/course/two&quot;:&quot;/previews/two/&quot;}"',
        )
        body = markup.index(">", markup.index("<body")) + 1
        test_markup = """
<script>
let allowed = false;
let reads = 0;
const ordinaryFetch = window.fetch;
window.fetch = (url, ...args) => {
  if (url !== '/previews/_access.json') return ordinaryFetch(url, ...args);
  reads++;
  return Promise.resolve(Response.json({
    identity: { email: allowed ? 'second@example.org' : 'first@example.org' },
    courses: [{ path: '/course/one', allowed: true }, { path: '/course/two', allowed }],
  }));
};
</script>
<div class="sidebar"><ul>
  <li><a id="test-overview" data-course-overview href="/course/two/"><span>Course Two</span></a></li>
  <li id="test-lesson"><a data-course-lesson href="/course/two/lesson/">Lesson Two</a></li>
</ul></div>
<script type="module" src="/interaction-check.mjs"></script>
"""
        page.write_text(markup[:body] + test_markup + markup[body:])
        handler = partial(QuietHandler, directory=root)
        with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
            worker = Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                chrome = shutil.which("google-chrome") or shutil.which("chromium")
                if not chrome:
                    raise SystemExit("Chrome or Chromium is required for the interaction fixture.")
                result = subprocess.run(
                    [chrome, "--headless", "--no-sandbox", "--disable-background-networking",
                     f"--user-data-dir={Path(folder) / 'profile'}", "--virtual-time-budget=5000",
                     "--dump-dom", f"http://127.0.0.1:{server.server_port}/"],
                    capture_output=True, text=True, timeout=30,
                )
                if result.returncode:
                    raise SystemExit(result.stderr)
                marker = next(
                    (part.split('"', 1)[0] for part in result.stdout.split('data-access-result="')[1:]),
                    "Interaction result missing",
                )
                if marker != "PASS":
                    raise SystemExit(marker)
                print("Browser interaction fixture passed")
            finally:
                server.shutdown()


if __name__ == "__main__":
    main()

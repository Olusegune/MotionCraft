"""The only network code for providers. HTTPS only, API hosts allow-listed, redirects checked, downloads limited.

Keys are passed in by the caller for one request and never stored, logged or put in a URL.
"""
from __future__ import annotations

import ipaddress
import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

API_HOSTS = {
    "api.kie.ai", "docs.kie.ai", "queue.fal.run", "api.fal.ai", "ark.ap-southeast.bytepluses.com",
    "generativelanguage.googleapis.com", "api.openai.com", "api.anthropic.com", "openrouter.ai",
}
UA = "MotionCraft/0.1"
MAX_JSON = 8 * 1024 * 1024
MAX_IMAGE = 100 * 1024 * 1024
MAX_VIDEO = 2 * 1024 * 1024 * 1024
MAGIC = {  # content must look like media we expect, whatever the server says it is
    b"\x89PNG": ".png", b"\xff\xd8\xff": ".jpg", b"RIFF": ".webp", b"\x1a\x45\xdf\xa3": ".webm", b"GIF8": ".gif",
}


class NetError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class _NoCrossHostRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https" or urllib.parse.urlsplit(newurl).hostname != urllib.parse.urlsplit(req.full_url).hostname:
            raise NetError("The provider redirected to another host; refused.", code)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Net:
    """`extra_hosts` and `allow_http` exist only so tests can talk to a local fake server."""

    def __init__(self, extra_hosts: set[str] | None = None, allow_http: bool = False):
        self.hosts = API_HOSTS | (extra_hosts or set())
        self.allow_http = allow_http
        self._opener = urllib.request.build_opener(_NoCrossHostRedirect)

    def _check(self, url: str) -> urllib.parse.SplitResult:
        u = urllib.parse.urlsplit(url)
        if u.scheme != "https" and not (self.allow_http and u.scheme == "http"):
            raise NetError("Provider calls must use https.")
        if (u.hostname or "").lower() not in self.hosts:
            raise NetError(f"{u.hostname} is not an allowed provider host.")
        return u

    def json(self, method: str, url: str, *, headers: dict | None = None, body: Any = None, timeout: float = 60) -> Any:
        self._check(url)
        data = None if body is None else json.dumps(body).encode("utf-8")
        h = {"User-Agent": UA, "Accept": "application/json", **(headers or {})}
        if data is not None:
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            with self._opener.open(req, timeout=timeout) as r:
                raw = r.read(MAX_JSON + 1)
        except urllib.error.HTTPError as e:
            detail = e.read(2000).decode("utf-8", "replace")
            raise NetError(f"{urllib.parse.urlsplit(url).hostname} answered {e.code}: {_trim(detail)}", e.code) from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise NetError(f"Could not reach {urllib.parse.urlsplit(url).hostname} ({type(e).__name__}).") from None
        if len(raw) > MAX_JSON:
            raise NetError("The provider's answer was unexpectedly large.")
        try:
            return json.loads(raw.decode("utf-8") or "null")
        except ValueError:
            raise NetError("The provider's answer was not JSON.") from None

    def text(self, url: str, timeout: float = 30) -> str:
        self._check(url)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with self._opener.open(req, timeout=timeout) as r:
                return r.read(MAX_JSON).decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            raise NetError(f"Could not read {urllib.parse.urlsplit(url).hostname} ({type(e).__name__}).") from None

    def download(self, url: str, dest_dir: Path, stem: str, kind: str, headers: dict | None = None) -> Path:
        """Result files come from provider CDNs, so any public https host is allowed, but never a private address."""
        u = urllib.parse.urlsplit(url)
        if u.scheme != "https" and not (self.allow_http and u.scheme == "http"):
            raise NetError("Result links must use https.")
        if not self.allow_http:
            _must_be_public(u.hostname or "")
        limit = MAX_VIDEO if kind == "video" else MAX_IMAGE
        req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
        dest_dir.mkdir(parents=True, exist_ok=True)
        tmp = dest_dir / f"{stem}.part"
        total = 0
        try:
            with self._opener.open(req, timeout=120) as r, open(tmp, "wb") as f:
                head = b""
                while True:
                    chunk = r.read(1024 * 256)
                    if not chunk:
                        break
                    if len(head) < 16:
                        head += chunk[:16]
                    total += len(chunk)
                    if total > limit:
                        raise NetError("The result file is larger than allowed.")
                    f.write(chunk)
            ext = _ext_for(head, kind)
            if ext is None:
                raise NetError("The result is not a picture or video file.")
            out = dest_dir / f"{stem}{ext}"
            tmp.replace(out)
            return out
        except NetError:
            tmp.unlink(missing_ok=True)
            raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            tmp.unlink(missing_ok=True)
            raise NetError(f"Could not download the result ({type(e).__name__}).") from None


def _ext_for(head: bytes, kind: str) -> str | None:
    for magic, ext in MAGIC.items():
        if head.startswith(magic):
            return ext
    if kind == "video" and head[4:8] == b"ftyp":
        return ".mp4"
    return None


def _must_be_public(host: str) -> None:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        raise NetError(f"Could not resolve {host}.") from None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise NetError("The result link points at a private address; refused.")


def _trim(s: str) -> str:
    return " ".join(s.split())[:300]


def png_to_stem_ext(data: bytes) -> str:
    return ".png" if data[:4] == b"\x89PNG" else ".jpg"

#!/usr/bin/env python3
"""
Upload Nuvo release files to Telegram as the main bot, up to 2 GB each, and record them in the bot.

For each file:
1. Upload it over MTProto, logged in as the bot itself, into the maintainer's private chat.
   No second bot, no channel, no logOut: the Bot API webhook keeps running.
2. Forward that message with the Bot API. The forwarded copy carries the file id in Bot API form,
   which MTProto does not give.
3. Delete the forwarded copy. The original stays in the chat as the maintainer's archive.
4. Post the file id to the bot's /upload route, which stores it like a file sent by hand.

Environment: BOT_TOKEN, TG_API_ID, TG_API_HASH, ADMIN_ID, UPLOAD_SECRET, WORKER_URL, optional ADMIN_LANG (en or ru).
Usage: python upload.py <tag> <file>...
"""

import asyncio
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

# The same reading as bot/src/release.ts: release names Nuvo-<version>-<os>-<arch>.<ext>, where Linux spells the
# processor per format (x86_64, amd64, aarch64), plus the older Nuvo-<version>.AppImage and nuvo_<version>_amd64.deb
NAME = re.compile(
    r"^Nuvo-(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|pre|dev)(?:\.?\d+)*)?)-(linux|win|mac)-(x64|x86_64|amd64|arm64|aarch64|ia32|armv7l|universal)\.(AppImage|deb|rpm|exe|dmg|zip)$",
    re.IGNORECASE,
)
ARCH = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64"}
# A pre-release tag is alpha, beta, rc, pre or dev with an optional number, so "-arm64" and ".dmg" stay out
VERSION = re.compile(r"(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc|pre|dev)(?:\.?\d+)*)?)", re.IGNORECASE)
USER_AGENT = "nuvo-release-upload/1.0"
REQUIRED = ["BOT_TOKEN", "TG_API_ID", "TG_API_HASH", "ADMIN_ID", "UPLOAD_SECRET", "WORKER_URL"]


def platform_of(name):
    match = NAME.match(name)
    if match:
        os_name, kind = match.group(2).lower(), match.group(4).lower()
        arch = ARCH.get(match.group(3).lower(), match.group(3).lower())
        if os_name == "linux" and kind in ("appimage", "deb", "rpm"):
            return kind if arch == "x64" else f"{kind}_arm64" if arch == "arm64" else None
        if os_name == "win" and arch == "x64" and kind == "exe":
            return "windows"
        return "macos" if os_name == "mac" and arch == "arm64" and kind == "dmg" else None
    if re.match(r"^Nuvo-\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?\.AppImage$", name, re.IGNORECASE):
        return "appimage"
    return "deb" if re.search(r"_amd64\.deb$", name, re.IGNORECASE) else None


def version_of(name):
    match = VERSION.search(name)
    return match.group(1) if match else None


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def post_json(url, payload, headers, opener):
    # A named User-Agent: Cloudflare refuses Python's default one before the request reaches the Worker
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "User-Agent": USER_AGENT, **headers}, method="POST")
    try:
        with opener(request, timeout=60) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        # Not JSON, for example an error page in front of the Worker: keep the start of it for the log
        return status, {"ok": False, "description": raw[:200].decode("utf-8", "replace")}


class BotApi:
    """The HTTP Bot API. Errors name the method, never the token."""

    def __init__(self, token, opener=urllib.request.urlopen):
        self.token = token
        self.opener = opener

    def call(self, method, **params):
        status, body = post_json(f"https://api.telegram.org/bot{self.token}/{method}", params, {}, self.opener)
        if not body or not body.get("ok"):
            description = (body or {}).get("description", "no answer")
            raise RuntimeError(f"Bot API {method} failed: HTTP {status}: {description}")
        return body["result"]


def make_recorder(worker_url, secret, opener=urllib.request.urlopen):
    def record(payload):
        status, body = post_json(f"{worker_url.rstrip('/')}/upload", payload, {"X-Upload-Secret": secret}, opener)
        if status != 200:
            reason = (body or {}).get("error") or (body or {}).get("description") or "no details"
            raise RuntimeError(f"The bot refused the record for {payload['file_name']}: HTTP {status}: {reason}")
        return body

    return record


def release_files(paths):
    files, skipped = [], []
    for path in map(Path, paths):
        platform, version = platform_of(path.name), version_of(path.name)
        (files if platform and version else skipped).append((path, platform, version))
    return files, [path.name for path, _, _ in skipped]


async def run(client, bot, record, admin_id, tag, paths, lang="en"):
    files, skipped = release_files(paths)
    for name in skipped:
        print(f"Skipped {name}: no platform or version in the name")
    if not files:
        raise SystemExit("No release files matched")

    notice = bot.call("sendMessage", chat_id=admin_id, text=f"Uploading Nuvo {tag}: {len(files)} files", disable_notification=True)
    # A fresh session has no access hash for the maintainer. Reading the bot's own notice by id
    # (messages.getMessages, allowed for bots, needs no peer in private chats) returns the user with it
    await client.get_messages(None, ids=[notice["message_id"]])
    peer = await client.get_input_entity(admin_id)

    recorded = []
    for path, platform, version in files:
        sha = sha256_of(path)
        sent = await client.send_file(peer, str(path), caption=f"sha256: {sha}", force_document=True)
        copy = bot.call("forwardMessage", chat_id=admin_id, from_chat_id=admin_id, message_id=sent.id, disable_notification=True)
        bot.call("deleteMessage", chat_id=admin_id, message_id=copy["message_id"])
        document = copy.get("document") or {}
        if document.get("file_name") != path.name or not document.get("file_id"):
            raise RuntimeError(f"The forwarded copy of {path.name} is not that file")
        record(
            {
                "platform": platform,
                "version": version,
                "file_name": path.name,
                "size": document.get("file_size") or path.stat().st_size,
                "sha256": sha,
                "file_id": document["file_id"],
                "lang": lang,
            }
        )
        recorded.append(path.name)
        print(f"Recorded {path.name}")
    return recorded


async def main(argv):
    missing = [name for name in REQUIRED if not os.environ.get(name)]
    if missing:
        print(f"Missing environment: {', '.join(missing)}", file=sys.stderr)
        return 2
    if len(argv) < 2:
        print("Usage: upload.py <tag> <file>...", file=sys.stderr)
        return 2

    # Imported here so the tests run without Telethon installed
    from telethon import TelegramClient
    from telethon.sessions import MemorySession

    env = os.environ
    client = TelegramClient(MemorySession(), int(env["TG_API_ID"]), env["TG_API_HASH"])
    await client.start(bot_token=env["BOT_TOKEN"])
    try:
        await run(client, BotApi(env["BOT_TOKEN"]), make_recorder(env["WORKER_URL"], env["UPLOAD_SECRET"]), int(env["ADMIN_ID"]), argv[0], argv[1:], env.get("ADMIN_LANG", "en"))
    finally:
        await client.disconnect()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))

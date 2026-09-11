#!/usr/bin/env python3
"""
Launch MCP stdio proxy. Reads box card secrets; never prints them.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

URL = "https://launch-scott-planner.scottkoons.chatgpt.site/api/mcp"
MCP_REMOTE_VERSION = "0.13.5"
SECRET_PATHS = [
    Path("/home/box/sand-data/box-secrets.json"),
    Path("/home/box/agent-data/box-secrets.json"),
]


def load_card() -> dict:
    for p in SECRET_PATHS:
        if not p.is_file():
            continue
        data = json.loads(p.read_text())
        card = data.get("card") or {}
        if card.get("LAUNCH_CONNECTION_TOKEN") and card.get("OAI_SITES_AUTHORIZATION"):
            return card
    sys.stderr.write("Launch MCP: card secrets missing\n")
    sys.exit(1)


def main() -> None:
    card = load_card()
    # Tokens were saved without Bearer prefix.
    # Keep Bearer values in env only; argv uses mcp-remote placeholders.
    os.environ["AUTH_HEADER"] = "Bearer " + str(card["LAUNCH_CONNECTION_TOKEN"])
    os.environ["SITES_HEADER"] = "Bearer " + str(card["OAI_SITES_AUTHORIZATION"])
    args = [
        "npx",
        "-y",
        f"mcp-remote@{MCP_REMOTE_VERSION}",
        URL,
        "--header",
        "Authorization:${AUTH_HEADER}",
        "--header",
        "OAI-Sites-Authorization:${SITES_HEADER}",
        "--silent",
    ]
    os.execvp("npx", args)


if __name__ == "__main__":
    main()

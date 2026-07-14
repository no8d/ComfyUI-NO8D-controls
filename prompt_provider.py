from __future__ import annotations

import urllib.parse


def is_ark_url(base_url):
    try:
        host = (urllib.parse.urlparse(str(base_url or "")).hostname or "").lower()
    except Exception:
        return False
    return host.startswith("ark.") and host.endswith(".volces.com")


def configure_chat_payload(payload, base_url, model):
    """Apply documented provider options without changing other compatible APIs."""
    configured = dict(payload)
    model_name = str(model or "").strip().lower()
    if is_ark_url(base_url) and model_name.startswith("doubao-seed-"):
        configured["thinking"] = {"type": "disabled"}
    return configured

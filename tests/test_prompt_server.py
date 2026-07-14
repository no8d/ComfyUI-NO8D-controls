from __future__ import annotations

import json
import unittest
from unittest import mock

from test_prompt_camera_geometry import PACKAGE, ROOT, _load_module


prompt_server = _load_module(f"{PACKAGE}.prompt_server", ROOT / "prompt_server.py")


class PromptServerTests(unittest.TestCase):
    def test_probe_models_deduplicates_text_and_vision(self):
        service = {
            "models": [{"name": "vision-model", "is_default": True}],
            "vision_model": "vision-model",
        }
        self.assertEqual(prompt_server._selected_probe_models(service), ["vision-model"])

    def test_probe_models_ignores_corrupted_event_value(self):
        service = {
            "models": [{"name": "[object Event]", "is_default": True}],
            "vision_model": "[object Event]",
        }
        self.assertEqual(prompt_server._selected_probe_models(service), [])

    def test_balance_error_is_reported_as_billing_warning(self):
        body = json.dumps({"error": {"code": "Insufficient.Balance", "message": "balance is insufficient"}})
        message = prompt_server._format_probe_error("model-a", 400, body)
        self.assertIn("账户欠费或余额不足", message)
        self.assertIn("Insufficient.Balance", message)

    def test_model_not_open_is_reported_separately(self):
        body = json.dumps({"error": {"code": "ModelNotOpen", "message": "not activated the model"}})
        message = prompt_server._format_probe_error("model-a", 404, body)
        self.assertIn("模型尚未开通", message)

    def test_ark_probe_disables_deep_thinking(self):
        service = {
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "type": "openai_compatible",
            "api_key": "test-key",
        }
        response = mock.MagicMock()
        response.__enter__.return_value = response
        with mock.patch.object(prompt_server, "_service_with_saved_key", return_value=service), mock.patch.object(
            prompt_server.urllib.request, "urlopen", return_value=response
        ), mock.patch.object(
            prompt_server.urllib.request, "Request", wraps=prompt_server.urllib.request.Request
        ) as request:
            prompt_server._probe_chat_model(service, "doubao-seed-2-1-turbo-260628")
        payload = json.loads(request.call_args.kwargs["data"].decode("utf-8"))
        self.assertEqual(payload["thinking"], {"type": "disabled"})


if __name__ == "__main__":
    unittest.main()

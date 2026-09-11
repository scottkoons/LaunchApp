"""Check credential handling without reading real secrets or starting npx."""
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import run_from_box_secrets as proxy


class ProxyTests(unittest.TestCase):
    def test_credentials_stay_out_of_arguments_and_output(self):
        card = {
            "LAUNCH_CONNECTION_TOKEN": "dummy-launch-credential",
            "OAI_SITES_AUTHORIZATION": "dummy-gateway-credential",
        }
        output = io.StringIO()
        with patch.object(proxy, "load_card", return_value=card), \
                patch.dict(os.environ, {}, clear=True), \
                patch.object(proxy.os, "execvp") as execute, \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            proxy.main()
            command, args = execute.call_args.args
            self.assertEqual(command, "npx")
            self.assertIn("mcp-remote@0.13.5", args)
            self.assertIn("--silent", args)
            self.assertNotIn("--debug", args)
            self.assertIn("Authorization:${AUTH_HEADER}", args)
            self.assertIn("OAI-Sites-Authorization:${SITES_HEADER}", args)
            self.assertEqual(os.environ["AUTH_HEADER"], "Bearer " + card["LAUNCH_CONNECTION_TOKEN"])
            self.assertEqual(os.environ["SITES_HEADER"], "Bearer " + card["OAI_SITES_AUTHORIZATION"])
            for secret in card.values():
                self.assertNotIn(secret, " ".join(args))
                self.assertNotIn(secret, output.getvalue())

    def test_missing_second_credential_fails_before_starting_proxy(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory) / "fake-secrets.json"
            store.write_text(json.dumps({"card": {"LAUNCH_CONNECTION_TOKEN": "dummy-private-value"}}))
            output = io.StringIO()
            with patch.object(proxy, "SECRET_PATHS", [store]), \
                    patch.object(proxy.os, "execvp") as execute, \
                    contextlib.redirect_stderr(output):
                with self.assertRaises(SystemExit) as error:
                    proxy.main()
                self.assertEqual(error.exception.code, 1)
                execute.assert_not_called()
                self.assertNotIn("dummy-private-value", output.getvalue())


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Exercise optional extension installs without downloads or a real agent directory.

Run with: python3 tests/installer/extensions.py
"""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
PACKAGES = ("opensec-pi-subagents", "opensec-pi-todo", "opensec-pi-fff")


# Regression for #28: optional Bun extensions must not enter the shared package list.
class ExtensionInstallTests(unittest.TestCase):
    def run_offer(self, integrity="same", install_status=0, choice="yes"):
        with tempfile.TemporaryDirectory(prefix="installer-extensions-") as directory:
            root = Path(directory)
            binary_dir = root / "build"
            binary_dir.mkdir()
            binary = binary_dir / "pi"
            binary.write_text('''#!/bin/sh
if [ "$1" = list ]; then exit 0; fi
printf '%s\\n' "$*" >> "$COMMAND_LOG"
if [ "$1" = install ]; then exit "$INSTALL_STATUS"; fi
''')
            binary.chmod(0o755)
            installer = (ROOT / "install.sh").read_text()
            self.assertTrue(installer.rstrip().endswith('main "$@"'))
            # Load the real installer functions without installing the executable itself.
            functions = installer.rsplit('main "$@"', 1)[0]
            runner = root / "offer.sh"
            runner.write_text(functions + '''
set -eu
setup_style
INSTALL=$TEST_INSTALL
NAME=build
PINS="opensec-pi-subagents 1.0.0 sha512-test
opensec-pi-todo 1.0.0 sha512-test
opensec-pi-fff 1.0.0 sha512-test"
pinned_tarball_matches() { return 0; }
installed_matches() { printf '%s\\n' "$TEST_INTEGRITY"; }
offer_extensions
''')
            log = root / "commands"
            result = subprocess.run(
                ["sh", str(runner)],
                cwd=root,
                env={
                    **os.environ,
                    "TEST_INSTALL": str(root),
                    "COMMAND_LOG": str(log),
                    "INSTALL_STATUS": str(install_status),
                    "TEST_INTEGRITY": integrity,
                    "PIBOLT_EXTENSIONS": choice,
                    "PIBOLT_YES": "1",
                },
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            )
            return log.read_text().splitlines() if log.exists() else [], result.stdout

    def test_installs_only_into_explicit_pi_bolt_scope(self):
        commands, _ = self.run_offer()
        self.assertEqual(commands, [f"install --pi-bolt npm:{name}@1.0.0" for name in PACKAGES])

    def test_integrity_failure_removes_from_the_same_scope(self):
        commands, _ = self.run_offer(integrity="different")
        self.assertEqual(commands, [
            f"{action} --pi-bolt npm:{name}@1.0.0"
            for name in PACKAGES for action in ("install", "remove")
        ])

    def test_failed_install_guidance_keeps_explicit_scope(self):
        commands, output = self.run_offer(install_status=1)
        self.assertEqual(commands, [f"install --pi-bolt npm:{name}@1.0.0" for name in PACKAGES])
        for name in PACKAGES:
            self.assertIn(f"Install it later with: pi-bolt install --pi-bolt npm:{name}", output)

    def test_opt_out_does_not_install(self):
        commands, _ = self.run_offer(choice="no")
        self.assertEqual(commands, [])


if __name__ == "__main__":
    unittest.main()

"""Smoke test for wonjd-wireframe Hermes plugin."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hermes" / "plugin" / "wonjd-wireframe"))

from tools import bind_context, wonjd_prd_list, wonjd_prd_save  # noqa: E402


class _Ctx:
    def __init__(self, wireframe_root: str) -> None:
        self._root = wireframe_root

    def get_config(self, key: str) -> str:
        if key == "wireframe_root":
            return self._root
        return ""


wf_root = os.environ.get("WIREFRAME_ROOT", str(ROOT.parent / "wireframe_dashboard"))
bind_context(_Ctx(wf_root))

print("list:", wonjd_prd_list({"project": "crm"})[:400])

print(
    "save:",
    wonjd_prd_save(
        {
            "title": "plugin-smoke-test",
            "run_id": "plugin-smoke-test",
            "project": "crm",
            "content": "# smoke\n\nplugin test",
            "mode": "create",
        }
    ),
)

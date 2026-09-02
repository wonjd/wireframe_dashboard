"""Handlers — spawn wireframe CLI (PRD tab / wireframe tab SSOT)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

_ctx = None


def bind_context(ctx) -> None:
    global _ctx
    _ctx = ctx


def _wireframe_root() -> Path:
    if _ctx is not None:
        configured = (_ctx.get_config("wireframe_root") or "").strip()
        if configured:
            return Path(configured)
    for key in ("WIREFRAME_ROOT", "HERMES_WORKSPACE_DIR", "CLAUDE_WORKSPACE_DIR"):
        env = (os.environ.get(key) or "").strip()
        if env:
            candidate = Path(env)
            if (candidate / "wireframe.config.json").is_file():
                return candidate
    raise RuntimeError(
        "wonjd-wireframe plugin: wireframe_root not configured. Run: npm run mcp:install"
    )


def _node_exe() -> str:
    return (os.environ.get("NODE") or "").strip() or "node"


def _cli_entry(root: Path) -> Path:
    return root / "packages" / "cli" / "bin" / "wireframe.js"


def check_wonjd_wireframe_available() -> bool:
    try:
        root = _wireframe_root()
        return _cli_entry(root).is_file()
    except Exception:
        return False


def _run_cli(args: list[str], *, input_text: str | None = None) -> dict:
    root = _wireframe_root()
    cli = _cli_entry(root)
    if not cli.is_file():
        raise FileNotFoundError(f"missing wireframe cli: {cli} (run: npm run build in packages/cli)")

    proc = subprocess.run(
        [_node_exe(), str(cli), *args],
        cwd=str(root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        input=input_text,
        timeout=int(os.environ.get("WIREFRAME_CLI_TIMEOUT_SEC") or 180),
    )
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        detail = stderr or stdout or f"exit {proc.returncode}"
        raise RuntimeError(detail[:2000])
    return {"ok": True, "stdout": stdout, "stderr": stderr}


def _run_exists(run_id: str, project: str) -> bool:
    try:
        result = _run_cli(["run", "list", "--project", project])
        stdout = result.get("stdout") or ""
        token = run_id.strip().lower()
        for line in stdout.splitlines():
            parts = line.split("\t")
            if len(parts) >= 2 and parts[1].strip().lower() == token:
                return True
        return token in stdout.lower()
    except Exception:
        return False


def _write_temp_md(content: str) -> Path:
    tmp = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".md",
        delete=False,
        encoding="utf-8",
    )
    tmp.write(content.rstrip() + "\n")
    tmp.close()
    return Path(tmp.name)


def wonjd_prd_save(args: dict, **kwargs) -> str:
    content = str(args.get("content") or "").strip()
    if not content:
        return json.dumps({"error": "content is required"}, ensure_ascii=False)

    title = str(args.get("title") or "").strip()
    run_id = str(args.get("run_id") or "").strip()
    project = str(args.get("project") or "crm").strip() or "crm"
    mode = str(args.get("mode") or "auto").strip().lower()
    if mode not in ("auto", "create", "update"):
        mode = "auto"

    tmp_path: Path | None = None
    try:
        tmp_path = _write_temp_md(content)
        prd_arg = str(tmp_path).replace("\\", "/")

        if mode == "update" or (mode == "auto" and run_id and _run_exists(run_id, project)):
            if not run_id:
                return json.dumps({"error": "run_id is required for update"}, ensure_ascii=False)
            cli_args = [
                "run",
                "update",
                "--run-id",
                run_id,
                "--project",
                project,
                "--prd",
                prd_arg,
            ]
            if title:
                cli_args.extend(["--title", title])
            result = _run_cli(cli_args)
            return json.dumps(
                {
                    "ok": True,
                    "action": "update",
                    "run_id": run_id,
                    "project": project,
                    "message": f"PRD updated: {run_id}",
                    "detail": result.get("stdout"),
                },
                ensure_ascii=False,
            )

        if not title:
            return json.dumps({"error": "title is required for create"}, ensure_ascii=False)

        cli_args = [
            "run",
            "create",
            "--title",
            title,
            "--project",
            project,
            "--prd",
            prd_arg,
        ]
        if run_id:
            cli_args.extend(["--run-id", run_id])

        result = _run_cli(cli_args)
        return json.dumps(
            {
                "ok": True,
                "action": "create",
                "run_id": run_id or title,
                "project": project,
                "message": f"PRD saved: {run_id or title}",
                "detail": result.get("stdout"),
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass


def wonjd_prd_list(args: dict, **kwargs) -> str:
    project = str(args.get("project") or "crm").strip() or "crm"
    try:
        result = _run_cli(["run", "list", "--project", project])
        runs = []
        for line in (result.get("stdout") or "").splitlines():
            parts = line.split("\t")
            if len(parts) < 4:
                continue
            runs.append(
                {
                    "no": parts[0].strip(),
                    "run_id": parts[1].strip(),
                    "status": parts[2].strip(),
                    "title": parts[3].strip(),
                    "prd_path": parts[4].strip() if len(parts) > 4 else "",
                }
            )
        return json.dumps({"ok": True, "project": project, "runs": runs}, ensure_ascii=False)
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )


def wonjd_wireframe_build(args: dict, **kwargs) -> str:
    run_id = str(args.get("run_id") or "").strip()
    if not run_id:
        return json.dumps({"error": "run_id is required"}, ensure_ascii=False)
    project = str(args.get("project") or "crm").strip() or "crm"
    asset = str(args.get("asset_project") or "crm").strip() or "crm"
    try:
        result = _run_cli(
            [
                "run",
                "build",
                "--run-id",
                run_id,
                "--project",
                project,
                "--asset-project",
                asset,
            ]
        )
        return json.dumps(
            {
                "ok": True,
                "run_id": run_id,
                "project": project,
                "asset_project": asset,
                "message": f"Wireframe build started/completed for {run_id}",
                "detail": result.get("stdout"),
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )


def wonjd_wireframe_render(args: dict, **kwargs) -> str:
    run_id = str(args.get("run_id") or "").strip()
    artifact_id = str(args.get("artifact_id") or "").strip()
    instruction = str(args.get("instruction") or "").strip()
    project = str(args.get("project") or "crm").strip() or "crm"
    if not run_id or not artifact_id or not instruction:
        return json.dumps(
            {"error": "run_id, artifact_id, instruction are required"},
            ensure_ascii=False,
        )
    try:
        result = _run_cli(
            [
                "render",
                "--run-id",
                run_id,
                "--project",
                project,
                "--artifact",
                artifact_id,
                "--instruction",
                instruction,
            ]
        )
        return json.dumps(
            {
                "ok": True,
                "run_id": run_id,
                "artifact_id": artifact_id,
                "message": f"Rendered {artifact_id}",
                "detail": result.get("stdout"),
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )

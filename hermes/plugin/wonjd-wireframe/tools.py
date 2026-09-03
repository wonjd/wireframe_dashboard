"""Handlers — spawn wireframe CLI (PRD tab / wireframe tab SSOT)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime
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
            created_id = run_id
            for line in (result.get("stdout") or "").splitlines():
                if line.startswith("run created:") or line.startswith("run updated:"):
                    created_id = line.split(":", 1)[1].strip()
                    break
            if not created_id:
                created_id = run_id or title
            review = _run_cli(["prd", "review", "--run-id", created_id, "--project", project])
            try:
                review_payload = json.loads(review.get("stdout") or "{}")
            except Exception:
                review_payload = {"raw": review.get("stdout")}
            return json.dumps(
                {
                    "ok": True,
                    "action": "update" if (mode == "update" or (mode == "auto" and run_id and _run_exists(run_id, project))) else "create",
                    "run_id": created_id,
                    "project": project,
                    "message": (
                        f"PRD saved: {created_id}. "
                        "Chat에서 확정·보완 질문(open)을 업무 말로 묻고 "
                        "wonjd_prd_answer로 쌓으세요. ready 전엔 빌드 금지."
                    ),
                    "detail": result.get("stdout"),
                    "review": review_payload,
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
        created_id = run_id
        for line in (result.get("stdout") or "").splitlines():
            if line.startswith("run created:"):
                created_id = line.split(":", 1)[1].strip()
                break
        if not created_id:
            created_id = run_id or title
        review = _run_cli(["prd", "review", "--run-id", created_id, "--project", project])
        try:
            review_payload = json.loads(review.get("stdout") or "{}")
        except Exception:
            review_payload = {"raw": review.get("stdout")}
        return json.dumps(
            {
                "ok": True,
                "action": "create",
                "run_id": created_id,
                "project": project,
                "message": (
                    f"PRD saved: {created_id}. "
                    "Chat에서 확정·보완 질문(open)을 업무 말로 묻고 "
                    "wonjd_prd_answer로 쌓으세요. ready 전엔 빌드 금지."
                ),
                "detail": result.get("stdout"),
                "review": review_payload,
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


def wonjd_prd_review(args: dict, **kwargs) -> str:
    run_id = str(args.get("run_id") or "").strip()
    if not run_id:
        return json.dumps({"error": "run_id is required"}, ensure_ascii=False)
    project = str(args.get("project") or "crm").strip() or "crm"
    asset = str(args.get("asset_project") or project).strip() or project
    try:
        result = _run_cli(
            [
                "prd",
                "review",
                "--run-id",
                run_id,
                "--project",
                project,
                "--asset-project",
                asset,
            ]
        )
        try:
            payload = json.loads(result.get("stdout") or "{}")
        except Exception:
            payload = {"raw": result.get("stdout")}
        payload["ok"] = True
        payload["channel"] = "chat"
        return json.dumps(payload, ensure_ascii=False)
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )


def wonjd_prd_answer(args: dict, **kwargs) -> str:
    run_id = str(args.get("run_id") or "").strip()
    answers = args.get("answers")
    if not run_id:
        return json.dumps({"error": "run_id is required"}, ensure_ascii=False)
    if not isinstance(answers, list) or len(answers) == 0:
        return json.dumps({"error": "answers array is required"}, ensure_ascii=False)
    project = str(args.get("project") or "crm").strip() or "crm"
    try:
        result = _run_cli(
            [
                "prd",
                "answer",
                "--run-id",
                run_id,
                "--project",
                project,
                "--answers",
                json.dumps(answers, ensure_ascii=False),
            ]
        )
        try:
            payload = json.loads(result.get("stdout") or "{}")
        except Exception:
            payload = {"raw": result.get("stdout")}
        payload["ok"] = True
        payload["channel"] = "chat"
        return json.dumps(payload, ensure_ascii=False)
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )


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


def _run_dir(root: Path, run_id: str) -> Path:
    return root / "wireFrame" / "runs" / run_id


def _read_text(path: Path, max_chars: int | None = None) -> str:
    text = path.read_text(encoding="utf-8", errors="replace")
    if max_chars is not None and len(text) > max_chars:
        return text[:max_chars] + f"\n\n… truncated ({len(text)} chars total)"
    return text


def _safe_json_load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def wonjd_prd_get(args: dict, **kwargs) -> str:
    run_id = str(args.get("run_id") or "").strip()
    if not run_id:
        return json.dumps({"error": "run_id is required"}, ensure_ascii=False)
    project = str(args.get("project") or "crm").strip() or "crm"
    try:
        root = _wireframe_root()
        prd_path = _run_dir(root, run_id) / "input" / "v1.md"
        if not prd_path.is_file():
            return json.dumps(
                {
                    "error": "PRD not found",
                    "run_id": run_id,
                    "project": project,
                    "path": str(prd_path.relative_to(root)).replace("\\", "/"),
                },
                ensure_ascii=False,
            )
        content = _read_text(prd_path, max_chars=80000)
        return json.dumps(
            {
                "ok": True,
                "run_id": run_id,
                "project": project,
                "path": str(prd_path.relative_to(root)).replace("\\", "/"),
                "content": content,
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )


def wonjd_wireframe_get(args: dict, **kwargs) -> str:
    run_id = str(args.get("run_id") or "").strip()
    if not run_id:
        return json.dumps({"error": "run_id is required"}, ensure_ascii=False)
    artifact_id = str(args.get("artifact_id") or "").strip()
    include_html = args.get("include_html")
    if include_html is None:
        include_html = True
    project = str(args.get("project") or "crm").strip() or "crm"
    try:
        root = _wireframe_root()
        run_dir = _run_dir(root, run_id)
        if not run_dir.is_dir():
            return json.dumps(
                {"error": "run not found", "run_id": run_id, "project": project},
                ensure_ascii=False,
            )

        spec_dir = run_dir / "spec"
        artifacts_dir = run_dir / "artifacts"
        payload: dict = {
            "ok": True,
            "run_id": run_id,
            "project": project,
            "has_domain": (spec_dir / "domain.json").is_file(),
            "has_manifest": (spec_dir / "manifest.json").is_file(),
        }

        if (spec_dir / "manifest.json").is_file():
            manifest = _safe_json_load(spec_dir / "manifest.json")
            payload["manifest"] = {
                "title": manifest.get("title"),
                "status": manifest.get("status"),
                "assumptions": (manifest.get("assumptions") or [])[:12],
                "artifacts": [
                    {
                        "id": a.get("id"),
                        "label": a.get("label"),
                        "file": a.get("file"),
                        "locked": a.get("locked"),
                        "route": (a.get("wireframe") or {}).get("route"),
                        "instructions": a.get("instructions") or [],
                    }
                    for a in (manifest.get("artifacts") or [])
                ],
            }

        if (spec_dir / "domain.json").is_file():
            domain = _safe_json_load(spec_dir / "domain.json")
            payload["domain"] = {
                "entities": domain.get("entities"),
                "tables": domain.get("tables"),
                "steps": domain.get("steps"),
                "judgements": (domain.get("judgements") or [])[:40],
                "assumptions": (domain.get("assumptions") or [])[:12],
            }

        artifacts: list[dict] = []
        if artifacts_dir.is_dir():
            for name in sorted(artifacts_dir.iterdir()):
                if name.is_file() and name.suffix.lower() == ".html":
                    artifacts.append(
                        {
                            "id": name.stem,
                            "file": name.name,
                            "path": str(name.relative_to(root)).replace("\\", "/"),
                            "bytes": name.stat().st_size,
                        }
                    )
        payload["artifacts"] = artifacts

        if artifact_id:
            target = None
            for entry in artifacts:
                if entry["id"] == artifact_id or entry["file"] == artifact_id:
                    target = entry
                    break
            if target is None and (artifacts_dir / f"{artifact_id}.html").is_file():
                path = artifacts_dir / f"{artifact_id}.html"
                target = {
                    "id": artifact_id,
                    "file": path.name,
                    "path": str(path.relative_to(root)).replace("\\", "/"),
                    "bytes": path.stat().st_size,
                }
            if target is None:
                return json.dumps(
                    {
                        "error": "artifact not found",
                        "run_id": run_id,
                        "artifact_id": artifact_id,
                        "available": [a["id"] for a in artifacts],
                    },
                    ensure_ascii=False,
                )
            payload["artifact"] = target
            if include_html:
                html_path = root / target["path"]
                payload["html"] = _read_text(html_path, max_chars=60000)

        return json.dumps(payload, ensure_ascii=False)
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )


_ASSET_FILES = {
    "design": "design.json",
    "routes": "routes.json",
    "api": "api.json",
    "db": "db.json",
    "shell": "shell.html",
}


def wonjd_assets_list(args: dict, **kwargs) -> str:
    project = str(args.get("project") or "crm").strip() or "crm"
    try:
        root = _wireframe_root()
        assets_root = root / "projects" / project
        items = []
        for key, filename in _ASSET_FILES.items():
            path = assets_root / filename
            exists = path.is_file()
            entry = {
                "asset": key,
                "file": filename,
                "path": f"projects/{project}/{filename}",
                "exists": exists,
            }
            if exists:
                stat = path.stat()
                entry["bytes"] = stat.st_size
                entry["modified_at"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
            items.append(entry)
        return json.dumps(
            {
                "ok": True,
                "project": project,
                "assets": items,
                "ready_count": sum(1 for item in items if item["exists"]),
                "total_count": len(items),
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )


def _filter_api(data: dict, query: str) -> dict:
    q = query.lower()
    endpoints = []
    for ep in data.get("endpoints") or []:
        path = str(ep.get("path") or "")
        fields = ep.get("fields") or []
        blob = f"{ep.get('method')} {path} {' '.join(map(str, fields))}".lower()
        if q in blob:
            deduped = []
            seen = set()
            for field in fields:
                name = str(field)
                if name in seen:
                    continue
                seen.add(name)
                deduped.append(name)
                if len(deduped) >= 24:
                    break
            endpoints.append(
                {
                    "method": ep.get("method"),
                    "path": path,
                    "fields": deduped,
                    "controller": ep.get("controller"),
                }
            )
        if len(endpoints) >= 40:
            break
    return {"source": data.get("source"), "query": query, "endpoints": endpoints}


def _filter_db(data: dict, query: str) -> dict:
    q = query.lower()
    tables = []
    for table in data.get("tables") or []:
        name = str(table.get("name") or "")
        cols = table.get("columns") or []
        match = q in name.lower() or any(q in str(c.get("name") or "").lower() for c in cols)
        if not match:
            continue
        slim_cols = []
        for col in cols:
            codes = col.get("codes") or []
            values = [
                str(c.get("value"))
                for c in codes
                if str(c.get("value") or "").strip()
                and len(str(c.get("value"))) <= 24
            ][:12]
            # skip password-like
            cname = str(col.get("name") or "")
            if "password" in cname.lower():
                values = []
            slim_cols.append(
                {
                    "name": cname,
                    "type": col.get("type"),
                    "null": col.get("null"),
                    "fk": col.get("fk"),
                    "codes": values or None,
                }
            )
            if len(slim_cols) >= 40:
                break
        tables.append(
            {
                "name": name,
                "rows": table.get("rows"),
                "columns": slim_cols,
            }
        )
        if len(tables) >= 8:
            break
    return {
        "source": data.get("source"),
        "entities": data.get("entities"),
        "query": query,
        "tables": tables,
    }


def _filter_routes(data: dict, query: str) -> dict:
    q = query.lower()
    routes = []
    for route in data.get("routes") or []:
        blob = f"{route.get('path')} {route.get('label')} {route.get('file')}".lower()
        if q in blob:
            routes.append(
                {
                    "path": route.get("path"),
                    "label": route.get("label"),
                    "file": route.get("file"),
                }
            )
        if len(routes) >= 40:
            break
    return {"source": data.get("source"), "query": query, "routes": routes}


def wonjd_assets_get(args: dict, **kwargs) -> str:
    asset = str(args.get("asset") or "").strip().lower()
    if asset not in _ASSET_FILES:
        return json.dumps(
            {"error": "asset must be one of design|routes|api|db|shell"},
            ensure_ascii=False,
        )
    project = str(args.get("project") or "crm").strip() or "crm"
    query = str(args.get("query") or "").strip()
    max_chars = int(args.get("max_chars") or 40000)
    try:
        root = _wireframe_root()
        path = root / "projects" / project / _ASSET_FILES[asset]
        if not path.is_file():
            return json.dumps(
                {
                    "error": "asset file missing",
                    "project": project,
                    "asset": asset,
                    "path": f"projects/{project}/{_ASSET_FILES[asset]}",
                },
                ensure_ascii=False,
            )

        if asset == "shell":
            content = _read_text(path, max_chars=max_chars)
            return json.dumps(
                {
                    "ok": True,
                    "project": project,
                    "asset": asset,
                    "path": f"projects/{project}/{_ASSET_FILES[asset]}",
                    "content": content,
                },
                ensure_ascii=False,
            )

        data = _safe_json_load(path)
        if query and asset == "api":
            data = _filter_api(data, query)
        elif query and asset == "db":
            data = _filter_db(data, query)
        elif query and asset == "routes":
            data = _filter_routes(data, query)
        elif asset == "api" and not query:
            # never dump full 593KB — force summary
            data = {
                "source": data.get("source"),
                "endpoint_count": len(data.get("endpoints") or []),
                "hint": "Pass query e.g. content|account|growth to get matching endpoints",
                "sample": _filter_api(data, "content").get("endpoints", [])[:8],
            }
        elif asset == "db" and not query:
            data = {
                "source": data.get("source"),
                "entities": data.get("entities"),
                "tables": [
                    {
                        "name": t.get("name"),
                        "rows": t.get("rows"),
                        "column_count": len(t.get("columns") or []),
                    }
                    for t in (data.get("tables") or [])
                ],
                "hint": "Pass query e.g. CONTENT|ENT|ACCOUNT to get columns+codes",
            }

        text = json.dumps(data, ensure_ascii=False, indent=2)
        truncated = False
        if len(text) > max_chars:
            text = text[:max_chars] + f"\n… truncated ({len(text)} chars)"
            truncated = True

        return json.dumps(
            {
                "ok": True,
                "project": project,
                "asset": asset,
                "path": f"projects/{project}/{_ASSET_FILES[asset]}",
                "query": query or None,
                "truncated": truncated,
                "data": text if truncated else data,
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": str(exc)},
            ensure_ascii=False,
        )


def _load_wireframe_config(root: Path) -> dict:
    path = root / "wireframe.config.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _wonjd_cwd(root: Path, asset_project: str) -> Path | None:
    config = _load_wireframe_config(root)
    projects = config.get("projects") or {}
    project = projects.get(asset_project) or projects.get(config.get("defaultProject") or "crm") or {}
    sources = project.get("sources") or {}
    wonjd = sources.get("wonjd") or {}
    cwd = (wonjd.get("cwd") or "").strip()
    if not cwd:
        return None
    candidate = Path(cwd)
    if not candidate.is_absolute():
        candidate = (root / cwd).resolve()
    return candidate if candidate.is_dir() else None


def _live_db_peek(root: Path, asset_project: str, prd_text: str) -> dict:
    cwd = _wonjd_cwd(root, asset_project)
    if cwd is None:
        return {"ok": False, "error": "wonjd cwd not configured"}
    py = cwd / (".venv/Scripts/python.exe" if sys.platform == "win32" else ".venv/bin/python")
    script = cwd / "db" / "query.py"
    if not py.is_file() or not script.is_file():
        return {"ok": False, "error": f"missing query runner under {cwd}"}

    hints = []
    lower = prd_text.lower()
    for token in ("content", "growth", "account", "ent", "request", "file"):
        if token in lower:
            hints.append(token)
    hints = list(dict.fromkeys(hints))[:6] or ["content", "account"]
    likes = " OR ".join(
        [f"TABLE_NAME LIKE '%{h.upper()}%'" for h in hints]
        + [f"TABLE_NAME LIKE '%{h}%'" for h in hints]
    )
    sql = (
        "SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES "
        f"WHERE TABLE_SCHEMA = DATABASE() AND ({likes}) "
        "ORDER BY TABLE_ROWS DESC LIMIT 8"
    )
    try:
        proc = subprocess.run(
            [str(py), str(script), "--json", "--sql", " ".join(sql.split())],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
        )
        if proc.returncode != 0 and not (proc.stdout or "").strip():
            return {"ok": False, "error": (proc.stderr or proc.stdout or "query failed")[:500]}
        data = json.loads(proc.stdout)
        tables = [
            {"name": str(row[0]), "rows": row[1]}
            for row in (data.get("rows") or [])
            if row
        ]
        return {"ok": True, "source": "wonjd_db_query", "hints": hints, "tables": tables}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def wonjd_wireframe_context(args: dict, **kwargs) -> str:
    """Triple context: PRD + JSON assets + live DB in one tool response."""
    run_id = str(args.get("run_id") or "").strip()
    if not run_id:
        return json.dumps({"error": "run_id is required"}, ensure_ascii=False)
    project = str(args.get("project") or "crm").strip() or "crm"
    asset_project = str(args.get("asset_project") or "crm").strip() or "crm"
    include_live = args.get("include_live_db")
    if include_live is None:
        include_live = True

    try:
        root = _wireframe_root()
        prd_path = _run_dir(root, run_id) / "input" / "v1.md"
        if not prd_path.is_file():
            return json.dumps(
                {"error": "PRD not found", "run_id": run_id, "path": str(prd_path)},
                ensure_ascii=False,
            )
        prd_content = _read_text(prd_path, max_chars=24000)

        assets_root = root / "projects" / asset_project
        assets: dict = {}
        for key, filename in _ASSET_FILES.items():
            path = assets_root / filename
            if not path.is_file():
                assets[key] = {"exists": False, "file": filename}
                continue
            if key == "shell":
                assets[key] = {
                    "exists": True,
                    "file": filename,
                    "bytes": path.stat().st_size,
                    "preview": _read_text(path, max_chars=1200),
                }
            elif key == "design":
                data = _safe_json_load(path)
                assets[key] = {
                    "exists": True,
                    "color": (data.get("color") or {}),
                    "component_count": len(data.get("component") or []),
                }
            elif key == "routes":
                data = _safe_json_load(path)
                assets[key] = {
                    "exists": True,
                    "route_count": len(data.get("routes") or []),
                    "sample": (data.get("routes") or [])[:8],
                }
            elif key == "api":
                data = _safe_json_load(path)
                assets[key] = {
                    "exists": True,
                    "endpoint_count": len(data.get("endpoints") or []),
                    "scoped": _filter_api(data, "content"),
                }
            elif key == "db":
                data = _safe_json_load(path)
                assets[key] = {
                    "exists": True,
                    "entities": data.get("entities"),
                    "table_count": len(data.get("tables") or []),
                    "scoped": _filter_db(data, "CONTENT"),
                }

        live_db = _live_db_peek(root, asset_project, prd_content) if include_live else {
            "ok": False,
            "skipped": True,
        }

        build_context_path = _run_dir(root, run_id) / "spec" / "build-context.json"
        prior = None
        if build_context_path.is_file():
            prior = _safe_json_load(build_context_path)

        return json.dumps(
            {
                "ok": True,
                "run_id": run_id,
                "project": project,
                "asset_project": asset_project,
                "sources": {
                    "prd": True,
                    "json_assets": True,
                    "live_db": bool(live_db.get("ok")),
                },
                "prd": {
                    "path": str(prd_path.relative_to(root)).replace("\\", "/"),
                    "content": prd_content,
                },
                "json_assets": assets,
                "live_db": live_db,
                "prior_build_context": prior,
                "hint": (
                    "Wireframe build (wonjd_wireframe_build) merges these three sources into domain.json. "
                    "Artifact re-render reuses domain — does not re-query DB."
                ),
            },
            ensure_ascii=False,
        )
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
        detail = str(exc)
        hint = ""
        if "not ready" in detail.lower() or "PRD not ready" in detail:
            hint = (
                " PRD가 아직 확정(ready)이 아닙니다. "
                "채팅에서 부족한 결정을 보완(wonjd_prd_review → answer)한 뒤 빌드하세요."
            )
        return json.dumps(
            {"error": type(exc).__name__, "error_detail": detail + hint},
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

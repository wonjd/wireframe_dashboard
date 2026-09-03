"""Tool schemas for wonjd-wireframe Hermes plugin."""

PRD_SAVE_SCHEMA = {
    "name": "wonjd_prd_save",
    "description": (
        "Save a business PRD (no developer jargon). "
        "Goal is confirm+refine: save → wonjd_prd_review → ask missing decisions "
        "IN CHAT in plain Korean → wonjd_prd_answer until status=ready → then build. "
        "Do not put columns/APIs/codes in the PRD or questions. "
        "PRD tab is viewer only. mode=auto updates if run_id exists, otherwise creates."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "PRD display title (required for create).",
            },
            "content": {
                "type": "string",
                "description": "Full PRD markdown body.",
            },
            "run_id": {
                "type": "string",
                "description": "Run slug e.g. growth-pause. Derived from title if omitted on create.",
            },
            "project": {
                "type": "string",
                "description": "Project slug in wireFrame/index.json (default crm).",
            },
            "mode": {
                "type": "string",
                "enum": ["auto", "create", "update"],
                "description": "auto=update if run exists else create (default auto).",
            },
        },
        "required": ["content"],
    },
}

PRD_REVIEW_SCHEMA = {
    "name": "wonjd_prd_review",
    "description": (
        "Find decisions still missing so the PRD can be confirmed (확정·보완). "
        "Ask who does what, required fields, choice labels, conditionals, limits, after-submit — "
        "in plain Korean. Never quote tables/columns/codes/APIs to the user. "
        "Present open[].question in CHAT; do not dump reason/liveDbBrief. "
        "Then wonjd_prd_answer. Repeat until ready. Not a developer spec review."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "run_id": {"type": "string"},
            "project": {"type": "string", "description": "default crm"},
            "asset_project": {"type": "string", "description": "default crm"},
        },
        "required": ["run_id"],
    },
}

PRD_ANSWER_SCHEMA = {
    "name": "wonjd_prd_answer",
    "description": (
        "Confirm user answers into the PRD (## 확인된 결정), then re-review for more gaps. "
        "answers must cover every open id from the latest wonjd_prd_review. "
        "If still clarifying, continue 확정·보완 in plain Korean until ready."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "run_id": {"type": "string"},
            "project": {"type": "string"},
            "answers": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "answer": {"type": "string"},
                    },
                    "required": ["id", "answer"],
                },
            },
        },
        "required": ["run_id", "answers"],
    },
}

PRD_LIST_SCHEMA = {
    "name": "wonjd_prd_list",
    "description": "List saved PRD runs (run_id, title, status) from wireFrame/index.json.",
    "parameters": {
        "type": "object",
        "properties": {
            "project": {
                "type": "string",
                "description": "Filter by project slug (default crm).",
            },
        },
    },
}

PRD_GET_SCHEMA = {
    "name": "wonjd_prd_get",
    "description": (
        "Read one PRD markdown body from wireFrame/runs/{run_id}/input/v1.md. "
        "Use when drafting or updating wireframes and you need the saved PRD text."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "run_id": {"type": "string", "description": "Run slug e.g. growth-pause"},
            "project": {"type": "string", "description": "Project slug (default crm)"},
        },
        "required": ["run_id"],
    },
}

WIREFRAME_GET_SCHEMA = {
    "name": "wonjd_wireframe_get",
    "description": (
        "Read wireframe run details: manifest, domain judgements, and artifact HTML list/content. "
        "Pass artifact_id to fetch one screen HTML; omit to get manifest + artifact index."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "run_id": {"type": "string"},
            "artifact_id": {
                "type": "string",
                "description": "Optional e.g. wizard or 01-step-1. If omitted, returns index only.",
            },
            "project": {"type": "string", "description": "default crm"},
            "include_html": {
                "type": "boolean",
                "description": "When artifact_id set, include HTML body (default true). Truncated if huge.",
            },
        },
        "required": ["run_id"],
    },
}

ASSETS_LIST_SCHEMA = {
    "name": "wonjd_assets_list",
    "description": (
        "List JSON asset files for a project (design/routes/api/db/shell) under projects/{slug}/. "
        "Shows existence, size, modified time — call before wonjd_assets_get."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "project": {
                "type": "string",
                "description": "Asset project slug (default crm).",
            },
        },
    },
}

ASSETS_GET_SCHEMA = {
    "name": "wonjd_assets_get",
    "description": (
        "Read one JSON asset used for wireframe generation: design | routes | api | db | shell. "
        "For large api/db, use keys filter or max_chars. Prefer scoped reads over dumping full api.json."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "project": {"type": "string", "description": "Asset project slug (default crm)"},
            "asset": {
                "type": "string",
                "enum": ["design", "routes", "api", "db", "shell"],
                "description": "Which asset file to read.",
            },
            "query": {
                "type": "string",
                "description": (
                    "Optional keyword filter for api/db/routes "
                    "(e.g. content, growth, ACCOUNT). Returns matching subsets."
                ),
            },
            "max_chars": {
                "type": "integer",
                "description": "Truncate returned text to this many chars (default 40000).",
            },
        },
        "required": ["asset"],
    },
}

WIREFRAME_CONTEXT_SCHEMA = {
    "name": "wonjd_wireframe_context",
    "description": (
        "Load the triple context used for wireframe generation in one call: "
        "PRD markdown + JSON assets (design/routes/api/db/shell) + live DB peek via wonjd query. "
        "Use before or while discussing a build. wonjd_wireframe_build merges the same three sources."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "run_id": {"type": "string", "description": "PRD run slug"},
            "project": {"type": "string", "description": "default crm"},
            "asset_project": {"type": "string", "description": "JSON assets slug (default crm)"},
            "include_live_db": {
                "type": "boolean",
                "description": "Query live MySQL via wonjd (default true)",
            },
        },
        "required": ["run_id"],
    },
}

WIREFRAME_BUILD_SCHEMA = {
    "name": "wonjd_wireframe_build",
    "description": (
        "Build wireframe after PRD is confirmed (status ready|confirmed). "
        "If still clarifying, tell the user to finish 확정·보완 in chat first. "
        "SSOT CLI loads PRD + JSON assets + live DB, writes domain/manifest/HTML."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "run_id": {"type": "string", "description": "PRD run slug."},
            "project": {"type": "string", "description": "Project slug (default crm)."},
            "asset_project": {
                "type": "string",
                "description": "JSON assets slug e.g. crm (default crm).",
            },
        },
        "required": ["run_id"],
    },
}

WIREFRAME_RENDER_SCHEMA = {
    "name": "wonjd_wireframe_render",
    "description": (
        "Re-render one wireframe artifact after a refine instruction. "
        "Appends instruction to manifest and regenerates that HTML file."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "run_id": {"type": "string"},
            "artifact_id": {"type": "string", "description": "e.g. 02-step-2"},
            "instruction": {"type": "string", "description": "Change request for this screen."},
            "project": {"type": "string", "description": "default crm"},
        },
        "required": ["run_id", "artifact_id", "instruction"],
    },
}

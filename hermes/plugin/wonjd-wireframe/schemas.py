"""Tool schemas for wonjd-wireframe Hermes plugin."""

PRD_SAVE_SCHEMA = {
    "name": "wonjd_prd_save",
    "description": (
        "Save PRD markdown to the WONJD PRD tab (wireFrame/runs/{runId}/input/v1.md). "
        "Use after multi-turn PRD drafting when the user confirms. "
        "mode=auto updates if run_id exists, otherwise creates."
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

WIREFRAME_BUILD_SCHEMA = {
    "name": "wonjd_wireframe_build",
    "description": (
        "Build wireframe for an existing PRD run (domain, manifest, HTML). "
        "Requires PRD already saved via wonjd_prd_save."
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

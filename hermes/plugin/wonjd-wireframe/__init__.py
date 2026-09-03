"""wonjd-wireframe — PRD / wireframe / JSON asset tools for Hermes Workspace."""

from __future__ import annotations

from .schemas import (
    ASSETS_GET_SCHEMA,
    ASSETS_LIST_SCHEMA,
    PRD_ANSWER_SCHEMA,
    PRD_GET_SCHEMA,
    PRD_LIST_SCHEMA,
    PRD_REVIEW_SCHEMA,
    PRD_SAVE_SCHEMA,
    WIREFRAME_BUILD_SCHEMA,
    WIREFRAME_CONTEXT_SCHEMA,
    WIREFRAME_GET_SCHEMA,
    WIREFRAME_RENDER_SCHEMA,
)
from .tools import (
    bind_context,
    check_wonjd_wireframe_available,
    wonjd_assets_get,
    wonjd_assets_list,
    wonjd_prd_answer,
    wonjd_prd_get,
    wonjd_prd_list,
    wonjd_prd_review,
    wonjd_prd_save,
    wonjd_wireframe_build,
    wonjd_wireframe_context,
    wonjd_wireframe_get,
    wonjd_wireframe_render,
)


def register(ctx) -> None:
    bind_context(ctx)

    tools = [
        ("wonjd_prd_save", PRD_SAVE_SCHEMA, wonjd_prd_save, "📝"),
        ("wonjd_prd_review", PRD_REVIEW_SCHEMA, wonjd_prd_review, "❓"),
        ("wonjd_prd_answer", PRD_ANSWER_SCHEMA, wonjd_prd_answer, "✅"),
        ("wonjd_prd_list", PRD_LIST_SCHEMA, wonjd_prd_list, "📋"),
        ("wonjd_prd_get", PRD_GET_SCHEMA, wonjd_prd_get, "📄"),
        ("wonjd_wireframe_context", WIREFRAME_CONTEXT_SCHEMA, wonjd_wireframe_context, "🔗"),
        ("wonjd_wireframe_get", WIREFRAME_GET_SCHEMA, wonjd_wireframe_get, "👁"),
        ("wonjd_wireframe_build", WIREFRAME_BUILD_SCHEMA, wonjd_wireframe_build, "🧩"),
        ("wonjd_wireframe_render", WIREFRAME_RENDER_SCHEMA, wonjd_wireframe_render, "✏️"),
        ("wonjd_assets_list", ASSETS_LIST_SCHEMA, wonjd_assets_list, "📦"),
        ("wonjd_assets_get", ASSETS_GET_SCHEMA, wonjd_assets_get, "🔎"),
    ]
    for name, schema, handler, emoji in tools:
        ctx.register_tool(
            name=name,
            toolset="wonjd-wireframe",
            schema=schema,
            handler=handler,
            check_fn=check_wonjd_wireframe_available,
            emoji=emoji,
        )

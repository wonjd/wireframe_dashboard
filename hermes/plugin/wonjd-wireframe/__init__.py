"""wonjd-wireframe — PRD / wireframe save tools for Hermes Workspace."""

from __future__ import annotations

from .schemas import (
    PRD_LIST_SCHEMA,
    PRD_SAVE_SCHEMA,
    WIREFRAME_BUILD_SCHEMA,
    WIREFRAME_RENDER_SCHEMA,
)
from .tools import (
    bind_context,
    check_wonjd_wireframe_available,
    wonjd_prd_list,
    wonjd_prd_save,
    wonjd_wireframe_build,
    wonjd_wireframe_render,
)


def register(ctx) -> None:
    bind_context(ctx)
    ctx.register_tool(
        name="wonjd_prd_save",
        toolset="wonjd-wireframe",
        schema=PRD_SAVE_SCHEMA,
        handler=wonjd_prd_save,
        check_fn=check_wonjd_wireframe_available,
        emoji="📝",
    )
    ctx.register_tool(
        name="wonjd_prd_list",
        toolset="wonjd-wireframe",
        schema=PRD_LIST_SCHEMA,
        handler=wonjd_prd_list,
        check_fn=check_wonjd_wireframe_available,
        emoji="📋",
    )
    ctx.register_tool(
        name="wonjd_wireframe_build",
        toolset="wonjd-wireframe",
        schema=WIREFRAME_BUILD_SCHEMA,
        handler=wonjd_wireframe_build,
        check_fn=check_wonjd_wireframe_available,
        emoji="🧩",
    )
    ctx.register_tool(
        name="wonjd_wireframe_render",
        toolset="wonjd-wireframe",
        schema=WIREFRAME_RENDER_SCHEMA,
        handler=wonjd_wireframe_render,
        check_fn=check_wonjd_wireframe_available,
        emoji="✏️",
    )

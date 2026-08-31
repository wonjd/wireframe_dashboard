import type { Manifest, ProjectEntry, Registry } from "../types";

export function useWireframeData() {
  return {
    async loadRegistry(): Promise<Registry> {
      const res = await fetch("/wireFrame/index.json");
      if (!res.ok) throw new Error("wireFrame/index.json 없음");
      return (await res.json()) as Registry;
    },

    async loadManifest(project: ProjectEntry, feature: string): Promise<Manifest> {
      const res = await fetch(`/wireFrame/spec/${feature}.manifest.json`);
      if (!res.ok) throw new Error(`manifest 없음: ${feature}`);
      return (await res.json()) as Manifest;
    },

    async loadHtml(_project: ProjectEntry, _manifest: Manifest, screenId: string): Promise<string | null> {
      const res = await fetch(`/wireFrame/issue/${screenId}.html`);
      return res.ok ? res.text() : null;
    },
  };
}

export function findProject(registry: Registry, projectNo: string): ProjectEntry | undefined {
  return registry.projects.find((p) => p.no === projectNo);
}

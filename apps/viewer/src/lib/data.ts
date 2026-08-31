import {
  manifestSchema,
  registrySchema,
  type Manifest,
  type ProjectEntry,
  type Registry,
} from "@wireframe-studio/core";
import { useWireframeConfig } from "./config";

async function tryApi<T>(path: string, parse: (data: unknown) => T): Promise<T | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return parse(await res.json());
  } catch {
    return null;
  }
}

export function useWireframeData() {
  const { apiBase, loaders } = useWireframeConfig();

  return {
    async loadRegistry(): Promise<Registry> {
      if (loaders) return loaders.loadRegistry();
      const fromApi = await tryApi(`${apiBase}/registry`, (d) => registrySchema.parse(d));
      if (fromApi) return fromApi;
      const res = await fetch("/wireFrame/index.json");
      if (!res.ok) throw new Error("registry not found");
      return registrySchema.parse(await res.json());
    },

    async loadManifest(project: ProjectEntry, feature: string): Promise<Manifest> {
      if (loaders) return loaders.loadManifest(project.no, feature);
      const fromApi = await tryApi(
        `${apiBase}/projects/${project.no}/epics/${feature}`,
        (d) => manifestSchema.parse(d)
      );
      if (fromApi) return fromApi;
      const url = `/wireFrame/spec/${feature}.manifest.json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`manifest not found: ${feature}`);
      return manifestSchema.parse(await res.json());
    },

    async loadHtml(project: ProjectEntry, manifest: Manifest, screenId: string): Promise<string | null> {
      if (loaders) return loaders.loadHtml(project.no, manifest.feature, screenId);
      const screen = manifest.screens.find((s) => s.id === screenId);
      if (!screen) return null;
      if (screen.file.startsWith("db://")) {
        const res = await fetch(`${apiBase}/html/${project.no}/${manifest.feature}/${screen.id}`);
        return res.ok ? res.text() : null;
      }
      const res = await fetch(`/wireFrame/issue/${screen.id}.html`);
      return res.ok ? res.text() : null;
    },
  };
}

export function findProject(registry: Registry, projectNo: string): ProjectEntry | undefined {
  return registry.projects.find((p) => p.no === projectNo);
}

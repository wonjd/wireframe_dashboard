import type { Manifest, ProjectEntry, Registry, Screen } from "../types";

type RawRunEntry = {
  runId: string;
  no: string;
  title: string;
  status?: string;
  artifactCount?: number;
};

type RawProjectEntry = {
  no: string;
  slug: string;
  title: string;
  folder?: string;
  runs?: RawRunEntry[];
  prds?: ProjectEntry["prds"];
};

type RawRegistry = {
  projects: RawProjectEntry[];
};

type RawManifest = {
  runId?: string;
  no?: string;
  title?: string;
  mode?: "existing" | "new";
  artifacts?: Array<{
    id: string;
    no: number;
    label: string;
    file: string;
    wireframe?: { route?: string };
  }>;
  screens?: Screen[];
  projectNo?: string;
  projectSlug?: string;
  prdNo?: string;
  feature?: string;
};

function normalizeProject(project: RawProjectEntry): ProjectEntry {
  if (project.prds?.length) {
    return {
      no: project.no,
      slug: project.slug,
      folder: project.folder ?? project.slug,
      title: project.title,
      prds: project.prds,
    };
  }

  return {
    no: project.no,
    slug: project.slug,
    folder: project.folder ?? project.slug,
    title: project.title,
    prds: (project.runs ?? []).map((run) => ({
      prdNo: run.no,
      feature: run.runId,
      title: run.title,
      status: run.status,
      screenCount: run.artifactCount,
    })),
  };
}

function normalizeManifest(raw: RawManifest, project: ProjectEntry, feature: string): Manifest {
  if (raw.screens?.length) {
    return raw as Manifest;
  }

  return {
    projectNo: project.no,
    projectSlug: project.slug,
    prdNo: raw.no ?? feature,
    feature: raw.runId ?? feature,
    title: raw.title ?? feature,
    mode: raw.mode === "new" ? "new" : "existing",
    screens: (raw.artifacts ?? []).map((artifact) => ({
      id: artifact.id,
      no: artifact.no,
      label: artifact.label,
      file: artifact.file,
      route: artifact.wireframe?.route,
    })),
  };
}

const wireframeData = {
  async loadRegistry(): Promise<Registry> {
    const res = await fetch("/index.json");
    if (!res.ok) throw new Error("wireFrame/index.json 없음");
    const raw = (await res.json()) as RawRegistry;
    return {
      projects: (raw.projects ?? []).map(normalizeProject),
    };
  },

  async loadManifest(project: ProjectEntry, feature: string): Promise<Manifest> {
    const enc = encodeURIComponent(feature);
    const res = await fetch(`/runs/${enc}/spec/manifest.json`);
    if (!res.ok) {
      const legacy = await fetch(`/spec/${enc}.manifest.json`);
      if (!legacy.ok) throw new Error(`manifest 없음: ${feature}`);
      const raw = (await legacy.json()) as RawManifest;
      return normalizeManifest(raw, project, feature);
    }
    const raw = (await res.json()) as RawManifest;
    return normalizeManifest(raw, project, feature);
  },

  async loadHtml(_project: ProjectEntry, manifest: Manifest, screenId: string): Promise<string | null> {
    const screen = manifest.screens.find((entry) => entry.id === screenId);
    if (!screen) return null;

    const feature = manifest.feature;
    const candidates = [
      `/runs/${encodeURIComponent(feature)}/artifacts/${encodeURIComponent(screen.file)}`,
      // Some servers already receive a once-encoded feature segment
      `/runs/${feature}/artifacts/${screen.file}`,
    ];

    for (const runPath of candidates) {
      try {
        const runRes = await fetch(runPath);
        if (!runRes.ok) continue;
        const text = await runRes.text();
        if (!text.trim()) continue;
        // Guard: never treat SPA shell as artifact HTML
        if (text.includes('<div id="root"></div>') && /src\/main\.tsx|\/@vite\//.test(text)) {
          continue;
        }
        if (text.startsWith("not found:")) continue;
        return text;
      } catch {
        /* try next */
      }
    }

    const legacy = await fetch(`/issue/${encodeURIComponent(screenId)}.html`);
    if (!legacy.ok) return null;
    const legacyText = await legacy.text();
    if (legacyText.includes('<div id="root"></div>')) return null;
    return legacyText;
  },

  /** Public URL for iframe src (prefer over srcDoc for large HTML). */
  artifactUrl(manifest: Manifest, screenId: string): string | null {
    const screen = manifest.screens.find((entry) => entry.id === screenId);
    if (!screen) return null;
    return `/runs/${encodeURIComponent(manifest.feature)}/artifacts/${encodeURIComponent(screen.file)}`;
  },
};

export function useWireframeData() {
  return wireframeData;
}

export function findProject(registry: Registry, projectNo: string): ProjectEntry | undefined {
  return registry.projects.find((p) => p.no === projectNo);
}

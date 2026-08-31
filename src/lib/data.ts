import type { Manifest, ProjectEntry, Registry } from "../types";

/**
 * 모듈 스코프에 한 번만 만든다.
 *
 * 렌더마다 새 객체를 돌려주면 이 함수들이 들어간 useEffect 의존성 배열이
 * 매번 바뀌어서 effect → setState → 렌더 → effect 무한 루프가 된다.
 * (React가 "Maximum update depth exceeded"로 업데이트를 포기해 라우팅이 멈춘다.)
 * 컴포넌트 스코프에 의존하는 값이 없으므로 밖에 두면 아이덴티티가 고정된다.
 */
const wireframeData = {
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

export function useWireframeData() {
  return wireframeData;
}

export function findProject(registry: Registry, projectNo: string): ProjectEntry | undefined {
  return registry.projects.find((p) => p.no === projectNo);
}

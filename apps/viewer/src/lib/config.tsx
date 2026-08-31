import type { Manifest, Registry } from "@wireframe-studio/core";
import { createContext, useContext } from "react";

export type WireframeLoaders = {
  loadRegistry: () => Promise<Registry>;
  loadManifest: (projectNo: string, feature: string) => Promise<Manifest>;
  loadHtml: (projectNo: string, feature: string, screenId: string) => Promise<string | null>;
};

type Config = {
  basePath: string;
  apiBase: string;
  loaders?: WireframeLoaders;
  initialRegistry?: Registry;
};

const Ctx = createContext<Config>({ basePath: "/wireframe", apiBase: "/wireframe/api" });

export function WireframeProvider({
  basePath = "/wireframe",
  apiBase = "/wireframe/api",
  loaders,
  initialRegistry,
  children,
}: {
  basePath?: string;
  apiBase?: string;
  loaders?: WireframeLoaders;
  initialRegistry?: Registry;
  children: React.ReactNode;
}) {
  return (
    <Ctx.Provider value={{ basePath, apiBase, loaders, initialRegistry }}>{children}</Ctx.Provider>
  );
}

export function useWireframeConfig() {
  return useContext(Ctx);
}

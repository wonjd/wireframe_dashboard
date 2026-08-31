"use client";

import { BrowserRouter, Route, Routes } from "react-router-dom";
import type { Registry } from "@wireframe-studio/core";
import { WireframeLayout } from "./components/WireframeLayout";
import { WireframeHome } from "./routes/WireframeHome";
import { WireframeProject } from "./routes/WireframeProject";
import { WireframeFeature } from "./routes/WireframeFeature";
import { WireframeProvider, type WireframeLoaders } from "./lib/config";

type Props = {
  basePath?: string;
  apiBase?: string;
  initialRegistry?: Registry;
  loaders?: WireframeLoaders;
};

/** 클론 프로젝트 /wireframe 에 붙이는 단일 엔트리 */
export function WireframeApp({ basePath = "/wireframe", apiBase, initialRegistry, loaders }: Props) {
  const api = apiBase ?? `${basePath}/api`;
  return (
    <WireframeProvider basePath={basePath} apiBase={api} loaders={loaders} initialRegistry={initialRegistry}>
      <BrowserRouter basename={basePath}>
        <Routes>
          <Route path="/" element={<WireframeLayout />}>
            <Route index element={<WireframeHome />} />
            <Route path=":projectNo" element={<WireframeProject />} />
            <Route path=":projectNo/:feature" element={<WireframeFeature />} />
            <Route path=":projectNo/:feature/screens/:screenId" element={<WireframeFeature />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WireframeProvider>
  );
}

export default WireframeApp;

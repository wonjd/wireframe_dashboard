import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { WireframeLayout } from "./components/WireframeLayout";
import { WireframeHome } from "./routes/WireframeHome";
import { WireframeProject } from "./routes/WireframeProject";
import { WireframeFeature } from "./routes/WireframeFeature";
import { PrdAgentChat } from "./routes/PrdAgentChat";
import { PrdList } from "./routes/PrdList";
import { PrdDetail } from "./routes/PrdDetail";
import { PrdStudio } from "./routes/PrdStudio";
import { AssetsJsonTab } from "./routes/AssetsJsonTab";
import { DbQueryTab } from "./routes/DbQueryTab";

export function WireframeApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/prd" replace />} />
          <Route path="prd" element={<PrdList />} />
          <Route path="prd/new" element={<PrdAgentChat />} />
          <Route path="prd/:runId" element={<PrdDetail />} />
          <Route path="prd/:runId/studio" element={<PrdStudio />} />
          <Route path="db" element={<DbQueryTab />} />
          <Route path="assets" element={<AssetsJsonTab />} />
          <Route path="wireframes" element={<WireframeLayout />}>
            <Route index element={<WireframeHome />} />
            <Route path=":projectNo" element={<WireframeProject />} />
            <Route path=":projectNo/:feature" element={<WireframeFeature />} />
            <Route
              path=":projectNo/:feature/screens/:screenId"
              element={<WireframeFeature />}
            />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default WireframeApp;

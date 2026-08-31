import { BrowserRouter, Route, Routes } from "react-router-dom";
import { WireframeLayout } from "./components/WireframeLayout";
import { WireframeHome } from "./routes/WireframeHome";
import { WireframeProject } from "./routes/WireframeProject";
import { WireframeFeature } from "./routes/WireframeFeature";

export function WireframeApp() {
  return (
    <BrowserRouter basename="/wireFrame">
      <Routes>
        <Route path="/" element={<WireframeLayout />}>
          <Route index element={<WireframeHome />} />
          <Route path=":projectNo" element={<WireframeProject />} />
          <Route path=":projectNo/:feature" element={<WireframeFeature />} />
          <Route path=":projectNo/:feature/screens/:screenId" element={<WireframeFeature />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default WireframeApp;

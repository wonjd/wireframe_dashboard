import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import WireframeApp from "./WireframeApp";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WireframeApp basePath="/wireframe" apiBase="/api" />
  </StrictMode>
);

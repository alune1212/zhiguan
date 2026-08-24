import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { getBuildIdentityGate } from "./adapters/browser/build-metadata";
import { App } from "./app/App";
import "./styles/app.css";

// Development-server preview deliberately has no approved artifact identity;
// production startup must refuse to render until the four fixed carriers
// have been written and validated by the artifact manifest build step.
const buildIdentityGate = getBuildIdentityGate();
if (import.meta.env.PROD && !buildIdentityGate.canStartSession) {
  throw new Error("application-build-metadata-invalid");
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("应用挂载点不存在");
}

createRoot(rootElement).render(
  <StrictMode>
    <App buildIdentityGate={buildIdentityGate} />
  </StrictMode>,
);

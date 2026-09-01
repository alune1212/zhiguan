import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./styles/app.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("应用挂载点不存在");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

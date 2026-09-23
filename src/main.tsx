import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { IncomeApp } from "./app/IncomeApp";
import "./styles/app.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("应用挂载点不存在");
}

createRoot(rootElement).render(
  <StrictMode>
    <IncomeApp />
  </StrictMode>,
);

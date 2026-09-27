import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { alignPageHostWithApi } from "./align-page-host";
import { App } from "./App";
import "./styles.css";

alignPageHostWithApi();

const root = document.getElementById("root");
if (!root) {
  throw new Error("root element missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Preview3DWindowApp from "./Preview3DWindowApp";
import { isPreviewWindowHash } from "./domain/preview-window-sync";
import "./styles.css";

const rootComponent = isPreviewWindowHash(window.location.hash) ? (
  <Preview3DWindowApp />
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {rootComponent}
  </React.StrictMode>,
);

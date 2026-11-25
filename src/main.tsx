import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./saas/ErrorBoundary.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

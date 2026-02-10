import React from "react";
import ReactDOM from "react-dom/client";
import "@kopai/ui/globals.css";
import { ObservabilityPage } from "@kopai/ui";

document.documentElement.classList.add("dark");
document.body.classList.add("bg-background");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ObservabilityPage />
  </React.StrictMode>
);

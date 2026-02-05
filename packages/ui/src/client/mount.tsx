import React from "react";
import ReactDOM from "react-dom/client";
import DashboardPage from "../pages/dashboard.js";
import ExamplePage from "../pages/example.js";
import ObservabilityPage from "../pages/observability.js";

const path = window.location.pathname;
const Page = path.startsWith("/example")
  ? ExamplePage
  : path.startsWith("/observability")
    ? ObservabilityPage
    : DashboardPage;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>
);

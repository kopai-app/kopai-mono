import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/globals.css";
import DashboardPage from "../pages/dashboard.js";
import ExamplePage from "../pages/example.js";
import ObservabilityPage from "../pages/observability.js";

const path = window.location.pathname;
const Page = path.startsWith("/example")
  ? ExamplePage
  : path.startsWith("/observability")
    ? ObservabilityPage
    : DashboardPage;

// Add dark class for dark mode
document.documentElement.classList.add("dark");
document.body.classList.add("bg-background");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>
);

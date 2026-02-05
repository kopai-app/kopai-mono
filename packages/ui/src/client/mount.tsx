import React from "react";
import ReactDOM from "react-dom/client";
import DashboardPage from "../pages/dashboard.js";
import ExamplePage from "../pages/example.js";

const path = window.location.pathname;
const Page = path.startsWith("/example") ? ExamplePage : DashboardPage;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Page />
  </React.StrictMode>
);

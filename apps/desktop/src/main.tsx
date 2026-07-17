import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AmbientBackdrop from "./components/shell/AmbientBackdrop";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AmbientBackdrop />
    <App />
  </React.StrictMode>,
);

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ConfigProvider, App as AntApp } from "antd";
import { XProvider } from "@ant-design/x";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found");
}

createRoot(root).render(
  <React.StrictMode>
    <ConfigProvider theme={{ token: { colorPrimary: "#1677ff", borderRadius: 8, fontSize: 13 } }}>
      <AntApp><XProvider><App /></XProvider></AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
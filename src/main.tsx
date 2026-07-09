import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppProvider } from "./context/AppProvider";
import App from "./App";
import "./index.css";
import { initVideoServer } from "./api/videoSrc";

async function start() {
  // On Android: fetch the video server port before first render
  // so getVideoUrl() always has the correct port from the very first paint.
  // On desktop: initVideoServer() is a no-op and resolves immediately.
  await initVideoServer();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}

start();

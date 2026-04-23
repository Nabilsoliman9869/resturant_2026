import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { VenueProvider } from "./context/VenueContext";
import { DbSettingsRefreshProvider } from "./context/DbSettingsRefreshContext";
import App from "./App";
import { installGlobalErrorLogging } from "./lib/errorLogger";
import "./index.css";

installGlobalErrorLogging();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <DbSettingsRefreshProvider>
        <VenueProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </VenueProvider>
      </DbSettingsRefreshProvider>
    </BrowserRouter>
  </StrictMode>
);

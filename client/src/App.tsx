import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { ServerDetail } from "./pages/ServerDetail";
import { Settings } from "./pages/Settings";
import { Logs } from "./pages/Logs";
import { Help } from "./pages/Help";
import { Toaster } from "./components/ui/sonner";
import { UpdateNotification } from "./components/UpdateNotification";
import { BackendProvider } from "./contexts/BackendContext";

// Electron loads from file:// — BrowserRouter doesn't work, use HashRouter instead
const isElectron =
  typeof window !== "undefined" &&
  !!(window as unknown as Record<string, unknown>).electronAPI;
const Router = isElectron ? HashRouter : BrowserRouter;

function App() {
  return (
    <BackendProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/help" element={<Help />} />
          <Route path="/server/:id" element={<ServerDetail />} />
          <Route path="/server/:id/:tab" element={<ServerDetail />} />
        </Routes>
        <Toaster />
      </Router>
      {isElectron && <UpdateNotification />}
    </BackendProvider>
  );
}

export default App;

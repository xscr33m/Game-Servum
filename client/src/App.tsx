import {
  createBrowserRouter,
  createHashRouter,
  RouterProvider,
  Outlet,
} from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { ServerDetail } from "./pages/ServerDetail";
import { Settings } from "./pages/Settings";
import { Logs } from "./pages/Logs";
import { Help } from "./pages/Help";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { UpdateNotification } from "./components/UpdateNotification";
import { BackendProvider } from "./contexts/BackendContext";
import { UnsavedChangesProvider } from "./contexts/UnsavedChangesContext";

// Electron loads from file:// — BrowserRouter doesn't work, use HashRouter instead
const isElectron =
  typeof window !== "undefined" &&
  !!(window as unknown as Record<string, unknown>).electronAPI;

function RootLayout() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

const createRouter = isElectron ? createHashRouter : createBrowserRouter;
const router = createRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <Dashboard /> },
      { path: "/settings", element: <Settings /> },
      { path: "/logs", element: <Logs /> },
      { path: "/help", element: <Help /> },
      { path: "/server/:id", element: <ServerDetail /> },
      { path: "/server/:id/:tab", element: <ServerDetail /> },
    ],
  },
]);

function App() {
  return (
    <BackendProvider>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
      {isElectron && <UpdateNotification />}
    </BackendProvider>
  );
}

export default App;

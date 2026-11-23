import "@fontsource-variable/archivo/standard.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen";
import { ErrorScreen } from "./ui/error-screen";
import { startSpatialNavigation } from "./ui/spatial";

import "./styles.css";

// A plain browser tab on the dev server has no preload; production builds drop this branch and the chunk.
if (import.meta.env.DEV && !("harakiri" in window)) {
  const { installBrowserBridge } = await import("./dev/browser-bridge");
  installBrowserBridge();
}

startSpatialNavigation();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

// The app is loaded from file:// in production, where path-based history has nothing to resolve against.
const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: { queryClient },
  defaultErrorComponent: ErrorScreen,
  defaultPendingMinMs: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.querySelector("#root");

if (root === null) {
  throw new Error("index.html is missing #root");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);

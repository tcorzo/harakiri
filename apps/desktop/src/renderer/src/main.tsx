import "@fontsource-variable/archivo/standard.css";
import {
  GetBoundingClientRectAdapter,
  init,
  setKeyMap,
} from "@noriginmedia/norigin-spatial-navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createHashHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { routeTree } from "./routeTree.gen";
import { ErrorScreen } from "./ui/ErrorScreen";

import "./styles.css";

init({
  // The library moves whole sections with transforms, which offset-based measuring cannot see.
  layoutAdapter: GetBoundingClientRectAdapter,
  shouldFocusDOMNode: true,
  domNodeFocusOptions: { preventScroll: true, focusVisible: true },
});

// The input hub is the only key path, so norigin's own keydown handling is switched off.
setKeyMap({ left: [], up: [], right: [], down: [], enter: [] });

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

const root = document.getElementById("root");

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

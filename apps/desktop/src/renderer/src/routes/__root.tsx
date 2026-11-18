import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { Suspense } from "react";

import { useInputHub } from "../input/hub";
import { Curtain } from "../ui/Curtain";

function Root() {
  useInputHub();
  return (
    <Suspense fallback={<Curtain />}>
      <Outlet />
    </Suspense>
  );
}

export const Route = createRootRouteWithContext<{ readonly queryClient: QueryClient }>()({
  component: Root,
});

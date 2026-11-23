import { createFileRoute } from "@tanstack/react-router";
import { noop } from "es-toolkit";

import {
  continueQuery,
  featuredQuery,
  programmeQuery,
  recentQuery,
  upNextQuery,
} from "../../data/queries";
import { LibraryScreen } from "../../library/library-screen";

export const Route = createFileRoute("/_signedIn/library")({
  loader: async ({ context: { queryClient, signedIn } }) => {
    // Start every library request at once; the screen suspends only on its first viewport.
    void queryClient.query(continueQuery(signedIn)).catch(noop);
    void queryClient.query(upNextQuery(signedIn)).catch(noop);
    void queryClient.query(recentQuery(signedIn)).catch(noop);
    void queryClient.query(programmeQuery(signedIn)).catch(noop);

    return await queryClient.query({ ...featuredQuery(signedIn), staleTime: "static" });
  },
  component: LibraryScreen,
});

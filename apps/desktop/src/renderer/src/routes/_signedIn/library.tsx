import { createFileRoute } from "@tanstack/react-router";

import {
  catalogueQuery,
  continueQuery,
  featuredQuery,
  programmeQuery,
  recentQuery,
  upNextQuery,
} from "../../data/queries";
import { LibraryScreen } from "../../library/LibraryScreen";

export const Route = createFileRoute("/_signedIn/library")({
  loader: ({ context: { queryClient, signedIn } }) => {
    // Start every library request at once; the screen suspends only on its first viewport.
    void queryClient.prefetchQuery(continueQuery(signedIn));
    void queryClient.prefetchQuery(upNextQuery(signedIn));
    void queryClient.prefetchQuery(recentQuery(signedIn));
    void queryClient.prefetchQuery(programmeQuery(signedIn));
    return Promise.all([
      queryClient.ensureQueryData(featuredQuery(signedIn)),
      queryClient.ensureQueryData(catalogueQuery(signedIn)),
    ]);
  },
  component: LibraryScreen,
});

import { ItemId } from "@harakiri/jellyfin";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { rawItemQuery } from "../../data/queries";
import { ScreeningScreen } from "../../screening/ScreeningScreen";

const search = z.object({
  start: z.number().int().nonnegative().catch(0),
  audio: z.number().int().optional().catch(undefined),
  subtitle: z.number().int().optional().catch(undefined),
  /**
   * Where a finished screening goes: back where it was started, or (from the library hero, which
   * has no title page behind it) to the title page, as the PRD's player acceptance asks.
   */
  after: z.enum(["back", "title"]).optional().catch(undefined),
});

function Screening() {
  const { id } = Route.useParams();

  // Playing the next episode replaces the route with a new id: a new screening, from the house.
  return <ScreeningScreen key={id} />;
}

export const Route = createFileRoute("/_signedIn/screening/$id")({
  params: { parse: ({ id }) => ({ id: ItemId.parse(id) }), stringify: ({ id }) => ({ id }) },
  validateSearch: search,
  loader: ({ context: { queryClient, signedIn }, params }) =>
    queryClient.ensureQueryData(rawItemQuery(signedIn, params.id)),
  component: Screening,
});

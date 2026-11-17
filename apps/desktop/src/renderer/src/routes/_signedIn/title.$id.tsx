import { ItemId } from "@harakiri/jellyfin";
import { createFileRoute } from "@tanstack/react-router";

import { toEntry } from "../../data/entry";
import { catalogueQuery, episodesQuery, rawItemQuery, seasonsQuery } from "../../data/queries";
import { initialSeason } from "../../title/series-page";
import { TitleScreen } from "../../title/title-screen";

export const Route = createFileRoute("/_signedIn/title/$id")({
  params: { parse: ({ id }) => ({ id: ItemId.parse(id) }), stringify: ({ id }) => ({ id }) },
  loader: async ({ context: { queryClient, signedIn }, params }) => {
    const [item] = await Promise.all([
      queryClient.ensureQueryData(rawItemQuery(signedIn, params.id)),
      queryClient.ensureQueryData(catalogueQuery(signedIn)),
    ]);

    // A series page offers its next episode the moment it opens, so the seasons and the opening
    // season's episodes load first; Play then exists to take focus.
    if (item.Type === "Series") {
      const seasons = (await queryClient.ensureQueryData(seasonsQuery(signedIn, params.id))).map(
        toEntry
      );

      const season = seasons[initialSeason(params.id, seasons)];

      if (season !== undefined) {
        await queryClient.ensureQueryData(episodesQuery(signedIn, params.id, season.id));
      }
    }
  },
  component: TitleScreen,
});

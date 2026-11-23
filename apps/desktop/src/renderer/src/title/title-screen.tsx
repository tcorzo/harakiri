import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Navigate } from "@tanstack/react-router";

import { titleQuery } from "../data/queries";
import { useSignedIn } from "../data/session";
import { FilmPage } from "./film-page";
import { SeriesPage } from "./series-page";

const route = getRouteApi("/_signedIn/title/$id");

export const TitleScreen = () => {
  const { id } = route.useParams();
  const ctx = useSignedIn();
  const { data } = useSuspenseQuery(titleQuery(ctx, id));
  const { entry, item } = data;

  if (entry.kind === "Season" && entry.series !== null) {
    return <Navigate to="/title/$id" params={{ id: entry.series.id }} replace />;
  }

  if (entry.kind === "Series") {
    return <SeriesPage key={entry.id} series={entry} server={ctx.server} />;
  }

  return <FilmPage key={entry.id} entry={entry} item={item} server={ctx.server} />;
};

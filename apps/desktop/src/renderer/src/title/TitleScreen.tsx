import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, Navigate } from "@tanstack/react-router";

import { catalogueQuery, titleQuery } from "../data/queries";
import { useSignedIn } from "../data/session";
import { numberFor } from "../library/sections";
import { FilmPage } from "./FilmPage";
import { SeriesPage } from "./SeriesPage";

const route = getRouteApi("/_signedIn/title/$id");

export function TitleScreen() {
  const { id } = route.useParams();
  const ctx = useSignedIn();
  const { data } = useSuspenseQuery(titleQuery(ctx, id));
  const { data: numbers } = useSuspenseQuery(catalogueQuery(ctx));
  const { entry, item } = data;
  const number = numberFor(numbers, entry);

  if (entry.kind === "Season" && entry.series !== null) {
    return <Navigate to="/title/$id" params={{ id: entry.series.id }} replace />;
  }

  if (entry.kind === "Series") {
    return <SeriesPage key={entry.id} series={entry} number={number} server={ctx.server} />;
  }

  return <FilmPage key={entry.id} entry={entry} item={item} number={number} server={ctx.server} />;
}

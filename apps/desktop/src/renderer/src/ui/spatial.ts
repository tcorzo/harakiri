import {
  GetBoundingClientRectAdapter,
  init,
  setKeyMap,
} from "@noriginmedia/norigin-spatial-navigation";

/** Starts norigin for the renderer. main.tsx and the component tests both start it here. */
export const startSpatialNavigation = (): void => {
  init({
    // The library moves whole sections with transforms, which offset-based measuring cannot see.
    layoutAdapter: GetBoundingClientRectAdapter,
    shouldFocusDOMNode: true,
    domNodeFocusOptions: { preventScroll: true, focusVisible: true },
  });

  // The input hub is the only key path, so norigin's own keydown handling is switched off.
  setKeyMap({ left: [], up: [], right: [], down: [], enter: [] });
};

// Dev only: the dev server adds this module to the page while impeccable's live helper runs
// (apps/desktop/dev/impeccable-live.ts).
import { guardAppFocus, watchLiveChrome } from "./live-chrome";

watchLiveChrome(document);

guardAppFocus(document);

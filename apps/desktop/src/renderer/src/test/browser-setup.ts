// Runs in the browser before every *.browser.test.tsx (vitest.browser.config.ts).
// The app's own font and stylesheet, as main.tsx loads them, so sizes and positions are real.
import "@fontsource-variable/archivo/standard.css";
import "vitest-browser-react";
import { installBridge } from "./bridge";

import "../styles.css";

installBridge();

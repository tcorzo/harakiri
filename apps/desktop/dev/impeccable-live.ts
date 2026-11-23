/**
 * Dev only: puts impeccable's live widget into the renderer while its helper runs.
 *
 * `mise run live` starts the helper, which writes `.impeccable/live/server.json` (its port and
 * session token). While that file names a live process, every page the dev server serves gets the
 * helper's widget and harakiri's additions to it (src/renderer/src/dev/live-chrome.ts), and the
 * page reloads when the helper starts or stops. index.html is never edited, so the session token
 * never lands in a tracked file. The widget's script is proxied through the dev server under
 * /__impeccable, so it is same-origin for the Electron window's CSP.
 *
 * `apply: "serve"` keeps all of this out of every build.
 */
import { existsSync, readFileSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";

import type { Plugin } from "vite";
import { z } from "zod";

const Helper = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  token: z.string().min(1),
});

export type Helper = z.infer<typeof Helper>;

const proxyPrefix = "/__impeccable";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/** The helper `server.json` names, or null when there is none or its process has exited. */
export const runningHelper = (serverFile: string): Helper | null => {
  if (!existsSync(serverFile)) {
    return null;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(readFileSync(serverFile, "utf-8"));
  } catch {
    return null;
  }

  const parsed = Helper.safeParse(raw);

  return parsed.success && alive(parsed.data.pid) ? parsed.data : null;
};

/** The widget script's same-origin path, with the session token the helper requires. */
export const widgetSrc = (helper: Helper): string =>
  `${proxyPrefix}/live.js?${new URLSearchParams({ token: helper.token }).toString()}`;

export const impeccableLive = ({ appRoot }: { readonly appRoot: string }): Plugin => {
  const serverFile = path.join(appRoot, ".impeccable", "live", "server.json");

  return {
    name: "harakiri:impeccable-live",
    apply: "serve",

    configureServer(server) {
      // Watch the tracked .impeccable folder, not the file: the watcher drops a watched file once
      // live:stop deletes it, and would never see the next live start create it again.
      server.watcher.add(path.dirname(path.dirname(serverFile)));

      const reload = (file: string): void => {
        if (path.resolve(file) === serverFile) {
          server.ws.send({ type: "full-reload" });
        }
      };

      server.watcher.on("add", reload);
      server.watcher.on("unlink", reload);
      server.watcher.on("change", reload);

      // Connect strips the prefix, so req.url is the helper's own path ("/live.js?token=...").
      server.middlewares.use(proxyPrefix, (req, res) => {
        const helper = runningHelper(serverFile);

        if (helper === null) {
          res.statusCode = 503;
          res.end("impeccable live is not running: mise run live");

          return;
        }

        const upstream = request(
          { host: "localhost", port: helper.port, path: req.url, method: req.method },
          (response) => {
            res.writeHead(response.statusCode ?? 502, response.headers);
            response.pipe(res);
          }
        );

        upstream.on("error", () => {
          res.statusCode = 502;
          res.end("impeccable live helper did not answer");
        });

        req.pipe(upstream);
      });
    },

    transformIndexHtml() {
      const helper = runningHelper(serverFile);

      if (helper === null) {
        return [];
      }

      return [
        { tag: "script", attrs: { src: widgetSrc(helper) }, injectTo: "body" },
        {
          tag: "script",
          attrs: { type: "module", src: "/src/dev/live-chrome-entry.ts" },
          injectTo: "body",
        },
      ];
    },
  };
};

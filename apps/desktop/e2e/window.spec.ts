import { expect, test } from "./support/harakiri";

// Without GPU compositing (no GPU, a blocklisted driver, a GPU process that will not start),
// Chromium never paints a window that has not been shown, so a window that waits for
// ready-to-show stays hidden for good, and the renderer's requestAnimationFrame never runs.
test.use({ electronArgs: ["--disable-gpu"] });

test("the window shows, and the renderer gets frames, when Chromium composites in software", async ({
  launch,
}) => {
  const { app, page } = await launch();

  const compositing = await app.evaluate(
    ({ app: electron }) => electron.getGPUFeatureStatus().gpu_compositing
  );

  expect(compositing).toBe("disabled_software");

  await expect
    .poll(
      async () =>
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().map((window) => window.isVisible())
        ),
      { timeout: 5000 }
    )
    .toEqual([true]);

  // The gamepad poller runs on animation frames.
  const frames = await page.evaluate(
    async () =>
      // oxlint-disable-next-line promise/avoid-new -- requestAnimationFrame has no promise form
      await new Promise<number>((resolve) => {
        let count = 0;

        const tick = (): void => {
          count += 1;

          if (count === 10) {
            resolve(count);

            return;
          }

          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      })
  );

  expect(frames).toBe(10);
});

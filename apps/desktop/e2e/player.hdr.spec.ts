import { joinFacts } from "@harakiri/jellyfin";
import { z } from "zod";

import {
  expect,
  play,
  probeUntil,
  recordPlayerEvents,
  playerEventUntil,
  test,
} from "./support/harakiri";
import { ITEMS, TICKS_PER_SECOND } from "./support/jellyfin";
import { lavapipeDeviceUuid, mpvCommand } from "./support/mpv";

// mpv's real output: gpu-next on Vulkan in a window inside the nested KWin, rendered by lavapipe
// so the result does not depend on the machine's GPU.
test.use({
  mpvArgs: `--ao=null --vulkan-device=${lavapipeDeviceUuid()}`,
  extraEnv: { VK_DRIVER_FILES: "/usr/share/vulkan/icd.d/lvp_icd.x86_64.json" },
});

// Software decode of a 4K HEVC remux plus lavapipe rendering; measured at 5 to 8 s per test.
test.setTimeout(90_000);

test.beforeEach(({ signIn }) => signIn());

const ColourParams = z.object({
  gamma: z.string(),
  primaries: z.string(),
  colormatrix: z.string().optional(),
});

// gpu-next receives PQ BT.2020, but KWin's virtual output always reports SDR, so mpv tone-maps
// and the facts must say so: they state what reaches the display, not what the file carries.
const cases = [
  {
    name: "Dolby Vision profile 5",
    criteria: ITEMS.dvP5,
    colormatrix: "dolbyvision",
    signal: "Dolby Vision tone-mapped to SDR · ",
    reshaped: true,
  },
  {
    name: "HDR10",
    criteria: ITEMS.hdr10,
    colormatrix: "bt.2020-ncl",
    signal: "HDR10 tone-mapped to SDR · ",
    reshaped: false,
  },
] as const;

for (const { name, criteria, colormatrix, signal, reshaped } of cases) {
  test(`${name} reaches gpu-next as PQ BT.2020 and plays`, async ({
    launch,
    jellyfin,
    userDataDir,
    preserveUserData,
  }, testInfo) => {
    const item = await jellyfin.pickItem(criteria);
    await preserveUserData(item.id);
    const { page } = await launch();
    await recordPlayerEvents(page);

    await play(page, {
      itemId: item.id,
      mediaSourceId: item.mediaSourceId,
      // Into a long remux, past its opening; a short corpus file plays from the top.
      startPositionTicks: (item.runTimeTicks > 600 * TICKS_PER_SECOND ? 300 : 0) * TICKS_PER_SECOND,
    });

    const first = await probeUntil(page, (p) => p.videoGamma !== undefined, 60_000);
    expect(first.videoGamma).toBe("pq");
    expect(first.videoPrimaries).toBe("bt.2020");

    const params = ColourParams.parse(
      await mpvCommand(userDataDir, "get_property", "video-params")
    );

    expect(params.colormatrix).toBe(colormatrix);
    await probeUntil(page, (p) => (p.timePos ?? 0) >= (first.timePos ?? 0) + 1, 60_000);

    const target = ColourParams.parse(
      await mpvCommand(userDataDir, "get_property", "video-target-params")
    );

    const vo = z.string().parse(await mpvCommand(userDataDir, "get_property", "current-vo"));
    const passes = JSON.stringify(await mpvCommand(userDataDir, "get_property", "vo-passes"));

    // The watcher reads the display's target within a sample or two of playback starting.
    const playing = await playerEventUntil(
      page,
      (event) => event.phase === "playing" && event.downgrades.some((d) => d.leg === "picture")
    );

    await testInfo.attach("picture", {
      contentType: "application/json",
      body: JSON.stringify({
        item: item.name,
        params,
        target,
        vo,
        signalPath: joinFacts(playing.facts),
      }),
    });
    expect(vo).toBe("gpu-next");
    expect(joinFacts(playing.facts).startsWith(signal)).toBe(true);
    expect(playing.downgrades.filter((d) => d.leg === "picture").map((d) => d.reason)).toEqual([
      { kind: "displaySdr" },
    ]);
    // libplacebo's Dolby Vision reshaping pass: the RPU is applied, not ignored.
    expect(/reshap/i.test(passes)).toBe(reshaped);
  });
}

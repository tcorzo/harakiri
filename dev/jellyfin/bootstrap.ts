// Idempotent first-run for the harakiri Jellyfin dev server.
// Run: mise exec -- bun dev/jellyfin/bootstrap.ts [--scan]
// Re-running converges: skips a completed wizard, reuses existing libraries and re-applies their options.
// A library scan is triggered only when a library was created, or with --scan.
//
// JELLYFIN_DEV_LIBRARY picks what the server reads (see jellyfin.sh):
// - corpus (default): the generated corpus, metadata from its NFO files and artwork only, offline.
// - own: your own library; internet metadata providers stay on so posters and logos arrive.

import { api, BASE, login, PASSWORD, USER, USING_DEFAULT_CREDS, waitForServer } from "./client.ts";

type VirtualFolder = {
  Name: string;
  ItemId: string;
  Locations: string[];
  LibraryOptions: Record<string, unknown>;
};

const OWN_LIBRARY = (process.env.JELLYFIN_DEV_LIBRARY ?? "corpus") === "own";

// Corpus mode: no remote metadata or image fetcher for any item type, so the scan reads only the
// local NFO files and artwork next to the media and needs no network.
const OFFLINE_TYPE_OPTIONS = ["Movie", "Series", "Season", "Episode"].map((Type) => ({
  Type,
  MetadataFetchers: [],
  MetadataFetcherOrder: [],
  ImageFetchers: [],
  ImageFetcherOrder: [],
}));

// Cheap on CPU: no trickplay, no chapter images, no realtime watcher (CIFS has no inotify anyway).
// Own library: metadata and image fetchers stay enabled (TypeOptions left at defaults) so posters,
// backdrops and logos arrive. Nothing is written next to the media: the mounts are read-only.
const LIBRARY_OPTIONS = {
  Enabled: true,
  EnableRealtimeMonitor: false,
  EnableTrickplayImageExtraction: false,
  ExtractTrickplayImagesDuringLibraryScan: false,
  EnableChapterImageExtraction: false,
  ExtractChapterImagesDuringLibraryScan: false,
  EnableLUFSScan: false,
  EnableInternetProviders: OWN_LIBRARY,
  LocalMetadataReaderOrder: ["Nfo"],
  DisabledLocalMetadataReaders: [],
  ...(OWN_LIBRARY ? {} : { TypeOptions: OFFLINE_TYPE_OPTIONS }),
  SaveLocalMetadata: false,
  MetadataSavers: [],
  SaveSubtitlesWithMedia: false,
  SaveLyricsWithMedia: false,
  SaveTrickplayWithMedia: false,
  PreferredMetadataLanguage: "en",
  MetadataCountryCode: "US",
  AutomaticRefreshIntervalDays: 0,
};

const LIBRARIES = [
  { name: "Movies", collectionType: "movies", path: "/media/movies" },
  { name: "Shows", collectionType: "tvshows", path: "/media/series" },
];

const info = await waitForServer();
console.log(
  `server ${BASE} up, Jellyfin ${info.Version}, wizard completed: ${info.StartupWizardCompleted}`,
);
if (USING_DEFAULT_CREDS) {
  console.log(
    `using default DEV-ONLY credentials ${USER} / ${PASSWORD} (set JELLYFIN_DEV_USER / JELLYFIN_DEV_PASSWORD to override)`,
  );
}

if (!info.StartupWizardCompleted) {
  await api("POST", "/Startup/Configuration", {
    body: {
      ServerName: "harakiri-dev",
      UICulture: "en-US",
      MetadataCountryCode: "US",
      PreferredMetadataLanguage: "en",
    },
  });
  await api("GET", "/Startup/User"); // initialises the first user record
  await api("POST", "/Startup/User", { body: { Name: USER, Password: PASSWORD } });
  // The port is published on 127.0.0.1 only; remote access must stay on so the
  // forwarded (non-loopback) source address inside the container is not rejected.
  await api("POST", "/Startup/RemoteAccess", { body: { EnableRemoteAccess: true } });
  await api("POST", "/Startup/Complete");
  console.log("startup wizard completed");
} else {
  console.log("startup wizard already completed, skipping");
}

const { token, userId } = await login();
console.log(`authenticated as ${USER}`);

// Bound scan parallelism: each concurrent ffprobe (-probesize 1G) can take >1 GB, and the
// container is capped at 3 GB. 0 means "auto" (CPU count) in Jellyfin; 1 keeps memory flat.
const SERVER_CONFIG = {
  LibraryScanFanoutConcurrency: 1,
  LibraryMetadataRefreshConcurrency: 1,
  ParallelImageEncodingLimit: 1,
  // The app's onboarding and the e2e approve sign-ins through Quick Connect.
  QuickConnectAvailable: true,
};
const serverConfig = await api<Record<string, unknown>>("GET", "/System/Configuration", { token });
const drift = Object.entries(SERVER_CONFIG).filter(([k, v]) => serverConfig[k] !== v);
if (drift.length > 0) {
  await api("POST", "/System/Configuration", {
    token,
    body: { ...serverConfig, ...SERVER_CONFIG },
  });
  console.log(`server config updated: ${drift.map(([k, v]) => `${k}=${v}`).join(", ")}`);
} else {
  console.log("server scan concurrency already bounded");
}

// The dev user is hidden from /Users/Public: onboarding then shows the typed sign-in, and the
// tests that need a "Who is watching" list fake it.
const user = await api<{ Policy: Record<string, unknown> }>("GET", `/Users/${userId}`, { token });
if (user.Policy.IsHidden !== true) {
  await api("POST", `/Users/${userId}/Policy`, { token, body: { ...user.Policy, IsHidden: true } });
  console.log(`user ${USER} hidden from the public user list`);
} else {
  console.log(`user ${USER} already hidden`);
}

const existing = await api<VirtualFolder[]>("GET", "/Library/VirtualFolders", { token });
let created = 0;
for (const lib of LIBRARIES) {
  const found = existing.find((f) => f.Name === lib.name);
  if (!found) {
    const q = new URLSearchParams({
      name: lib.name,
      collectionType: lib.collectionType,
      refreshLibrary: "false",
    });
    q.append("paths", lib.path);
    await api("POST", `/Library/VirtualFolders?${q}`, {
      token,
      body: { LibraryOptions: { ...LIBRARY_OPTIONS, PathInfos: [{ Path: lib.path }] } },
    });
    created++;
    console.log(`library ${lib.name} created (${lib.collectionType}, ${lib.path})`);
    continue;
  }
  if (!found.Locations.includes(lib.path)) {
    await api("POST", "/Library/VirtualFolders/Paths?refreshLibrary=false", {
      token,
      body: { Name: lib.name, PathInfo: { Path: lib.path } },
    });
    console.log(`library ${lib.name}: added path ${lib.path}`);
  }
  await api("POST", "/Library/VirtualFolders/LibraryOptions", {
    token,
    body: { Id: found.ItemId, LibraryOptions: { ...found.LibraryOptions, ...LIBRARY_OPTIONS } },
  });
  console.log(`library ${lib.name} exists, options re-applied`);
}

if (created > 0 || process.argv.includes("--scan")) {
  await api("POST", "/Library/Refresh", { token });
  console.log("library scan triggered; follow it with: mise exec -- bun dev/jellyfin/wait-scan.ts");
} else {
  console.log("no new libraries, scan not triggered (pass --scan to force one)");
}

import type { FakeState, Device, FakeUser, UserData } from "./state";
import {
  type EpisodeItem,
  fileName,
  type ImageType,
  type Item,
  isVideo,
  itemOf,
  type Library,
  type MovieItem,
} from "./library";
import { defaultSubtitleIndex, deliver, type SubtitleProfile } from "./subtitles";

/**
 * Jellyfin 12.4's JSON for each object the app reads. Null fields are left out, as the server
 * leaves them out. Field sets follow the recorded fixtures and the generated BaseItemDto type;
 * the contract test compares them with a real server scanning the same corpus.
 */

export const SERVER_ID = "fa4e0000000000000000000000000001";
export const SERVER_VERSION = "12.4.0";

export interface DtoOptions {
  /** Lowercased `Fields` values, or "all" for GET /Items/{id}, which returns every field. */
  readonly fields: ReadonlySet<string> | "all";
  readonly enableImages: boolean;
  readonly enableUserData: boolean;
  readonly imageTypes: ReadonlySet<string> | undefined;
  readonly imageTypeLimit: number | undefined;
}

export const ALL_FIELDS: DtoOptions = {
  fields: "all",
  enableImages: true,
  enableUserData: true,
  imageTypes: undefined,
  imageTypeLimit: undefined,
};

const has = (o: DtoOptions, field: string) => o.fields === "all" || o.fields.has(field);

/** Drops undefined values, so absent fields stay absent in the JSON. */
const clean = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));

const premiere = (year: number) => `${year}-01-01T00:00:00.0000000Z`;

export function userItemData(data: UserData, itemId: string, runTimeTicks: number | undefined) {
  return clean({
    PlayedPercentage:
      data.playbackPositionTicks > 0 && runTimeTicks !== undefined && runTimeTicks > 0
        ? (data.playbackPositionTicks / runTimeTicks) * 100
        : undefined,
    PlaybackPositionTicks: data.playbackPositionTicks,
    PlayCount: data.playCount,
    IsFavorite: data.isFavorite,
    LastPlayedDate: data.lastPlayedDate,
    Played: data.played,
    Key: itemId,
    ItemId: itemId,
  });
}

function folderUserData(state: FakeState, library: Library, userId: string, item: Item) {
  const episodes = episodesUnder(library, item);
  const unplayed = episodes.filter((e) => !state.data(userId, e.id).played).length;
  const own = state.data(userId, item.id);
  return clean({
    UnplayedItemCount: unplayed,
    PlaybackPositionTicks: 0,
    PlayCount: own.playCount,
    IsFavorite: own.isFavorite,
    Played: episodes.length > 0 && unplayed === 0,
    Key: item.id,
    ItemId: item.id,
  });
}

export function episodesUnder(library: Library, item: Item): EpisodeItem[] {
  const ids =
    item.type === "Series"
      ? item.seasonIds.flatMap((s) => itemOf(library.items, s, "Season").episodeIds)
      : item.type === "Season"
        ? item.episodeIds
        : [];
  return ids.map((id) => itemOf(library.items, id, "Episode"));
}

const ASPECT: Partial<Record<ImageType, number>> = {
  Primary: 300 / 450,
  Thumb: 480 / 270,
};

/** Jellyfin's DtoOptions.GetImageLimit: a type outside EnableImageTypes has a limit of 0. */
const allowedImage = (o: DtoOptions, type: ImageType) =>
  o.enableImages &&
  o.imageTypeLimit !== 0 &&
  (o.imageTypes === undefined || o.imageTypes.has(type.toLowerCase()));

/**
 * ImageTags only with images enabled, BackdropImageTags (even empty) only when Backdrop is
 * allowed, and PrimaryImageAspectRatio only when asked for; a season borrows its series' poster.
 */
function imageFields(library: Library, item: Item, o: DtoOptions) {
  const tags: Record<string, string> = {};
  for (const type of ["Primary", "Logo", "Thumb"] as const) {
    const image = item.images[type];
    if (image && allowedImage(o, type)) tags[type] = image.tag;
  }
  const backdrop = item.images.Backdrop;
  const poster = item.type === "Season" ? itemOf(library.items, item.seriesId, "Series") : item;
  const aspect =
    item.type === "Episode" ? ASPECT.Thumb : poster.images.Primary ? ASPECT.Primary : undefined;
  return {
    PrimaryImageAspectRatio: has(o, "primaryimageaspectratio") ? aspect : undefined,
    ImageTags: o.enableImages ? tags : undefined,
    BackdropImageTags: allowedImage(o, "Backdrop") ? (backdrop ? [backdrop.tag] : []) : undefined,
  };
}

/** Image fields an episode or season borrows from its series. */
function parentImages(library: Library, seriesId: string, o: DtoOptions) {
  const series = itemOf(library.items, seriesId, "Series");
  const allowed = (type: ImageType) => allowedImage(o, type);
  return {
    ParentLogoItemId: series.images.Logo && allowed("Logo") ? seriesId : undefined,
    ParentLogoImageTag: allowed("Logo") ? series.images.Logo?.tag : undefined,
    ParentBackdropItemId: series.images.Backdrop && allowed("Backdrop") ? seriesId : undefined,
    ParentBackdropImageTags:
      series.images.Backdrop && allowed("Backdrop") ? [series.images.Backdrop.tag] : undefined,
    SeriesPrimaryImageTag: allowed("Primary") ? series.images.Primary?.tag : undefined,
  };
}

/** PlaybackInfo's subtitle delivery: the DeviceProfile's SubtitleProfiles and how it streams. */
export interface SubtitleDelivery {
  readonly token: string;
  readonly profiles: readonly SubtitleProfile[];
  readonly transcodingHls: boolean;
  readonly container: string;
}

const dashed = (id: string) =>
  `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;

/**
 * A MediaSourceInfo as Items and PlaybackInfo carry it. A PlaybackInfo with a DeviceProfile adds
 * each subtitle's delivery; one without a profile answers like Items.
 */
export function mediaSource(item: MovieItem | EpisodeItem, delivery?: SubtitleDelivery) {
  const streams = item.probed.streams.map((stream) => {
    if (delivery === undefined || stream.Type !== "Subtitle") return stream;
    const { method, format } = deliver(
      stream,
      delivery.profiles,
      delivery.transcodingHls,
      delivery.container,
    );
    if (method !== "External") return { ...stream, DeliveryMethod: method };
    return {
      ...stream,
      DeliveryMethod: method,
      DeliveryUrl: `/Videos/${dashed(item.id)}/${item.id}/Subtitles/${stream.Index}/0/Stream.${format}?ApiKey=${delivery.token}`,
      IsExternalUrl: false,
    };
  });
  const audio = item.probed.streams.filter((s) => s.Type === "Audio");
  const defaultAudio = audio.find((s) => s.IsDefault === true) ?? audio[0];
  return clean({
    Protocol: "File",
    Id: item.id,
    Path: item.path,
    Type: "Default",
    Container: item.container,
    Size: item.size,
    Name: fileName(item),
    IsRemote: false,
    ETag: item.etag,
    RunTimeTicks: item.probed.runTimeTicks,
    ReadAtNativeFramerate: false,
    IgnoreDts: false,
    IgnoreIndex: false,
    GenPtsInput: false,
    SupportsTranscoding: true,
    SupportsDirectStream: true,
    SupportsDirectPlay: true,
    IsInfiniteStream: false,
    UseMostCompatibleTranscodingProfile: false,
    RequiresOpening: false,
    RequiresClosing: false,
    RequiresLooping: false,
    SupportsProbing: true,
    VideoType: "VideoFile",
    MediaStreams: streams,
    MediaAttachments: [],
    Formats: [],
    Bitrate: item.probed.bitrate,
    RequiredHttpHeaders: {},
    TranscodingSubProtocol: "http",
    DefaultAudioStreamIndex: defaultAudio?.Index,
    DefaultSubtitleStreamIndex: defaultSubtitleIndex(item.probed.streams),
    HasSegments: false,
  });
}

export function baseItem(
  state: FakeState,
  library: Library,
  userId: string | undefined,
  item: Item,
  o: DtoOptions,
): Record<string, unknown> {
  const all = o.fields === "all";
  const common = {
    Name: item.name,
    ServerId: SERVER_ID,
    Id: item.id,
    DateCreated: has(o, "datecreated") ? item.dateCreated : undefined,
    SortName: has(o, "sortname") ? item.sortName : undefined,
    ChannelId: undefined,
    ...imageFields(library, item, o),
    LocationType: "FileSystem",
  };
  if (isVideo(item)) {
    const data = userId === undefined ? undefined : state.data(userId, item.id);
    const source = mediaSource(item);
    const episode =
      item.type === "Episode"
        ? (() => {
            const series = itemOf(library.items, item.seriesId, "Series");
            const season = itemOf(library.items, item.seasonId, "Season");
            return {
              IndexNumber: item.entry.episode,
              ParentIndexNumber: item.entry.season,
              SeriesName: series.name,
              SeriesId: series.id,
              SeasonId: season.id,
              SeasonName: season.name,
              ...parentImages(library, series.id, o),
            };
          })()
        : {};
    return clean({
      ...common,
      Container: item.formats,
      PremiereDate: premiere(item.year),
      HasSubtitles: item.probed.streams.some((s) => s.Type === "Subtitle") || undefined,
      Path: has(o, "path") ? item.path : undefined,
      Overview: has(o, "overview") ? item.overview : undefined,
      Genres: has(o, "genres") ? item.genres : undefined,
      GenreItems: all ? item.genres.map((name) => ({ Name: name, Id: genreId(name) })) : undefined,
      // The corpus NFOs name a studio for films only.
      Studios: all ? (item.type === "Movie" ? [STUDIO] : []) : undefined,
      People: has(o, "people") ? [] : undefined,
      Taglines: all ? [] : undefined,
      ProviderIds: all ? {} : undefined,
      MediaSources: has(o, "mediasources") ? [source] : undefined,
      MediaStreams: has(o, "mediastreams") ? source["MediaStreams"] : undefined,
      RunTimeTicks: item.probed.runTimeTicks,
      ProductionYear: item.year,
      IsFolder: false,
      Type: item.type,
      ...episode,
      UserData:
        o.enableUserData && data !== undefined
          ? userItemData(data, item.id, item.probed.runTimeTicks)
          : undefined,
      VideoType: "VideoFile",
      MediaType: "Video",
      Width: all ? item.probed.streams.find((s) => s.Type === "Video")?.["Width"] : undefined,
      Height: all ? item.probed.streams.find((s) => s.Type === "Video")?.["Height"] : undefined,
    });
  }
  const userData =
    o.enableUserData && userId !== undefined && item.type !== "CollectionFolder"
      ? folderUserData(state, library, userId, item)
      : undefined;
  if (item.type === "Series") {
    return clean({
      ...common,
      PremiereDate: premiere(item.meta.year),
      Path: has(o, "path") ? item.path : undefined,
      Overview: has(o, "overview") ? item.meta.plot : undefined,
      Genres: has(o, "genres") ? item.meta.genres : undefined,
      GenreItems: all
        ? item.meta.genres.map((name) => ({ Name: name, Id: genreId(name) }))
        : undefined,
      People: has(o, "people") ? [] : undefined,
      Studios: all ? [STUDIO] : undefined,
      ProviderIds: all ? {} : undefined,
      ChildCount: has(o, "childcount") ? item.seasonIds.length : undefined,
      ProductionYear: item.meta.year,
      IsFolder: true,
      Type: "Series",
      UserData: userData,
      Status: "Ended",
      AirDays: [],
      MediaType: "Unknown",
    });
  }
  if (item.type === "Season") {
    const series = itemOf(library.items, item.seriesId, "Series");
    return clean({
      ...common,
      Path: has(o, "path") ? item.path : undefined,
      ChildCount: has(o, "childcount") ? item.episodeIds.length : undefined,
      Studios: all ? [] : undefined,
      IndexNumber: item.index,
      IsFolder: true,
      Type: "Season",
      ParentId: has(o, "parentid") ? series.id : undefined,
      SeriesName: series.name,
      SeriesId: series.id,
      ...parentImages(library, series.id, o),
      UserData: userData,
      MediaType: "Unknown",
    });
  }
  return clean({
    ...common,
    IsFolder: true,
    Type: "CollectionFolder",
    CollectionType: item.collectionType,
    MediaType: "Unknown",
  });
}

export const genreId = (name: string) =>
  Buffer.from(name).toString("hex").padEnd(32, "0").slice(0, 32);

const STUDIO = { Name: "harakiri corpus", Id: genreId("studio:harakiri corpus") };

export function userDto(user: FakeUser) {
  return clean({
    Name: user.name,
    ServerId: SERVER_ID,
    Id: user.id,
    HasPassword: user.password !== "",
    HasConfiguredPassword: user.password !== "",
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: false,
    LastLoginDate: user.lastLoginDate,
    LastActivityDate: user.lastLoginDate,
    Configuration: {
      PlayDefaultAudioTrack: true,
      SubtitleLanguagePreference: "",
      DisplayMissingEpisodes: false,
      GroupedFolders: [],
      SubtitleMode: "Default",
      DisplayCollectionsView: false,
      EnableLocalPassword: false,
      OrderedViews: [],
      LatestItemsExcludes: [],
      MyMediaExcludes: [],
      HidePlayedInLatest: true,
      RememberAudioSelections: true,
      RememberSubtitleSelections: true,
      EnableNextEpisodeAutoPlay: true,
      CastReceiverId: "F007D354",
    },
    Policy: {
      IsAdministrator: user.isAdministrator,
      IsHidden: user.isHidden,
      EnableCollectionManagement: false,
      EnableSubtitleManagement: false,
      EnableLyricManagement: false,
      IsDisabled: false,
      BlockedTags: [],
      AllowedTags: [],
      EnableUserPreferenceAccess: true,
      AccessSchedules: [],
      BlockUnratedItems: [],
      EnableRemoteControlOfOtherUsers: false,
      EnableSharedDeviceControl: true,
      EnableRemoteAccess: true,
      EnableLiveTvManagement: true,
      EnableLiveTvAccess: true,
      EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: true,
      EnableVideoPlaybackTranscoding: true,
      EnablePlaybackRemuxing: true,
      ForceRemoteSourceTranscoding: false,
      EnableContentDeletion: false,
      EnableContentDeletionFromFolders: [],
      EnableContentDownloading: true,
      EnableSyncTranscoding: true,
      EnableMediaConversion: true,
      EnabledDevices: [],
      EnableAllDevices: true,
      EnabledChannels: [],
      EnableAllChannels: true,
      EnabledFolders: [],
      EnableAllFolders: true,
      InvalidLoginAttemptCount: 0,
      LoginAttemptsBeforeLockout: -1,
      MaxActiveSessions: 0,
      EnablePublicSharing: true,
      BlockedMediaFolders: [],
      BlockedChannels: [],
      RemoteClientBitrateLimit: 0,
      AuthenticationProviderId:
        "Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider",
      PasswordResetProviderId: "Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider",
      SyncPlayAccess: "CreateAndJoinGroups",
    },
  });
}

/** The fields of /Users/Public: name, id, whether a password is needed. */
export function publicUserDto(user: FakeUser) {
  return {
    Name: user.name,
    ServerId: SERVER_ID,
    Id: user.id,
    HasPassword: user.password !== "",
    HasConfiguredPassword: user.password !== "",
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: false,
  };
}

export function sessionDto(
  state: FakeState,
  library: Library,
  device: Device,
  /** The caller's address; the Quick Connect sign-in answer leaves it out. */
  remote: string | undefined,
): Record<string, unknown> {
  const user = state.user(device.userId);
  const playing = device.nowPlaying;
  const item = playing === undefined ? undefined : library.items.get(playing.itemId);
  return clean({
    PlayState: clean({
      PositionTicks: playing?.positionTicks,
      CanSeek: playing !== undefined,
      IsPaused: playing?.isPaused ?? false,
      IsMuted: false,
      AudioStreamIndex: playing?.audioStreamIndex,
      SubtitleStreamIndex: playing?.subtitleStreamIndex,
      MediaSourceId: playing?.mediaSourceId,
      PlayMethod: playing?.playMethod,
      RepeatMode: "RepeatNone",
      PlaybackOrder: "Default",
      PlaySessionId: playing?.playSessionId,
    }),
    AdditionalUsers: [],
    Capabilities: {
      PlayableMediaTypes: [],
      SupportedCommands: [],
      SupportsMediaControl: false,
      SupportsPersistentIdentifier: true,
    },
    RemoteEndPoint: remote,
    PlayableMediaTypes: [],
    Id: device.sessionId,
    UserId: device.userId,
    UserName: user?.name,
    Client: device.client,
    LastActivityDate: device.lastActivity,
    LastPlaybackCheckIn: device.lastActivity,
    DeviceName: device.device,
    NowPlayingItem:
      item === undefined || state.user(device.userId) === undefined
        ? undefined
        : baseItem(state, library, undefined, item, {
            fields: new Set(["mediastreams"]),
            enableImages: true,
            enableUserData: false,
            imageTypes: undefined,
            imageTypeLimit: undefined,
          }),
    DeviceId: device.deviceId,
    ApplicationVersion: device.version,
    IsActive: true,
    SupportsMediaControl: false,
    SupportsRemoteControl: false,
    NowPlayingQueue: [],
    HasCustomDeviceName: false,
    ServerId: SERVER_ID,
    SupportedCommands: [],
  });
}

export function deviceDto(state: FakeState, device: Device) {
  return {
    Id: device.deviceId,
    Name: device.device,
    AppName: device.client,
    AppVersion: device.version,
    LastUserName: state.user(device.userId)?.name ?? "",
    LastUserId: device.userId,
    DateLastActivity: device.lastActivity,
    Capabilities: {
      PlayableMediaTypes: [],
      SupportedCommands: [],
      SupportsMediaControl: false,
      SupportsPersistentIdentifier: true,
    },
  };
}

export const queryResult = (items: readonly unknown[], total = items.length, start = 0) => ({
  Items: items,
  TotalRecordCount: total,
  StartIndex: start,
});

// Values marked current change over time; sources: youtubei.js, ytmusicapi and bgutils-js

export const MUSIC_ORIGIN = "https://music.youtube.com";
export const WWW_ORIGIN = "https://www.youtube.com";

/** Private header main turns into `User-Agent`. */
export const UA_HEADER = "x-nuvo-ua";

export interface ClientContext {
  clientName: string;
  headerId: number;
  /** current */
  clientVersion: string;
  origin: string;
  userAgent?: string;
  extra?: Record<string, string | number>;
}

export const COBALT_UA = "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)";

export const WEB_REMIX: ClientContext = {
  clientName: "WEB_REMIX",
  headerId: 67,
  // Refresh when YouTube changes the live web player version (cver on its requests).
  clientVersion: "1.20261027.10.00",
  origin: MUSIC_ORIGIN,
};

export const WEB: ClientContext = {
  clientName: "WEB",
  headerId: 1,
  clientVersion: "2.20250925.01.00",
  origin: WWW_ORIGIN,
};

export const TVHTML5: ClientContext = {
  clientName: "TVHTML5",
  headerId: 7,
  clientVersion: "7.20260707.07.00",
  origin: WWW_ORIGIN,
  userAgent: COBALT_UA,
  extra: { userAgent: COBALT_UA },
};

export const VISIONOS: ClientContext = {
  clientName: "VISIONOS",
  headerId: 101,
  clientVersion: "1.02",
  origin: WWW_ORIGIN,
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  extra: {
    osName: "visionOS",
    osVersion: "26.5.23O471",
    deviceMake: "Apple",
    deviceModel: "RealityDevice17,1",
  },
};

const ANDROID_VR_UA = "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";

export const ANDROID_VR: ClientContext = {
  clientName: "ANDROID_VR",
  headerId: 28,
  clientVersion: "1.65.10",
  origin: WWW_ORIGIN,
  userAgent: ANDROID_VR_UA,
  extra: {
    osName: "Android",
    osVersion: "12L",
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    androidSdkVersion: 32,
  },
};

/** Search `params` values (protobuf, URL-encoded base64), public in ytmusicapi. */
export const SEARCH_PARAMS = {
  track: "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D",
  video: "EgWKAQIQAWoKEAkQBRAKEAMQBA%3D%3D",
  artist: "EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D",
  album: "EgWKAQIYAWoKEAkQBRAKEAMQBA%3D%3D",
  playlist: "EgWKAQIoAWoKEAkQBRAKEAMQBA%3D%3D",
} as const;

/** `GenerateIT` request key for the content token. Public in the bgutils-js examples. */
export const CONTENT_REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";

/** `/s/player/{id}/`, also with JSON-escaped slashes as `iframe_api` writes it. */
export const PLAYER_PATH = /\\?\/s\\?\/player\\?\/([\w-]{4,32})\\?\//;

export const PLACEHOLDER_ARTIST = "Unknown artist";
export const PLACEHOLDER_TITLE = "Untitled";
export const IMPORT_DEFAULT_TITLE = "YouTube playlist";

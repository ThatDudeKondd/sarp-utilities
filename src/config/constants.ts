export const CONSTANTS = {
  DEFAULT_TIMEOUT: 5000,
  MAX_RETRIES: 3,
  // Discord's own palette reads far more "native" than pure RGB primaries.
  EMBED_COLOR: 0x5865f2, // blurple
  EMBED_ERROR_COLOR: 0xed4245, // red
  EMBED_SUCCESS_COLOR: 0x57f287, // green
  EMBED_WARNING_COLOR: 0xfaa61a, // orange (pure yellow is hard to read against dark theme)
  EMBED_INFRACTION_COLOR: 0xe74c3c, // distinct from error red, reserved for moderation actions
  EMBED_FOOTER_TEXT: "SARP Utilities",
  MAX_EMBED_FIELDS: 25,
  MAX_FIELD_LENGTH: 1024,
} as const;

export const CLIENT_ID = process.env.CLIENT_ID || "";
export const BOT_TOKEN = process.env.BOT_TOKEN || "";
export const ERLC_API_KEY = process.env.ERLC_API_KEY || "";
export const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || "";
/** Role pinged alongside command-error logs. Unset = no ping. */
export const ERROR_ALERT_ROLE_ID = process.env.ERROR_ALERT_ROLE_ID || "";

function parseIdList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Discord user IDs allowed to use the djsko (`-jsk`) owner console. */
export const JSK_OWNER_IDS = parseIdList(process.env.JSK_OWNERS);
/** Subset of owners allowed to run `-jsk sh` on the host. */
export const JSK_SHELL_OWNER_IDS = parseIdList(process.env.JSK_SHELL_OWNERS);

/**
 * Shape of the ERLC `/Server` endpoint response, based on a real sample response.
 * Broken into per-section interfaces for readability; ErlcServerInfo at the
 * bottom is the one you actually cast the fetch response to.
 */

export interface ErlcPlayerLocation {
  LocationX: number;
  LocationZ: number;
  PostalCode: string;
  StreetName: string;
  BuildingNumber: string;
}

/** "Normal" | "Server Administrator" | "Server Owner" | "Server Moderator" */
export type ErlcPlayerPermission =
  | "Normal"
  | "Server Administrator"
  | "Server Owner"
  | "Server Moderator";

export interface ErlcPlayer {
  /** In-game team, e.g. "Sheriff", "Police", "Fire", "Civilian" — not an exhaustive list, widen if you hit others. */
  Team: string;
  /** Formatted as "PlayerName:Id" */
  Player: string;
  Callsign: string;
  Location: ErlcPlayerLocation;
  Permission: ErlcPlayerPermission;
  WantedStars: number;
}

/** Maps player ID (as a string key) -> player name */
export type ErlcStaffRoster = Record<string, string>;

export interface ErlcStaff {
  Admins: ErlcStaffRoster;
  Mods: ErlcStaffRoster;
  Helpers: ErlcStaffRoster;
}

export interface ErlcJoinLogEntry {
  Join: boolean;
  /** Unix timestamp, in seconds */
  Timestamp: number;
  /** Formatted as "PlayerName:Id" */
  Player: string;
}

export interface ErlcKillLogEntry {
  /** Formatted as "PlayerName:Id" */
  Killed: string;
  /** Unix timestamp, in seconds */
  Timestamp: number;
  /** Formatted as "PlayerName:Id" */
  Killer: string;
}

export interface ErlcCommandLogEntry {
  /** Formatted as "PlayerName:Id" */
  Player: string;
  /** Unix timestamp, in seconds */
  Timestamp: number;
  Command: string;
}

export interface ErlcModCallEntry {
  /** Formatted as "PlayerName:Id" */
  Caller: string;
  /** Formatted as "PlayerName:Id" */
  Moderator: string;
  /** Unix timestamp, in seconds */
  Timestamp: number;
}

export interface ErlcEmergencyCall {
  /** In-game team, e.g. "Police", "Fire" — not an exhaustive list. */
  Team: string;
  /**
   * NOTE: numeric player ID here, unlike the "PlayerName:Id" string format
   * used for Caller elsewhere (e.g. ErlcModCallEntry.Caller). Confirmed from
   * the sample response — worth double-checking against real traffic before
   * relying on this being consistently numeric.
   */
  Caller: number;
  /** Empty in the sample response — element shape unconfirmed. */
  Players: unknown[];
  /** [x, y] coordinates */
  Position: [number, number];
  /** Unix timestamp, in seconds */
  StartedAt: number;
  CallNumber: number;
  Description: string;
  PositionDescriptor: string;
}

export interface ErlcVehicle {
  Name: string;
  Owner: string;
  Plate: string;
  Texture: string;
  ColorHex: string;
  ColorName: string;
}

/** "Disabled" | "Email" | "Phone/ID" */
export type ErlcAccVerifiedReq = "Disabled" | "Email" | "Phone/ID";

export interface ErlcServerInfo {
  Name: string;
  OwnerId: number;
  CoOwnerIds: number[];
  CurrentPlayers: number;
  MaxPlayers: number;
  JoinKey: string;
  AccVerifiedReq: ErlcAccVerifiedReq;
  TeamBalance: boolean;
  Players: ErlcPlayer[];
  Staff: ErlcStaff;
  JoinLogs: ErlcJoinLogEntry[];
  Queue: number[];
  KillLogs: ErlcKillLogEntry[];
  CommandLogs: ErlcCommandLogEntry[];
  ModCalls: ErlcModCallEntry[];
  EmergencyCalls: ErlcEmergencyCall[];
  Vehicles: ErlcVehicle[];
}

type ISODateString =
  `${number}-${number}-${number}T${number}:${number}:${number}.${number}Z` & {
    readonly __brand: unique symbol;
  };

export interface RobloxAPIResponse {
  description: string;
  created: ISODateString;
  isBanned: boolean;
  externalAppDisplayName: string;
  hasVerifiedBadge: boolean;
  id: number;
  name: string;
  displayName: string;
}

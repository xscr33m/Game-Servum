/**
 * RCON module — factory + re-exports
 */

import type {
  RconClient,
  RconConnectionOptions,
  GenericRconPlayer,
} from "./types.js";
import type { RconProtocol } from "@game-servum/shared";
import { BattlEyeRcon } from "./battleye.js";
import { TelnetRcon } from "./telnet.js";
import { SourceRcon } from "./source.js";

export type {
  RconClient,
  RconConnectionOptions,
  GenericRconPlayer,
} from "./types.js";
export {
  BattlEyeRcon,
  type BattlEyePlayer,
  parseBattlEyePlayersResponse,
} from "./battleye.js";
export { TelnetRcon, parseTelnetPlayersResponse } from "./telnet.js";
export { SourceRcon, parseSourcePlayersResponse } from "./source.js";

/**
 * Create an RCON client for the given protocol.
 */
export function createRconClient(
  protocol: RconProtocol,
  options: RconConnectionOptions,
): RconClient {
  switch (protocol) {
    case "battleye":
      return new BattlEyeRcon(options);
    case "telnet":
      return new TelnetRcon(options);
    case "source":
      return new SourceRcon(options);
    default:
      throw new Error(`Unknown RCON protocol: ${protocol}`);
  }
}

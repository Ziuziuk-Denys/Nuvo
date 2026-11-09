import { BotGuardClient } from "bgutils-js/botguard";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import { WebPoMinter } from "bgutils-js/webpo";
import type { BotGuard } from "./tokens";

export function bgutilsBotGuard(): BotGuard {
  return {
    async snapshot(challenge, interpreter) {
      // The interpreter defines its VM on the global object, as a classic script would.
      new Function(interpreter).call(globalThis);
      const client = await BotGuardClient.create({
        program: challenge.program,
        globalName: challenge.globalName,
        globalObject: globalThis,
      });
      const signalOutput: WebPoSignalOutput = [];
      const response = await client.snapshot({
        webPoSignalOutput: signalOutput,
      });
      return { response, signalOutput };
    },
    async minter(integrityToken, ttlSecs, refreshSecs, signalOutput) {
      const minter = await WebPoMinter.create(
        {
          integrityToken,
          estimatedTtlSecs: ttlSecs,
          mintRefreshThreshold: refreshSecs,
        },
        signalOutput as WebPoSignalOutput,
      );
      return { mint: (identifier) => minter.mintAsWebsafeString(identifier) };
    },
  };
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ensureSaRelayShell,
  getSaRelay,
  startSaRelay,
  stopSaRelay,
} from "../server/sa-relay";

const SID = "sa-bridge-test-session";
const URL_A =
  "https://ws2.labplatformplus.com/rm/featured?token=tokA&username=u1";
const URL_B =
  "https://ws2.labplatformplus.com/rm/featured?token=tokB&username=u1";

describe("SA bridge mode (ERR26 guard)", () => {
  it("enterBridgeMode keeps shell reusable without opening a competing start()", async () => {
    stopSaRelay(SID);
    const shell = ensureSaRelayShell(SID, URL_A);
    shell.enterBridgeMode();
    assert.equal(shell.isForegroundBridgeActive(), true);

    const { relay, reused } = await startSaRelay(SID, URL_B);
    assert.equal(reused, true);
    assert.equal(relay, shell);
    assert.equal(relay.isForegroundBridgeActive(), true);
    assert.equal(relay.matchesToken("tokB"), true);
    assert.equal(relay.getStatus(), "connecting");

    stopSaRelay(SID);
    assert.equal(getSaRelay(SID), null);
  });

  it("leaveBridgeMode clears bridge flag", async () => {
    stopSaRelay(SID);
    const shell = ensureSaRelayShell(SID, URL_A);
    shell.enterBridgeMode();
    // Don't await full WS connect in CI — just verify flag flip path.
    const leavePromise = shell.leaveBridgeMode();
    assert.equal(shell.isForegroundBridgeActive(), false);
    // Abort quickly: stop before background connect settles.
    stopSaRelay(SID);
    await leavePromise.catch(() => {});
  });
});

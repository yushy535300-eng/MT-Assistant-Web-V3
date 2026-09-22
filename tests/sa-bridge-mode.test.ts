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

  it("enterBridgeMode before start prevents competing PS_LOGIN (direct iframe path)", async () => {
    stopSaRelay(SID);
    // Simulate homepage background shell, then direct-iframe enter (proxy failed).
    const background = ensureSaRelayShell(SID, URL_A);
    assert.equal(background.isForegroundBridgeActive(), false);
    ensureSaRelayShell(SID, URL_B).enterBridgeMode();
    const { relay, reused } = await startSaRelay(SID, URL_B);
    assert.equal(reused, true);
    assert.equal(relay.isForegroundBridgeActive(), true);
    assert.equal(relay.matchesToken("tokB"), true);
    stopSaRelay(SID);
  });

  it("retargetBackground exists for recovery but enter must use a DIFFERENT token", async () => {
    stopSaRelay(SID);
    const shell = ensureSaRelayShell(SID, URL_A);
    shell.enterBridgeMode();
    assert.equal(shell.isForegroundBridgeActive(), true);
    // Dual-SALI while the game holds token A still ERR26s this platform —
    // enter UI must NOT call this. Kept only as an explicit recovery API.
    const retargetPromise = shell.retargetBackground(URL_B);
    assert.equal(shell.isForegroundBridgeActive(), false);
    assert.equal(shell.matchesToken("tokB"), true);
    stopSaRelay(SID);
    await retargetPromise.catch(() => {});
  });

  it("retargetBackground rejects the same SALI token (ERR26 guard)", async () => {
    stopSaRelay(SID);
    const shell = ensureSaRelayShell(SID, URL_A);
    shell.enterBridgeMode();
    await assert.rejects(
      () => shell.retargetBackground(URL_A),
      /不同 SALI token|ERR26/,
    );
    assert.equal(shell.isForegroundBridgeActive(), true);
    assert.equal(shell.matchesToken("tokA"), true);
    stopSaRelay(SID);
  });
});

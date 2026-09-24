import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("wallet transfer around enter and leave", () => {
  it("sweeps to main then enters via TZ game login auto-wallet", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "app/index.tsx"), "utf8");
    const openStart = source.indexOf("const openCurrentPlatform");
    const closeStart = source.indexOf("const closeGameView");
    const execStart = source.indexOf("const executeTransferAll");
    const loginSweep = source.slice(
      source.indexOf("After TZ login: quick one-shot sweep"),
      source.indexOf("DG relay follows"),
    );
    const openFn = source.slice(openStart, closeStart);
    const closeFn = source.slice(closeStart, execStart);
    expect(loginSweep).toContain("runAutoSweepToMain");
    expect(loginSweep).toContain("skipEmptyCheck: true");
    expect(loginSweep).toContain("silent: true");
    expect(loginSweep).toContain("quickSweepToMain");
    expect(loginSweep).not.toContain(
      "Background MTLI/DGLI just auto-pulled money into those games",
    );
    expect(openFn).toContain("quickSweepToMain");
    expect(openFn).toContain("ensureDgAuthorization(true)");
    expect(openFn).not.toContain('fetch("/api/dg/start"');
    expect(openFn).toContain("enteringGameWalletRef.current = !liveOnly");
    expect(openFn).toContain("已轉入DG");
    expect(openFn).toContain("getExternalLoginUrlFromPlatform");
    expect(openFn).toContain("isDemoPlatformToken");
    expect(openFn).toContain('activePlatform === "MV"');
    expect(openFn).toContain("已在程式內開啟美女直播");
    expect(openFn).not.toContain("已於新分頁開啟美女直播");
    expect(openFn).not.toContain("再次開啟");
    expect(openFn).toContain("LIVE77");
    expect(openFn).toContain("演示模式無法開啟美女直播");
    expect(openFn).toContain("演示模式無法進入 SA 遊戲畫面");
    expect(openFn).toContain('enterExternalSameOriginProxy(url, "SA")');
    expect(openFn).toContain('enterExternalSameOriginProxy(url, "MV")');
    expect(openFn).not.toContain("無法內嵌");
    expect(source).toContain("getExternalLoginUrlFromPlatform");
    expect(source).toContain("resolveExternalGameCodes");
    expect(source).toContain("SALI");
    expect(source).toContain("LIVE77");
    expect(source).toContain("uid");
    expect(source).toContain("userid");
    expect(source).toContain("沙龍");
    expect(source).toContain("美女");
    expect(openFn).toContain("suppressDgRecoveryRef.current = true");
    expect(openFn).not.toContain("const needsWalletReentry");
    expect(openFn).toContain("setDgConnectEpoch");
    expect(source).not.toContain("DG 遊戲中使用原工作階段恢復牌路連線");
    expect(source).toContain("dg真人");
    expect(source).toContain("mt真人");
    expect(source).not.toContain("歐博");
    expect(source).not.toContain("AB01");
    expect(source).not.toContain("YABOZR");
    expect(closeFn).toContain("pullAllGameWalletsToMain");
    expect(closeFn).toContain("void Promise.all(leaveJobs);");
    // 回牌路 gate only — must clear pendingAutoEnter (no auto-enter after leave).
    expect(closeFn).toContain("pendingAutoEnterRef.current = false");
    expect(closeFn).toContain("setWalletTransferBusy(true)");
    // Enter-time 轉點 then open game in the same openCurrentPlatform call.
    expect(openFn).toContain("pendingAutoEnterRef.current = true");
    expect(openFn).toMatch(/quickSweepToMain[\s\S]*setMtOpen\(true\)/);
    expect(source.slice(execStart, execStart + 800)).toContain("transferAllToMainWallet");
    expect(source).toContain("onPress={confirmTransferAll}");
    expect(source).not.toMatch(/hasEnteredGame\s*&&/);
    expect(source).toContain('MT: "MTLI"');
    expect(source).toContain('DG: "DGLI"');
    expect(source).toContain('SA: "SA"');
    expect(source).toContain('MV: "美女直播"');
    expect(source).toContain('SA: "SALI"');
    expect(source).toContain('MV: "LIVE77"');
    expect(source).toContain("token ? await request(true)");
    expect(source).toContain("MV_LIVE_ROOM_FALLBACK");
    expect(source).toContain("/mv-hosts/");
    expect(openFn).not.toContain("table.streamUrl");
    expect(source).toContain("registerAndLogin");
    expect(source).toContain("objectPosition");
    expect(source).toContain("aspectRatio: 1");
  });
});

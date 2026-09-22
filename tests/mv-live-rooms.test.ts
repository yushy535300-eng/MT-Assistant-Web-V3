import { describe, expect, it } from "vitest";
import {
  MV_LIVE_ROOM_CATALOG,
  MV_COMING_SOON_MESSAGE,
  parseMvLobbyHtml,
  mvRoomsOrFallback,
} from "../server/mv-live-rooms";

const SAMPLE = `
<ul class="gameItem-list gameOB">
  <li></li>
  <li>
    <a href="https://tz02.score777.net/live/home/indexView?uid=1161&amp;userid=abc">
      <img class="img h-anchor-cover-img" src="https://tz02.score777.net/uploads/avatar/2026/05/09/69fe0d3d9793a.jpg">
      <article class="gameLogo-box">
        <img class="logo-img" src="https://tz02.score777.net/views/modules/live/home/asset/index/v1/upload/livegif.gif">
        <span class="logo-txt">雙雙 GAME TIME 跟著雙雙一起贏大錢~</span>
      </article>
    </a>
  </li>
  <li>
    <a onclick="offline()">
      <img class="img h-anchor-cover-img" src="https://tz02.score777.net/uploads/avatar/2026/06/01/6a1d3ce1e6aa9.jpg">
      <article class="gameLogo-box">
        <img class="logo-img" style="filter: grayscale(100%);" src="liveicon.png">
        <span class="logo-txt">跟著沄曦走 荷包一直有 ~</span>
      </article>
    </a>
  </li>
  <li>
    <a onclick="offline()">
      <img class="img h-anchor-cover-img" src="">
      <article class="gameLogo-box"><span class="logo-txt"></span></article>
    </a>
  </li>
</ul>
`;

describe("mv-live-rooms", () => {
  it("ships catalog with offline hosts + 老爺 coming soon", () => {
    expect(MV_LIVE_ROOM_CATALOG.length).toBeGreaterThanOrEqual(4);
    const laoye = MV_LIVE_ROOM_CATALOG.find((r) => r.comingSoon);
    expect(laoye?.name).toBe("老爺");
    expect(laoye?.live).toBe(false);
    expect(laoye?.title).toContain("還沒好");
    expect(MV_COMING_SOON_MESSAGE).toMatch(/期待/);
  });

  it("parses lobby HTML including offline and 老爺 slot", () => {
    const rooms = parseMvLobbyHtml(SAMPLE);
    expect(rooms.length).toBeGreaterThanOrEqual(3);
    expect(rooms[0]).toMatchObject({
      name: "雙雙",
      live: true,
      uid: "1161",
    });
    expect(rooms[0].avatar).toBe("/mv-hosts/69fe0d3d9793a.jpg");
    expect(rooms[0].roomUrl).toContain("uid=1161");
    expect(rooms[1]).toMatchObject({ name: "沄曦", live: false });
    const laoye = rooms.find((r) => r.comingSoon);
    expect(laoye).toMatchObject({ name: "老爺", live: false });
  });

  it("falls back to catalog when parse is empty", () => {
    expect(mvRoomsOrFallback([])).toEqual(MV_LIVE_ROOM_CATALOG);
  });
});

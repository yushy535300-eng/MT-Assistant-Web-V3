import {describe,expect,it} from "vitest";
import {abCategory,abPoker,abRank,abRoad,abRoadFromCards,dbCategory} from "../server/vendor-relay";
import {pickLaunchUrl} from "../server/vendor-launch";

describe("歐博 HAR 協議",()=>{
  it("以路紙內的莊閒點數判定勝負",()=>{
    expect(abRoad("164020A00300")).toBe("莊"); // 莊6、閒4
    expect(abRoad("187000801000")).toBe("莊"); // 莊8、閒7
    expect(abRoad("177000000000")).toBe("和");
  });
  it("保留雙方最多三張牌並把十與人頭牌算零點",()=>{
    expect(abRank("412")).toBe(10);
    expect(abPoker([["303","401","412"],["306","112","-1"]])).toBe(JSON.stringify({player:"3-A-Q",banker:"6-Q"}));
  });
  it("只留下已確認的百家桌類別",()=>{
    expect([101,103,104,110,111].map(abCategory)).toEqual(["一般","快速","免佣","保險","VIP"]);
    expect(abCategory(301)).toBe("其他");
  });
  it("完整牌面後才判定勝負",()=>{
    expect(abRoadFromCards([["409","202"],["403","201"]])).toBe("閒");
    expect(abRoadFromCards([["303"],["306","112"]])).toBe(null);
  });
});

describe("DB 大廳分類",()=>{
  it("分類文字穩定映射且預設一般",()=>{
    expect(dbCategory("終極百家樂")).toBe("終極");
    expect(dbCategory("包桌百家乐")).toBe("包桌");
    expect(dbCategory("")).toBe("一般");
  });
});

describe("歐博／DB 啟動網址",()=>{
  it("歐博接受 sessionId 而不是 token",()=>{
    expect(pickLaunchUrl({
      data:{url:"https://www.ab8888.games/entry?sessionId=abc123"},
    },"AB")).toContain("sessionId=abc123");
  });
  it("DB 接受加密 params",()=>{
    expect(pickLaunchUrl({
      data:{game_url:"https://pc.jhui100.com/play?params=xyz"},
    },"DB")).toContain("params=xyz");
  });
});

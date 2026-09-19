import {describe,expect,it} from "vitest";
import {abCategory,abPoker,abRank,abRoad,dbCategory} from "../server/vendor-relay";

describe("歐博 HAR 協議",()=>{
  it("以路紙內的莊閒點數判定勝負",()=>{
    expect(abRoad("164020A00300")).toBe("莊"); // 莊6、閒4
    expect(abRoad("187000801000")).toBe("莊"); // 莊8、閒7
    expect(abRoad("177000000000")).toBe("和");
  });
  it("保留雙方最多三張牌並把十與人頭牌算零點",()=>{
    expect(abRank("412")).toBe(10);
    expect(abPoker([["303","401","412"],["306","112","-1"]])).toBe(JSON.stringify({player:"3-1-10",banker:"6-10"}));
  });
  it("只留下已確認的百家桌類別",()=>{
    expect([101,103,104,110,111].map(abCategory)).toEqual(["一般","快速","免佣","保險","VIP"]);
    expect(abCategory(301)).toBe("其他");
  });
});

describe("DB 大廳分類",()=>{
  it("分類文字穩定映射且預設一般",()=>{
    expect(dbCategory("終極百家樂")).toBe("終極");
    expect(dbCategory("包桌百家乐")).toBe("包桌");
    expect(dbCategory("")).toBe("一般");
  });
});

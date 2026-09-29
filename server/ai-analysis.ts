import { loadTrackerSession } from "./sessions";

export type AiProvider = "chatgpt" | "gemini" | "grok" | "meta" | "combined";
export type AiSide = "莊" | "閒";

export type AiAnalysisResult = {
  provider: AiProvider;
  side: AiSide;
  confidence: number;
  summary: string;
  availableProviders?: string[];
  unavailableProviders?: string[];
};

type Provider = Exclude<AiProvider, "combined">;
type ProviderResult = AiAnalysisResult & { provider: Provider };
type AnalysisInput = {
  sessionId: string;
  provider: AiProvider;
  tableName?: string;
  dealer?: string;
  round?: number;
  results: string[];
  pattern?: string;
  localScoreBanker?: number;
  localScorePlayer?: number;
};

const PROVIDER_LABEL: Record<Provider, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
  meta: "Meta AI",
};

const sideValue = (v: string) => (v === "莊" ? 1 : v === "閒" ? -1 : 0);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function hashText(text: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += h << 13;
  h ^= h >>> 7;
  h += h << 3;
  h ^= h >>> 17;
  h += h << 5;
  return h >>> 0;
}

function variantIndex(input: AnalysisInput, provider: Provider | "combined", size: number, salt = 0) {
  const seed = `${provider}|${input.tableName ?? ""}|${input.round ?? 0}|${input.results.slice(-30).join("")}|${salt}`;
  return hashText(seed, salt) % Math.max(1, size);
}

function cleanRoad(results: string[]) {
  return results.filter((x) => x === "莊" || x === "閒");
}

function currentStreak(road: string[]) {
  if (!road.length) return { side: "" as "莊" | "閒" | "", length: 0 };
  const side = road[road.length - 1] as "莊" | "閒";
  let length = 1;
  for (let i = road.length - 2; i >= 0; i -= 1) {
    if (road[i] !== side) break;
    length += 1;
  }
  return { side, length };
}

function alternationRate(road: string[], take = 8) {
  const arr = road.slice(-take);
  if (arr.length < 2) return 0;
  let changes = 0;
  for (let i = 1; i < arr.length; i += 1) if (arr[i] !== arr[i - 1]) changes += 1;
  return changes / (arr.length - 1);
}

function weightedMomentum(road: string[], take: number) {
  const arr = road.slice(-take);
  let score = 0;
  arr.forEach((x, i) => {
    const weight = 1 + i / Math.max(1, arr.length - 1) * 1.8;
    score += sideValue(x) * weight;
  });
  return score;
}

function distributionScore(road: string[], take: number) {
  const arr = road.slice(-take);
  return arr.reduce((sum, x) => sum + sideValue(x), 0);
}

function providerTieBreak(provider: Provider, input: AnalysisInput, road: string[]): AiSide {
  const last = road.at(-1) as AiSide | undefined;
  if (provider === "chatgpt") {
    const trend = weightedMomentum(road, 8);
    if (Math.abs(trend) > 0.01) return trend > 0 ? "莊" : "閒";
    return last ?? ((Number(input.round ?? 0) % 2 === 0) ? "莊" : "閒");
  }
  if (provider === "gemini") {
    if (last && alternationRate(road, 6) >= 0.67) return inverseSide(last);
    const structure = distributionScore(road, 10);
    if (structure !== 0) return structure > 0 ? "莊" : "閒";
    return last ? inverseSide(last) : "莊";
  }
  if (provider === "grok") {
    const fast = weightedMomentum(road, 4);
    if (Math.abs(fast) > 0.01) return fast > 0 ? "莊" : "閒";
    return last ?? "閒";
  }
  // Meta is intentionally more sensitive to correction / mean-reversion conditions.
  const balance = distributionScore(road, 12);
  if (Math.abs(balance) >= 2) return balance > 0 ? "閒" : "莊";
  return last ? inverseSide(last) : ((Number(input.round ?? 0) % 2 === 0) ? "閒" : "莊");
}

function decideSide(score: number, provider: Provider, input: AnalysisInput, road: string[]): AiSide {
  if (Math.abs(score) < 0.55) return providerTieBreak(provider, input, road);
  return score > 0 ? "莊" : "閒";
}

function confidenceFromScore(score: number, base = 56) {
  return clamp(Math.round(base + Math.min(29, Math.abs(score) * 3.6)), 54, 88);
}

function sideWord(side: AiSide) {
  return side === "莊" ? "莊方" : "閒方";
}

function inverseSide(side: AiSide): AiSide {
  return side === "莊" ? "閒" : "莊";
}

function chatgptAnalysis(input: AnalysisInput): ProviderResult {
  const road = cleanRoad(input.results);
  const recent = road.slice(-12);
  const streak = currentStreak(road);
  const alt = alternationRate(road, 10);
  const momentum = weightedMomentum(road, 12);
  const continuation = streak.length >= 2 ? sideValue(streak.side) * Math.min(2.0, streak.length * 0.5) : 0;
  const alternatingBias = alt >= 0.78 && road.length >= 2 ? -sideValue(road.at(-1) || "") * 0.8 : 0;
  const score = momentum * 0.34 + continuation + alternatingBias;
  const side = decideSide(score, "chatgpt", input, road);
  const confidence = confidenceFromScore(score, 57);
  const templates = [
    `近${Math.min(12, recent.length)}局的節奏重心偏向${sideWord(side)}，連續段仍有延伸空間，本局推薦${side}。`,
    `近期走勢的連續性高於反向訊號，${sideWord(side)}在最近一段較穩，本局看${side}。`,
    `${streak.length >= 2 ? `目前形成${streak.side}${streak.length}連，` : "目前以短段切換為主，"}${sideWord(side)}的延續條件較完整，本局偏${side}。`,
    `最近牌路的節奏逐步往${sideWord(side)}靠攏，短線轉折還不足以改變主方向，本局推薦${side}。`,
    `從最近幾段的銜接來看，${sideWord(side)}延續性略勝一籌，本局先看${side}。`,
    `近期節奏出現明顯重心，${sideWord(side)}的連續表現較完整，本局偏向${side}。`,
  ];
  return { provider: "chatgpt", side, confidence, summary: templates[variantIndex(input, "chatgpt", templates.length)] };
}

function geminiAnalysis(input: AnalysisInput): ProviderResult {
  const road = cleanRoad(input.results);
  const alt6 = alternationRate(road, 6);
  const alt10 = alternationRate(road, 10);
  const streak = currentStreak(road);
  const last = road.at(-1);
  let score = (1 - alt6) * distributionScore(road, 14) * 0.18;
  if (last && alt6 >= 0.72) score += -sideValue(last) * 1.6;
  if (streak.length === 2 || streak.length === 3) score += sideValue(streak.side) * 0.85;
  if (streak.length >= 5) score += -sideValue(streak.side) * 0.5;
  if (alt10 > alt6 + 0.18 && last) score += -sideValue(last) * 0.45;
  const patternText = String(input.pattern || "");
  if (/單跳|雙跳|跳/.test(patternText) && last) score += -sideValue(last) * 0.35;
  const side = decideSide(score, "gemini", input, road);
  const confidence = confidenceFromScore(score, 55);
  const templates = [
    `從路型結構看，近期由${alt6 > 0.65 ? "交替" : "連續"}段主導，${sideWord(side)}的型態一致性較高，本局偏${side}。`,
    `比較前後兩段牌路後，${sideWord(side)}的結構較完整，目前轉折訊號仍不足，本局推薦${side}。`,
    `目前短龍與切換節奏較偏${sideWord(side)}，另一側的結構尚未成形，本局看${side}。`,
    `牌型變化顯示${sideWord(side)}的路型較順，近期反向切換幅度偏弱，本局推薦${side}。`,
    `從交替率與連續段的變化判斷，${sideWord(side)}目前結構較有利，本局偏${side}。`,
    `近期路型的轉折位置較支持${sideWord(side)}，另一側尚未形成完整接續，本局看${side}。`,
  ];
  return { provider: "gemini", side, confidence, summary: templates[variantIndex(input, "gemini", templates.length, 17)] };
}

function grokAnalysis(input: AnalysisInput): ProviderResult {
  const road = cleanRoad(input.results);
  const fast = weightedMomentum(road, 5);
  const ultraFast = weightedMomentum(road, 3);
  const streak = currentStreak(road);
  const last = road.at(-1);
  let score = fast * 0.68 + ultraFast * 0.36;
  if (streak.length >= 2) score += sideValue(streak.side) * Math.min(1.4, streak.length * 0.42);
  if (alternationRate(road, 5) >= 0.8 && last) score += -sideValue(last) * 0.55;
  const side = decideSide(score, "grok", input, road);
  const confidence = confidenceFromScore(score, 58);
  const templates = [
    `近5局的短線動能明顯偏${sideWord(side)}，最新轉折還沒把力度打掉，本局推薦${side}。`,
    `最近3到5局的推進速度由${sideWord(side)}佔優，短線節奏仍支持${side}。`,
    `最新一段的動能重心落在${sideWord(side)}，反向力度目前較弱，本局看${side}。`,
    `短線變化目前由${sideWord(side)}掌握，最近幾局仍維持有效推進，本局推薦${side}。`,
    `把最近幾局單獨拉出來看，${sideWord(side)}的即時動能較強，本局偏${side}。`,
    `近期快速節奏偏向${sideWord(side)}，最新局勢尚未出現足夠反向力道，本局看${side}。`,
  ];
  return { provider: "grok", side, confidence, summary: templates[variantIndex(input, "grok", templates.length, 29)] };
}

function metaAnalysis(input: AnalysisInput): ProviderResult {
  const road = cleanRoad(input.results);
  const longDist = distributionScore(road, 18);
  const shortDist = distributionScore(road, 8);
  const streak = currentStreak(road);
  const imbalance = Math.abs(longDist);
  // Meta deliberately emphasizes balance / correction more than the other three models.
  let score = -longDist * 0.20 - shortDist * 0.28;
  if (imbalance <= 2) score += shortDist * 0.12;
  if (streak.length >= 4) score += -sideValue(streak.side) * 1.3;
  else if (streak.length === 2) score += sideValue(streak.side) * 0.2;
  const side = decideSide(score, "meta", input, road);
  const confidence = confidenceFromScore(score, 54);
  const templates = [
    `從近期莊閒分布看，${sideWord(side)}的平衡與回補條件較有利，本局推薦${side}。`,
    `目前序列呈現${imbalance >= 5 ? "較明顯的比例失衡" : "輕度比例偏移"}，綜合回補條件後偏向${side}。`,
    `${sideWord(side)}在近期分布中的位置較有利，現階段修正空間更支持${side}。`,
    `依最近一段的比例與連續段分布，${sideWord(side)}的平衡條件略優，本局推薦${side}。`,
    `近期莊閒比例出現偏移，從回補與反轉條件判斷，本局較偏${side}。`,
    `從長短區間的分布差異看，${sideWord(side)}目前更符合回補節奏，本局看${side}。`,
  ];
  return { provider: "meta", side, confidence, summary: templates[variantIndex(input, "meta", templates.length, 43)] };
}

function analyzeOne(provider: Provider, input: AnalysisInput): ProviderResult {
  if (provider === "chatgpt") return chatgptAnalysis(input);
  if (provider === "gemini") return geminiAnalysis(input);
  if (provider === "grok") return grokAnalysis(input);
  return metaAnalysis(input);
}

function combinedAnalysis(input: AnalysisInput): AiAnalysisResult {
  const providers: Provider[] = ["chatgpt", "gemini", "grok", "meta"];
  const results = providers.map((provider) => analyzeOne(provider, input));
  const banker = results.filter((x) => x.side === "莊");
  const player = results.filter((x) => x.side === "閒");
  let side: AiSide;
  if (banker.length !== player.length) {
    side = banker.length > player.length ? "莊" : "閒";
  } else {
    const bWeight = banker.reduce((sum, x) => sum + x.confidence, 0);
    const pWeight = player.reduce((sum, x) => sum + x.confidence, 0);
    side = bWeight === pWeight ? providerTieBreak("chatgpt", input, cleanRoad(input.results)) : bWeight > pWeight ? "莊" : "閒";
  }
  const winners = results.filter((x) => x.side === side);
  const confidence = clamp(Math.round(winners.reduce((sum, x) => sum + x.confidence, 0) / Math.max(1, winners.length)), 55, 89);
  const voteLine = results.map((x) => `${PROVIDER_LABEL[x.provider]}：${x.side}`).join("｜");
  const templates = [
    `四組判斷整合後偏${side}，共識${winners.length}/4。${voteLine}。`,
    `綜合四種牌路角度，本局以${side}為主，共識${winners.length}/4。${voteLine}。`,
    `整體訊號最後集中在${sideWord(side)}，四項結果共識${winners.length}/4。${voteLine}。`,
  ];
  return {
    provider: "combined",
    side,
    confidence,
    summary: templates[variantIndex(input, "combined", templates.length, 71)],
    availableProviders: providers.map((x) => PROVIDER_LABEL[x]),
    unavailableProviders: [],
  };
}

export async function runAiAnalysis(input: AnalysisInput): Promise<AiAnalysisResult> {
  const session = await loadTrackerSession(input.sessionId);
  if (!session) throw new Error("session_expired");
  if (input.provider === "combined") return combinedAnalysis(input);
  return analyzeOne(input.provider, input);
}

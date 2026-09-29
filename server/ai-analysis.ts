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

function tieBreak(input: AnalysisInput, road: string[]): AiSide {
  const local = Number(input.localScoreBanker ?? 0) - Number(input.localScorePlayer ?? 0);
  if (Math.abs(local) > 0.01) return local > 0 ? "莊" : "閒";
  const last = road.at(-1);
  if (last === "莊" || last === "閒") return last;
  return (Number(input.round ?? 0) % 2 === 0) ? "莊" : "閒";
}

function decideSide(score: number, input: AnalysisInput, road: string[]): AiSide {
  if (Math.abs(score) < 0.18) return tieBreak(input, road);
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
  const continuation = streak.length >= 2 ? sideValue(streak.side) * Math.min(2.3, streak.length * 0.55) : 0;
  const alternatingBias = alt >= 0.72 && road.length >= 2 ? -sideValue(road.at(-1) || "") * 1.15 : 0;
  const score = momentum * 0.42 + continuation + alternatingBias;
  const side = decideSide(score, input, road);
  const confidence = confidenceFromScore(score, 57);
  const templates = [
    `近${Math.min(12, recent.length)}局節奏以${sideWord(side)}延續較完整，短線轉折尚未破壞主方向，本局偏${side}。`,
    `近期序列的連續性高於反向訊號，${sideWord(side)}在最近一段的節奏較穩，本局推薦${side}。`,
    `${streak.length >= 2 ? `目前出現${streak.side}${streak.length}連，` : "近期走勢以短段切換為主，"}${sideWord(side)}的延續條件較明顯，本局看${side}。`,
    `最近牌路的重心逐步往${sideWord(side)}移動，交替訊號不足以扭轉當前節奏，本局推薦${side}。`,
  ];
  return { provider: "chatgpt", side, confidence, summary: templates[variantIndex(input, "chatgpt", templates.length)] };
}

function geminiAnalysis(input: AnalysisInput): ProviderResult {
  const road = cleanRoad(input.results);
  const alt6 = alternationRate(road, 6);
  const alt10 = alternationRate(road, 10);
  const streak = currentStreak(road);
  const structure = distributionScore(road, 14) * 0.28;
  const transition = (alt10 - alt6) * 3.1;
  let score = structure;
  if (streak.length >= 3) score += sideValue(streak.side) * 1.35;
  if (alt6 >= 0.8 && road.length >= 2) score += -sideValue(road.at(-1) || "") * 1.4;
  if (transition > 0.35) score += -sideValue(road.at(-1) || "") * 0.55;
  const patternText = String(input.pattern || "");
  if (/莊/.test(patternText)) score += 0.35;
  if (/閒/.test(patternText)) score -= 0.35;
  const side = decideSide(score, input, road);
  const confidence = confidenceFromScore(score, 55);
  const templates = [
    `從路型結構看，近期由${alt6 > 0.65 ? "交替" : "連續"}段主導，${sideWord(side)}的型態一致性較高，本局偏${side}。`,
    `比較前後兩段牌路後，${sideWord(side)}的結構延續較完整，轉折訊號仍未形成，本局推薦${side}。`,
    `目前路型的短龍與切換節奏偏向${sideWord(side)}，另一側回轉條件較弱，本局看${side}。`,
    `牌型變化顯示${sideWord(side)}仍保有結構優勢，近期轉向幅度不足，本局推薦${side}。`,
  ];
  return { provider: "gemini", side, confidence, summary: templates[variantIndex(input, "gemini", templates.length, 17)] };
}

function grokAnalysis(input: AnalysisInput): ProviderResult {
  const road = cleanRoad(input.results);
  const fast = weightedMomentum(road, 5);
  const short = weightedMomentum(road, 7);
  const streak = currentStreak(road);
  const last = road.at(-1);
  let score = fast * 0.72 + short * 0.24;
  if (streak.length >= 2) score += sideValue(streak.side) * Math.min(1.7, streak.length * 0.48);
  if (alternationRate(road, 5) >= 0.75 && last) score += -sideValue(last) * 0.85;
  const side = decideSide(score, input, road);
  const confidence = confidenceFromScore(score, 58);
  const templates = [
    `近幾局的短線動能明顯偏${sideWord(side)}，最近轉折沒有把力度完全打掉，本局推薦${side}。`,
    `看最近5到7局，${sideWord(side)}的推進速度較快，短線仍佔上風，本局偏${side}。`,
    `最新一段的節奏重心落在${sideWord(side)}，反向訊號雖有出現但力度較弱，本局看${side}。`,
    `短線動能目前由${sideWord(side)}掌握，最近幾局的變化仍支持延續，本局推薦${side}。`,
  ];
  return { provider: "grok", side, confidence, summary: templates[variantIndex(input, "grok", templates.length, 29)] };
}

function metaAnalysis(input: AnalysisInput): ProviderResult {
  const road = cleanRoad(input.results);
  const longDist = distributionScore(road, 18);
  const shortDist = distributionScore(road, 8);
  const streak = currentStreak(road);
  const imbalance = Math.abs(longDist);
  let score = shortDist * 0.38 + longDist * 0.16;
  // Meta focuses more on imbalance / correction: very one-sided long runs get a measured counter-weight.
  if (imbalance >= 6) score += longDist > 0 ? -1.55 : 1.55;
  if (streak.length >= 4) score += streak.side === "莊" ? -0.85 : 0.85;
  if (streak.length === 2 || streak.length === 3) score += sideValue(streak.side) * 0.48;
  const side = decideSide(score, input, road);
  const confidence = confidenceFromScore(score, 54);
  const templates = [
    `從近期莊閒分布看，${sideWord(side)}的比例與回補條件較有利，本局推薦${side}。`,
    `目前序列存在${imbalance >= 5 ? "較明顯的分布失衡" : "輕度比例偏移"}，綜合回補與延續後偏向${side}。`,
    `${sideWord(side)}在近期分布中的位置較有優勢，現階段反向回補壓力較小，本局看${side}。`,
    `依最近一段的比例與連續段分布，${sideWord(side)}條件略優，本局推薦${side}。`,
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
    side = bWeight === pWeight ? tieBreak(input, cleanRoad(input.results)) : bWeight > pWeight ? "莊" : "閒";
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

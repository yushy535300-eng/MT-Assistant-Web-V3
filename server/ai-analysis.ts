import { loadTrackerSession } from "./sessions";

export type AiProvider = "chatgpt" | "gemini" | "grok" | "meta" | "combined";
export type AiSide = "莊" | "閒" | "觀望";

export type AiAnalysisResult = {
  provider: AiProvider;
  side: AiSide;
  confidence: number;
  summary: string;
  availableProviders?: string[];
  unavailableProviders?: string[];
};

type ProviderResult = AiAnalysisResult & { provider: Exclude<AiProvider, "combined"> };

const PROVIDER_LABEL: Record<Exclude<AiProvider, "combined">, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
  meta: "Meta AI",
};

function parseJsonResult(provider: Exclude<AiProvider, "combined">, raw: string): ProviderResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: any = null;
  try {
    data = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { data = JSON.parse(match[0]); } catch {}
    }
  }
  const side: AiSide = data?.side === "莊" || data?.side === "閒" ? data.side : "觀望";
  const confidence = Math.max(0, Math.min(100, Math.round(Number(data?.confidence) || 0)));
  const summary = String(data?.summary || cleaned || "分析完成。")
    .replace(/\s+/g, " ")
    .slice(0, 220);
  return { provider, side, confidence, summary };
}

function promptFor(
  provider: Exclude<AiProvider, "combined">,
  input: {
    tableName?: string;
    dealer?: string;
    round?: number;
    results: string[];
    pattern?: string;
    localScoreBanker?: number;
    localScorePlayer?: number;
  },
) {
  const recent = input.results.slice(-60).join("、") || "無";
  const providerFocus: Record<Exclude<AiProvider, "combined">, string> = {
    chatgpt: "請獨立判讀路勢結構、延續與反轉風險，不要照抄程式既有分數。",
    gemini: "請獨立比較近期與中段牌路的型態變化，重視節奏切換與一致性。",
    grok: "請獨立找出最近幾局最明顯的轉折、衝突訊號與短期偏向。",
    meta: "請獨立從歷史序列的分布、連續段與交替段判斷結構穩定度。",
  };
  return `你是 ${PROVIDER_LABEL[provider]} 的百家樂牌路統計分析模組。${providerFocus[provider]}
只根據提供的歷史牌路做分析，不得聲稱能預知隨機結果，也不得引用其他 AI 的答案。
桌台：${input.tableName || "—"}
荷官：${input.dealer || "—"}
局數：${input.round ?? 0}
目前牌型：${input.pattern || "—"}
最近牌路（最右為最新）：${recent}
程式既有路勢分數（僅供參考，不可直接複製）：莊 ${input.localScoreBanker ?? 0} / 閒 ${input.localScorePlayer ?? 0}
請輸出 JSON，且只能輸出 JSON：{"side":"莊|閒|觀望","confidence":0到100的整數,"summary":"繁體中文，50字以內，說明你自己的判斷依據與主要風險"}`;
}

async function fetchOpenAICompatible(opts: {
  url: string;
  key: string;
  model: string;
  prompt: string;
  provider: Exclude<AiProvider, "combined">;
}): Promise<ProviderResult> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.key}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: "回覆必須是有效 JSON，不要 markdown。" },
        { role: "user", content: opts.prompt },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`${PROVIDER_LABEL[opts.provider]} API ${res.status}`);
  const json: any = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${PROVIDER_LABEL[opts.provider]} 無回覆`);
  return parseJsonResult(opts.provider, String(text));
}

async function callChatGPT(prompt: string): Promise<ProviderResult> {
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("ChatGPT 尚未設定 OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL || "gpt-5.6";
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: "回覆必須是有效 JSON，不要 markdown。" }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ChatGPT API ${res.status}`);
  const json: any = await res.json();
  const text = json?.output_text || json?.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text;
  if (!text) throw new Error("ChatGPT 無回覆");
  return parseJsonResult("chatgpt", String(text));
}

async function callGemini(prompt: string): Promise<ProviderResult> {
  const key = process.env.GEMINI_API_KEY || "";
  if (!key) throw new Error("Gemini 尚未設定 GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}`);
  const json: any = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("");
  if (!text) throw new Error("Gemini 無回覆");
  return parseJsonResult("gemini", String(text));
}

async function callGrok(prompt: string): Promise<ProviderResult> {
  const key = process.env.XAI_API_KEY || "";
  if (!key) throw new Error("Grok 尚未設定 XAI_API_KEY");
  return fetchOpenAICompatible({
    url: "https://api.x.ai/v1/chat/completions",
    key,
    model: process.env.XAI_MODEL || "grok-4.7",
    prompt,
    provider: "grok",
  });
}

function stableRandom01(seed: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h += h << 13;
  h ^= h >>> 7;
  h += h << 3;
  h ^= h >>> 17;
  h += h << 5;
  return (h >>> 0) / 4294967295;
}

async function callMeta(prompt: string): Promise<ProviderResult> {
  // Meta AI intentionally uses a local per-round random recommendation in this build.
  // The full prompt contains table / round / recent-road data, so the result stays
  // stable during the same round and changes naturally when a new round arrives.
  const side: AiSide = stableRandom01(prompt, 17) >= 0.5 ? "莊" : "閒";
  const confidence = 52 + Math.floor(stableRandom01(prompt, 73) * 37); // 52–88
  const summariesBanker = [
    "本局隨機推薦偏莊，信心屬中等區間。",
    "目前隨機結果為莊，下一局會重新產生。",
    "本輪推薦莊，維持到本局資料更新完成。",
  ];
  const summariesPlayer = [
    "本局隨機推薦偏閒，信心屬中等區間。",
    "目前隨機結果為閒，下一局會重新產生。",
    "本輪推薦閒，維持到本局資料更新完成。",
  ];
  const list = side === "莊" ? summariesBanker : summariesPlayer;
  const index = Math.floor(stableRandom01(prompt, 131) * list.length) % list.length;
  return {
    provider: "meta",
    side,
    confidence,
    summary: list[index],
  };
}

const callers = { chatgpt: callChatGPT, gemini: callGemini, grok: callGrok, meta: callMeta } as const;

export async function runAiAnalysis(input: {
  sessionId: string;
  provider: AiProvider;
  tableName?: string;
  dealer?: string;
  round?: number;
  results: string[];
  pattern?: string;
  localScoreBanker?: number;
  localScorePlayer?: number;
}): Promise<AiAnalysisResult> {
  const session = await loadTrackerSession(input.sessionId);
  if (!session) throw new Error("session_expired");
  if (input.provider !== "combined") {
    return callers[input.provider](promptFor(input.provider, input));
  }

  const names = Object.keys(callers) as Array<Exclude<AiProvider, "combined">>;
  const settled = await Promise.allSettled(
    names.map((name) => callers[name](promptFor(name, input))),
  );
  const ok: ProviderResult[] = [];
  const unavailable: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(r.value);
    else unavailable.push(PROVIDER_LABEL[names[i]]);
  });
  if (!ok.length) throw new Error(`AI 綜合無可用模型：${unavailable.join("、")}`);

  const banker = ok.filter((x) => x.side === "莊");
  const player = ok.filter((x) => x.side === "閒");
  let side: AiSide = "觀望";
  let winners: ProviderResult[] = [];
  if (banker.length > player.length) { side = "莊"; winners = banker; }
  else if (player.length > banker.length) { side = "閒"; winners = player; }

  const confidence = winners.length
    ? Math.round(winners.reduce((sum, x) => sum + x.confidence, 0) / winners.length)
    : Math.round(ok.reduce((sum, x) => sum + x.confidence, 0) / ok.length * 0.6);
  const votes = ok.map((x) => `${PROVIDER_LABEL[x.provider]}:${x.side}`).join("｜");
  const reasons = ok
    .map((x) => `${PROVIDER_LABEL[x.provider]}：${x.summary}`)
    .join("；")
    .slice(0, 420);
  const summary = `共識 ${side === "觀望" ? "不足" : `${Math.max(banker.length, player.length)}/${ok.length} 偏${side}`}。${votes}。${reasons}`;
  return {
    provider: "combined",
    side,
    confidence,
    summary,
    availableProviders: ok.map((x) => PROVIDER_LABEL[x.provider]),
    unavailableProviders: unavailable,
  };
}

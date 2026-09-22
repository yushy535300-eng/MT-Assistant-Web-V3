/**
 * 美女直播 (score777) lobby streamers.
 * Lobby HTML is SSR'd at tz02.score777.net; Cloudflare blocks server-side
 * fetches from this environment, so we ship a catalog captured from a live
 * lobby HAR and rewrite avatars to same-origin copies under /mv-hosts/.
 */

export type MvLiveRoom = {
  id: string;
  uid?: string;
  name: string;
  title: string;
  live: boolean;
  avatar: string;
  /** Absolute or path-only room URL when live and enterable. */
  roomUrl?: string;
  /** Empty lobby slot — 「老爺人家還沒好，請期待呦」 */
  comingSoon?: boolean;
};

export const MV_COMING_SOON_MESSAGE = "老爺人家還沒好，請敬請期待";

const AVATAR_LOCAL: Record<string, string> = {
  "69fe0d3d9793a.jpg": "/mv-hosts/69fe0d3d9793a.jpg",
  "6a1d3ce1e6aa9.jpg": "/mv-hosts/6a1d3ce1e6aa9.jpg",
  "69fe0d210ae8a.jpg": "/mv-hosts/69fe0d210ae8a.jpg",
  "69fe0caf8fa97.jpg": "/mv-hosts/69fe0caf8fa97.jpg",
};

function localAvatar(remoteOrFile: string) {
  const file = remoteOrFile.split("/").pop() || "";
  if (AVATAR_LOCAL[file]) return AVATAR_LOCAL[file];
  if (remoteOrFile.startsWith("/mv-hosts/")) return remoteOrFile;
  return remoteOrFile || "";
}

function guessHostName(title: string) {
  const t = String(title || "").trim();
  if (!t) return "直播主";
  const game = t.match(/^([^\s\d]{1,8})\s+(?:\d{1,2}\/\d{1,2}\s+)?GAME\s*TIME/i);
  if (game?.[1]) return game[1];
  const follow = t.match(/跟著([^\s~，。！!]{1,8})走/);
  if (follow?.[1]) return follow[1];
  const leading = t.match(/^([\u4e00-\u9fffA-Za-z]{1,8})(?:\s|$)/);
  if (leading?.[1] && !/^\d/.test(leading[1])) return leading[1];
  if (/法甲|英超|西甲|德甲|義甲|NBA|賽事|vs/i.test(t)) return "賽事直播";
  return t.slice(0, 8);
}

/**
 * Fallback catalog from tz02.score777.net HAR (2026-09-22).
 * Offline hosts still appear on the homepage; empty slot = 老爺敬請期待.
 */
export const MV_LIVE_ROOM_CATALOG: MvLiveRoom[] = [
  {
    id: "MV-YUNXI",
    name: "沄曦",
    title: "跟著沄曦走 荷包一直有 ~",
    live: false,
    avatar: localAvatar("6a1d3ce1e6aa9.jpg"),
  },
  {
    id: "MV-LAOYE",
    name: "老爺",
    title: MV_COMING_SOON_MESSAGE,
    live: false,
    avatar: "",
    comingSoon: true,
  },
  {
    id: "MV-1161",
    uid: "1161",
    name: "雙雙",
    title: "雙雙 GAME TIME 跟著雙雙一起贏大錢~",
    live: false,
    avatar: localAvatar("69fe0d3d9793a.jpg"),
  },
  {
    id: "MV-QIANQIAN",
    name: "淺淺",
    title: "淺淺 9/21 GAME TIME",
    live: false,
    avatar: localAvatar("69fe0d210ae8a.jpg"),
  },
  {
    id: "MV-MATCH",
    name: "賽事直播",
    title: "9/21 2:45 法甲 馬賽vs巴黎聖爾曼",
    live: false,
    avatar: localAvatar("69fe0caf8fa97.jpg"),
  },
];

/** Parse score777 lobby HTML into room cards (includes offline + 老爺 slot). */
export function parseMvLobbyHtml(html: string): MvLiveRoom[] {
  const rooms: MvLiveRoom[] = [];
  const liRe = /<li>\s*<a[\s\S]*?<\/li>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  let comingSoonAdded = false;
  while ((m = liRe.exec(html))) {
    const block = m[0];
    const title = (block.match(/logo-txt">([^<]*)<\/span>/i)?.[1] || "").trim();
    const img = (block.match(/h-anchor-cover-img"\s+src="([^"]*)"/i)?.[1] || "").trim();
    const hrefRaw = (block.match(/href="([^"]+)"/i)?.[1] || "").replace(/&amp;/g, "&");
    const isOfflineClick = /onclick\s*=\s*["']offline\s*\(/i.test(block);
    const isLive =
      /livegif\.gif/i.test(block) &&
      !isOfflineClick &&
      !/offline\s*\(/i.test(block);

    // Empty cover + empty title + offline() → 老爺敬請期待 slot (HAR).
    if (!title && !img) {
      if (isOfflineClick && !comingSoonAdded) {
        rooms.push({
          id: "MV-LAOYE",
          name: "老爺",
          title: MV_COMING_SOON_MESSAGE,
          live: false,
          avatar: "",
          comingSoon: true,
        });
        comingSoonAdded = true;
        idx += 1;
      }
      continue;
    }

    const uid = hrefRaw.match(/[?&]uid=([^&]+)/i)?.[1];
    const name = guessHostName(title);
    rooms.push({
      id: uid ? `MV-${uid}` : `MV-H${idx + 1}`,
      uid,
      name,
      title: title || name,
      live: isLive,
      avatar: localAvatar(img),
      roomUrl:
        hrefRaw && !isOfflineClick && !/offline/i.test(hrefRaw)
          ? hrefRaw
          : undefined,
    });
    idx += 1;
  }
  return rooms;
}

export function mvRoomsOrFallback(parsed: MvLiveRoom[]) {
  return parsed.length ? parsed : MV_LIVE_ROOM_CATALOG;
}

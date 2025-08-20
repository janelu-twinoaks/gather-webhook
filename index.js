import { Game } from "@gathertown/gather-game-client";
import fetch from "node-fetch";
import WebSocket from "ws";

global.WebSocket = WebSocket; // 讓 SDK 能在 Node.js 使用 WebSocket

const API_KEY = process.env.GATHER_API_KEY;
const SPACE_ID = process.env.SPACE_ID; // 格式: "spaceId/mapId"
const PIPEDREAM_WEBHOOK_URL = process.env.PIPEDREAM_WEBHOOK_URL;

// 初始化 Gather Town 連線
const game = new Game(SPACE_ID, () => Promise.resolve({ apiKey: API_KEY }));
game.connect();

// 監控連線狀態
game.subscribeToConnection((connected) => {
  console.log(connected ? "✅ Connected to Gather Town!" : "❌ Disconnected from Gather Town!");
});

// 玩家進入
game.subscribeToEvent("playerJoins", async (data) => {
  await sendWebhook("playerJoins", data.playerId);
});

// 玩家離開
game.subscribeToEvent("playerExits", async (data) => {
  await sendWebhook("playerExits", data.playerId);
});

// 封裝發送到 Pipedream
async function sendWebhook(event, userId) {
  const payload = { userId, event, timestamp: new Date().toISOString() };
  console.log("📤 Sending to Pipedream:", payload);

  try {
    const res = await fetch(PIPEDREAM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("❌ Failed to send webhook:", res.status, await res.text());
  } catch (err) {
    console.error("❌ Error sending webhook:", err);
  }
}

import { Game } from "@gathertown/gather-game-client";
import fetch from "node-fetch";

const API_KEY = process.env.GATHER_API_KEY;
const SPACE_ID = process.env.SPACE_ID; // 格式: "CVRgwifFLfhtyxjJ/test"
const PIPEDREAM_WEBHOOK_URL = process.env.PIPEDREAM_WEBHOOK_URL;

// 初始化遊戲物件，SDK 會自動處理 WebSocket
const game = new Game(SPACE_ID, () => Promise.resolve({ apiKey: API_KEY }));

// 連線到 Gather Town
game.connect();

// 監聽連線狀態
game.subscribeToConnection((connected) => {
  console.log(connected ? "✅ Connected to Gather Town!" : "❌ Disconnected from Gather Town!");
});

// 監聽玩家進入
game.subscribeToEvent("playerJoins", async (data) => {
  console.log("playerJoins event data:", data);
  const userId = data.userId || data.playerId || "unknown"; // 兼容不同 SDK 版本
  await sendWebhook("playerJoins", userId);
});

// 監聽玩家離開
game.subscribeToEvent("playerExits", async (data) => {
  console.log("playerExits event data:", data);
  const userId = data.userId || data.playerId || "unknown";
  await sendWebhook("playerExits", userId);
});

// 封裝 webhook 發送
async function sendWebhook(event, userId) {
  const payload = {
    userId,
    event,
    timestamp: new Date().toISOString(),
  };

  console.log("📤 Sending to Pipedream:", payload);

  try {
    const res = await fetch(PIPEDREAM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error("❌ Failed to send webhook:", res.status, await res.text());
    }
  } catch (err) {
    console.error("❌ Error sending webhook:", err);
  }
}

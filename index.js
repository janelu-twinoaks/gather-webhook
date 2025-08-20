import { Game } from "@gathertown/gather-game-client";
import fetch from "node-fetch";
import WebSocket from "ws"; // <- 新增

// 告訴 Gather SDK 用這個 ws
global.WebSocket = WebSocket;

const API_KEY = process.env.GATHER_API_KEY;
const SPACE_ID = process.env.SPACE_ID;
const PIPEDREAM_WEBHOOK_URL = process.env.PIPEDREAM_WEBHOOK_URL;

// 初始化遊戲物件
const game = new Game(SPACE_ID, () => Promise.resolve({ apiKey: API_KEY }));

game.connect();

game.subscribeToConnection((connected) => {
  console.log(connected ? "✅ Connected to Gather Town!" : "❌ Disconnected from Gather Town!");
});

game.subscribeToEvent("playerJoins", async (data) => {
  const userId = data.userId || data.playerId || "unknown";
  await sendWebhook("playerJoins", userId);
});

game.subscribeToEvent("playerExits", async (data) => {
  const userId = data.userId || data.playerId || "unknown";
  await sendWebhook("playerExits", userId);
});

async function sendWebhook(event, userId) {
  const payload = { userId, event, timestamp: new Date().toISOString() };
  console.log("📤 Sending to Pipedream:", payload);
  try {
    const res = await fetch(PIPEDREAM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("❌ Failed:", res.status, await res.text());
  } catch (err) {
    console.error("❌ Error sending webhook:", err);
  }
}

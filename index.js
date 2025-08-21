import { performance } from 'perf_hooks';
global.performance = performance;

import express from "express";
import fetch from "node-fetch";
import { Game } from "@gathertown/gather-game-client";
import AbortController from "abort-controller";
global.AbortController = AbortController;
import WebSocket from "ws";
global.WebSocket = WebSocket;


// 🚀 Express 假 server，Render 需要有 port 綁定
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => {
  res.send("Gather Webhook Service is running 🚀");
});
app.listen(PORT, () => {
  console.log(`✅ Express server running on port ${PORT}`);
});

// Gather 連線
const SPACE_ID = process.env.SPACE_ID;
const API_KEY = process.env.API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const game = new Game(SPACE_ID, () => Promise.resolve({ apiKey: API_KEY }));
game.connect();
game.subscribeToConnection((connected) => {
  if (connected) {
    console.log("✅ Connected to Gather Town!");
  }
});


// Map 存 encId 對應玩家資訊
const players = new Map();

const game = new Game(SPACE_ID, () => Promise.resolve({ apiKey: API_KEY }));
game.connect();

// 連線後抓目前所有玩家資訊
game.subscribeToConnection(async (connected) => {
  if (connected) {
    console.log("✅ Connected to Gather Town!");
    try {
      const allPlayers = await game.getPlayers();
      for (const [encId, playerInfo] of Object.entries(allPlayers)) {
        players.set(Number(encId), playerInfo);
      }
      console.log("✅ Fetched all players info:", players);
    } catch (err) {
      console.error("❌ Failed to fetch players:", err);
    }
  }
});

// 🔄 Webhook 發送 function
async function sendWebhook(event, userId, name) {
  const payload = {
    userId,
    name,
    event,
    timestamp: new Date().toISOString(),
  };

  console.log("📤 Sending to Pipedream:", payload);

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("❌ Failed to send webhook:", err);
  }
}

// 👥 Player Joins
game.subscribeToEvent("playerJoins", async (data) => {
  console.log("📥 playerJoins raw data:", JSON.stringify(data, null, 2));
  const encId = data?.playerJoins?.encId;
  if (!encId) return;

  // 等待幾毫秒再抓，確保玩家資料已更新
  await new Promise((r) => setTimeout(r, 200));
  const player = players.get(encId) || (await game.getPlayer(encId));
  players.set(encId, player);

  const userId = player?.userId || "unknown";
  const name = player?.name || "unknown";

  console.log("✅ Resolved player:", { encId, userId, name });
  await sendWebhook("playerJoins", userId, name);
});

// 👋 Player Exits
game.subscribeToEvent("playerExits", async (data) => {
  console.log("📥 playerExits raw data:", JSON.stringify(data, null, 2));
  const encId = data?.playerExits?.encId;
  if (!encId) return;

  const player = players.get(encId);
  const userId = player?.userId || "unknown";
  const name = player?.name || "unknown";

  console.log("✅ Resolved player:", { encId, userId, name });
  await sendWebhook("playerExits", userId, name);

  // 移除 Map
  players.delete(encId);
});


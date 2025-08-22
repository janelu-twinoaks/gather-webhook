import { performance } from "perf_hooks";
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

// Gather config
const SPACE_ID = process.env.SPACE_ID;
const API_KEY = process.env.API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

let game;

// 建立連線 function（支援自動重連）
function connectGather() {
  console.log("🔌 Connecting to Gather Town...");

  game = new Game(SPACE_ID, () => Promise.resolve({ apiKey: API_KEY }));
  game.connect();

  game.subscribeToConnection((connected) => {
    if (connected) {
      console.log("✅ Connected to Gather Town!");
    } else {
      console.log("❌ Disconnected from Gather Town, retrying in 5s...");
      setTimeout(connectGather, 5000);
    }
  });

  // 👥 Player Joins
  game.subscribeToEvent("playerJoins", async (data) => {
    const encId = data?.playerJoins?.encId;
    console.log("📥 playerJoins raw data:", JSON.stringify(data, null, 2));
    console.log("✅ Resolved player encId:", encId);
    await sendWebhook("playerJoins", encId);
  });

  // 👋 Player Exits
  game.subscribeToEvent("playerExits", async (data) => {
    const encId = data?.playerExits?.encId;
    console.log("📥 playerExits raw data:", JSON.stringify(data, null, 2));
    console.log("✅ Resolved player encId:", encId);
    await sendWebhook("playerExits", encId);
  });

  // ❤️ Heartbeat，每 20 秒發一次，避免 idle 斷線
  setInterval(() => {
    if (game.connected) {
      console.log("💓 Sending heartbeat to Gather...");
      game.spaceUpdates([], true);
    }
  }, 20000);
}

// 🔄 Webhook 發送 function，只傳 encId
async function sendWebhook(event, encId) {
  const payload = {
    encId,
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

// 🚀 啟動連線
connectGather();

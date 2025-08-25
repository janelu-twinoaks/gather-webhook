import { performance } from "perf_hooks"; 
global.performance = performance;

import express from "express";
import fs from "fs";
import { Game } from "@gathertown/gather-game-client";
import AbortController from "abort-controller";
global.AbortController = AbortController;
import WebSocket from "ws";
global.WebSocket = WebSocket;

// 🚀 Express server
const app = express();
const PORT = process.env.PORT || 3000;

// 暫存 JSON 檔
const EVENTS_FILE = "./events.json";
// 安全 token
const EVENTS_TOKEN = process.env.EVENTS_TOKEN || "my_secret_token";

// 確保 JSON 檔存在
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, "[]", "utf8");

// 新增事件到 JSON
function saveEvent(event) {
  const data = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  data.push(event);
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// ── Web endpoints ──

// 首頁
app.get("/", (req, res) => {
  res.send("Gather Webhook Service is running 🚀");
});

// 🔒 安全版 /events endpoint
app.get("/events", (req, res) => {
  const token = req.query.token; // 從 ?token=xxx 取得
  if (token !== EVENTS_TOKEN) {
    return res.status(403).send("❌ Forbidden: Invalid token");
  }

  try {
    const data = fs.readFileSync(EVENTS_FILE, "utf8");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (err) {
    res.status(500).send("❌ Error reading events.json");
  }
});

// 啟動 server
app.listen(PORT, () => {
  console.log(`✅ Express server running on port ${PORT}`);
});

// ── Gather config ──
const SPACE_ID = process.env.SPACE_ID;
const API_KEY = process.env.API_KEY;

let game;

// 連線 Gather
function connectGather() {
  console.log("🔌 Connecting to Gather Town...");
  game = new Game(SPACE_ID, () => Promise.resolve({ apiKey: API_KEY }));
  game.connect();

  game.subscribeToConnection((connected) => {
    if (connected) {
      console.log("✅ Connected to Gather Town!");
    } else {
      console.log("❌ Disconnected, retrying in 5s...");
      setTimeout(connectGather, 5000);
    }
  });

  // Player Joins
  game.subscribeToEvent("playerJoins", (data) => {
    const encId = data?.playerJoins?.encId;
    const name = data?.playerJoins?.name || "Unknown"; 
    const timestamp = new Date().toISOString();
    saveEvent({ encId, event: "playerJoins", timestamp, name });
    console.log("📥 playerJoins saved:", encId, name, timestamp);
  });

  // Player Exits
  game.subscribeToEvent("playerExits", (data) => {
    const encId = data?.playerExits?.encId;
    const name = data?.playerExits?.name || "Unknown";
    const timestamp = new Date().toISOString();
    saveEvent({ encId, event: "playerExits", timestamp, name });
    console.log("📥 playerExits saved:", encId, name, timestamp);
  });

  // Heartbeat
  setInterval(() => {
    if (game.connected) game.spaceUpdates([], true);
  }, 20000);
}

connectGather();

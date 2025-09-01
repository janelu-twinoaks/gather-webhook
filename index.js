import { performance } from "perf_hooks"; 
global.performance = performance;

import express from "express";
import fs from "fs";
import { Game } from "@gathertown/gather-game-client";
import AbortController from "abort-controller";
global.AbortController = AbortController;
import WebSocket from "ws";
global.WebSocket = WebSocket;

import { google } from "googleapis";
import schedule from "node-schedule";

// 🚀 Express server
const app = express();
const PORT = process.env.PORT || 3000;

// 暫存 JSON 檔
const EVENTS_FILE = "./events.json";
// 安全 token
const EVENTS_TOKEN = process.env.EVENTS_TOKEN || "my_secret_token";

// Google Sheet config
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // Google Sheet ID
const SHEET_NAME = process.env.SHEET_NAME || "辦公室進出紀錄";

// 確保 JSON 檔存在
if (!fs.existsSync(EVENTS_FILE)) fs.writeFileSync(EVENTS_FILE, "[]", "utf8");

// Google Sheets API 認證
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// ── Helpers ──

// 新增事件到 JSON（不存 name）
function saveEvent(event) {
  const data = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  // 改成用 playerId 當主 key
  const { playerId, event: evt, timestamp } = event;
  data.push({ playerId, event: evt, timestamp });
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(data, null, 2), "utf8");
}


// 寫入 Google Sheet（只寫三個欄位）
async function appendEventsToSheet() {
  const data = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  if (!data.length) return console.log("📄 No events to append");

  const values = data.map((e) => [e.playerId, e.event, e.timestamp]);

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:C`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    console.log(`✅ ${values.length} events appended to Google Sheet`);
    // 清空 JSON
    fs.writeFileSync(EVENTS_FILE, "[]", "utf8");
  } catch (err) {
    console.error("❌ Failed to append events:", err);
  }
}

// ── Web endpoints ──

// 首頁
app.get("/", (req, res) => {
  res.send("Gather Webhook Service is running 🚀");
});

// 🔒 安全版 /events endpoint
app.get("/events", (req, res) => {
  const token = req.query.token;
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

  // ── 玩家狀態暫存 ──
  const activePlayers = new Set();
  
  // Player Joins
  game.subscribeToEvent("playerJoins", (data) => {
    try {
      console.log("DEBUG playerJoins event:", data);
  
      const encId = data?.playerJoins?.encId;
      const timestamp = new Date().toISOString();
  
      if (!activePlayers.has(encId)) {
        activePlayers.add(encId);
  
        // 先預設名字為 Unknown，避免直接讀取未初始化的 state
        let playerId = encId;
        let name = "Unknown";
  
        // 嘗試拿到玩家資訊（可能還沒同步完成，所以要先檢查）
        if (game.state?.players?.[encId]) {
          const playerInfo = game.state.players[encId];
          playerId = playerInfo.id || encId;
          name = playerInfo.name || "Unknown";
        }
  
        saveEvent({ playerId, event: "playerJoins", timestamp });
        console.log("📥 playerJoins saved:", playerId, timestamp, name);
      } else {
        console.log("⚠️ Duplicate join ignored for:", encId);
      }
    } catch (err) {
      console.error("error occurred in handler for playerJoins:", err);
    }
  });

  // Player Exits
  game.subscribeToEvent("playerExits", (data) => {
    console.log("DEBUG playerExits event:", data);
  
    const encId = data?.playerExits?.encId;
    const timestamp = new Date().toISOString();
  
    if (!activePlayers.has(encId)) {
      activePlayers.add(encId);
  
      // 嘗試拿到玩家資訊
      const playerInfo = game.state.players[encId];
      const playerId = playerInfo?.id || encId;
      const name = playerInfo?.name || "Unknown";
  
      saveEvent({ playerId, event: "playerExits", timestamp });
      console.log("📥 playerExits saved:", playerId, timestamp, name);
    } else {
      console.log("⚠️ Duplicate exit ignored for:", encId);
    }
  });

  // Heartbeat
  setInterval(() => {
    if (game.connected) game.spaceUpdates([], true);
  }, 20000);
}

connectGather();

// ── 定時整理 JSON → Google Sheet ──

// 每 5 分鐘整理一次
schedule.scheduleJob("*/5 * * * *", () => {
  console.log("⏱ Running scheduled job: append events to Google Sheet");
  appendEventsToSheet().catch(console.error);
});

// 每次程式啟動時，也整理一次，確保之前暫存的資料先寫入
appendEventsToSheet().catch(console.error);

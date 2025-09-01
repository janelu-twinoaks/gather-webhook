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

// 新增事件到 JSON
function saveEvent(event) {
  const data = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  const { playerId, username, event: evt, timestamp } = event;
  data.push({ playerId, username, event: evt, timestamp });
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

// 寫入 Google Sheet
async function appendEventsToSheet() {
  const data = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
  if (!data.length) return console.log("📄 No events to append");

  const values = data.map((e) => [e.playerId, e.username, e.event, e.timestamp]);

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:D`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    console.log(`✅ ${values.length} events appended to Google Sheet`);
    fs.writeFileSync(EVENTS_FILE, "[]", "utf8"); // 清空 JSON
  } catch (err) {
    console.error("❌ Failed to append events:", err);
  }
}

// ── Web endpoints ──
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

app.listen(PORT, () => {
  console.log(`✅ Express server running on port ${PORT}`);
});

// ── Gather config ──
const SPACE_ID = process.env.SPACE_ID;
const API_KEY = process.env.API_KEY;

let game;

// 等待玩家資料
function waitForPlayerInfo(encId, timeout = 5000, interval = 100) {
  return new Promise((resolve) => {
    let elapsed = 0;
    const timer = setInterval(() => {
      const info = game?.state?.players?.[encId];
      if (info) {
        clearInterval(timer);
        resolve(info);
      } else if ((elapsed += interval) >= timeout) {
        clearInterval(timer);
        resolve(null);
      }
    }, interval);
  });
}

const activeEncIds = new Set();
const encIdToMeta = new Map();
let handlersRegistered = false;

// 暫存玩家資料
const playersCache = {};

function registerHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  // Player Joins
  game.subscribeToEvent("playerJoins", (data) => {
    const encId = data.playerJoins.encId;
    const timestamp = new Date().toISOString();
  
    // 初始 username unknown
    playersCache[encId] = { name: "unknown", joinedAt: timestamp };
  
    saveEvent({ playerId: encId, username: "unknown", event: "playerJoins", timestamp });
    console.log(`📥 playerJoins saved: ${encId} ${timestamp} unknown`);
  });
  
  // Player Sets Name
  game.subscribeToEvent("playerSetsName", (data) => {
    const { encId, name } = data.playerSetsName;
    const timestamp = new Date().toISOString();
  
    // 更新 cache
    if (playersCache[encId]) {
      playersCache[encId].name = name;
    } else {
      playersCache[encId] = { name, joinedAt: timestamp };
    }
  
    // 存事件，event 還是 playerJoins，但 username 改成玩家名字
    saveEvent({ playerId: encId, username: name, event: "playerJoins", timestamp });
    console.log(`✅ Name updated for ${encId}: ${name}`);
  });
  
  // Player Exits
  game.subscribeToEvent("playerExits", async (data) => {
    try {
      const encId = data?.playerExits?.encId;
      const timestamp = new Date().toISOString();
      console.log("DEBUG playerExits event:", data);

      if (!activeEncIds.has(encId)) {
        console.log("⚠️ Exit ignored (not active):", encId);
        return;
      }

      let meta = encIdToMeta.get(encId);
      if (!meta) {
        const info = game?.state?.players?.[encId] || (await waitForPlayerInfo(encId, 500));
        meta = { id: info?.id ?? encId, name: info?.name ?? "Unknown" };
      }

      activeEncIds.delete(encId);
      encIdToMeta.delete(encId);

      saveEvent({ playerId: meta.id, event: "playerExits", timestamp });
      console.log("📥 playerExits saved:", meta.id, timestamp, meta.name);
    } catch (err) {
      console.error("error in playerExits handler:", err);
    }
  });
}

// 連線 Gather
function connectGather() {
  console.log("🔌 Connecting to Gather Town...");
  game = new Game(SPACE_ID, () => Promise.resolve({ apiKey: API_KEY }));
  game.connect();

  game.subscribeToConnection(async (connected) => {
    if (connected) {
      console.log("✅ Connected to Gather Town!");

      try {
        await game.waitForInit();
        const count = Object.keys(game?.state?.players ?? {}).length;
        console.log(`✅ Game init complete. Players in state: ${count}`);
      } catch (e) {
        console.warn("⚠️ waitForInit failed/timeout:", e?.message || e);
      }

      registerHandlers();
    } else {
      console.log("❌ Disconnected, retrying in 5s...");
      handlersRegistered = false;
      setTimeout(connectGather, 5000);
    }
  });

  setInterval(() => {
    if (game?.connected) game.spaceUpdates([], true);
  }, 20000);
}

connectGather();

// ── 定時整理 JSON → Google Sheet ──
schedule.scheduleJob("*/5 * * * *", () => {
  console.log("⏱ Running scheduled job: append events to Google Sheet");
  appendEventsToSheet().catch(console.error);
});

// 程式啟動時先跑一次
appendEventsToSheet().catch(console.error);

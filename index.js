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

// ── 玩家追蹤變數 ──
const activePlayers = new Set(); // 已 join 的玩家
const playersCache = {}; // encId -> { name, joinedAt }
let handlersRegistered = false;

function registerHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  // Player Joins
  game.subscribeToEvent("playerJoins", (data) => {
    const encId = data.playerJoins.encId;
    console.log("DEBUG playerJoins event:", data);

    if (activePlayers.has(encId)) {
      console.log("⚠️ Duplicate join ignored for:", encId);
      return; // 已在場，不重複寫入
    }

    const timestamp = new Date().toISOString();
    const username = "unknown";

    // 暫存
    playersCache[encId] = { name: username, joinedAt: timestamp };

    // 寫入事件
    saveEvent({ playerId: encId, username, event: "playerJoins", timestamp });
    console.log(`📥 playerJoins saved: ${encId} ${timestamp} ${username}`);

    activePlayers.add(encId);
  });

  // Player Sets Name
  game.subscribeToEvent("playerSetsName", (data) => {
    const { encId, name } = data.playerSetsName;
  
    // 只更新暫存，不再新增事件
    if (playersCache[encId]) {
      playersCache[encId].name = name;
  
      // 更新 events.json 裡最後一筆 join 記錄的 username
      let events = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].playerId === encId && events[i].event === "playerJoins") {
          events[i].username = name;
          break;
        }
      }
      fs.writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2), "utf8");
      console.log(`✅ Updated name for ${encId}: ${name}`);
    } else {
      // 假如玩家直接送名字但還沒 join，就暫存起來
      playersCache[encId] = { name, joinedAt: new Date().toISOString() };
      console.log(`ℹ️ Name cached for ${encId}: ${name} (no join yet)`);
    }
  });

  // Player Exits
  game.subscribeToEvent("playerExits", (data) => {
    const encId = data.playerExits.encId;
    const timestamp = new Date().toISOString();
    console.log("DEBUG playerExits event:", data);

    if (!activePlayers.has(encId)) {
      console.log("⚠️ Exit ignored (not active):", encId);
      return;
    }

    const username = playersCache[encId]?.name ?? "unknown";

    saveEvent({ playerId: encId, username, event: "playerExits", timestamp });
    console.log(`📥 playerExits saved: ${encId} ${timestamp} ${username}`);

    activePlayers.delete(encId);
    delete playersCache[encId];
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

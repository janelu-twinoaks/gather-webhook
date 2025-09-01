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

// 等待玩家資料（輪詢 game.state.players[encId]，直到有 or 超時）
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
        resolve(null); // 超時
      }
    }, interval);
  });
}

// 追蹤目前在場的 encId 與 encId->玩家資訊的對應
const activeEncIds = new Set();
const encIdToMeta = new Map();
let handlersRegistered = false;

function registerHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  // Player Joins
  game.subscribeToEvent("playerJoins", async (data) => {
    try {
      const encId = data?.playerJoins?.encId;
      console.log("DEBUG playerJoins event:", data);
      const timestamp = new Date().toISOString();

      if (activeEncIds.has(encId)) {
        console.log("⚠️ Duplicate join ignored for:", encId);
        return;
      }

      // 等待玩家資訊就緒（避免剛連上 state 還沒同步）
      const info = await waitForPlayerInfo(encId, 4000);
      const playerId = info?.id ?? encId;     // 拿不到就先用 encId
      const name = info?.name ?? "Unknown";

      // 記錄映射，方便之後 playerExits 用
      encIdToMeta.set(encId, { id: playerId, name });
      activeEncIds.add(encId);

      saveEvent({ playerId, event: "playerJoins", timestamp });
      console.log("📥 playerJoins saved:", playerId, timestamp, name);
    } catch (err) {
      console.error("error in playerJoins handler:", err);
    }
  });

  // Player Exits
  game.subscribeToEvent("playerExits", async (data) => {
    try {
      console.log("DEBUG playerExits event:", data);
      const encId = data?.playerExits?.encId;
      const timestamp = new Date().toISOString();

      if (!activeEncIds.has(encId)) {
        console.log("⚠️ Exit ignored (not active):", encId);
        return;
      }

      // 先用先前保存的 meta，若沒有再嘗試從 state 補
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

// 連線 Gather（先等初始化再註冊 handler）
function connectGather() {
  console.log("🔌 Connecting to Gather Town...");
  game = new Game(SPACE_ID, () => Promise.resolve({ apiKey: API_KEY }));
  game.connect();

  game.subscribeToConnection(async (connected) => {
    if (connected) {
      console.log("✅ Connected to Gather Town!");

      try {
        // 等初始 state（官方文件也建議這樣做）
        await game.waitForInit();
        const count = Object.keys(game?.state?.players ?? {}).length;
        console.log(`✅ Game init complete. Players in state: ${count}`);
      } catch (e) {
        console.warn("⚠️ waitForInit failed/timeout, will continue anyway:", e?.message || e);
      }

      // 註冊事件（只註冊一次）
      registerHandlers();
    } else {
      console.log("❌ Disconnected, retrying in 5s...");
      handlersRegistered = false; // 重新連線時重註冊
      setTimeout(connectGather, 5000);
    }
  });

  // Heartbeat
  setInterval(() => {
    if (game?.connected) game.spaceUpdates([], true);
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

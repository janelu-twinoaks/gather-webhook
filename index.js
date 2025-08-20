import WebSocket from "ws";
import fetch from "node-fetch";

const API_KEY = process.env.GATHER_API_KEY;
const SPACE_ID = process.env.SPACE_ID;
const PIPEDREAM_WEBHOOK_URL = process.env.PIPEDREAM_WEBHOOK_URL;

const ws = new WebSocket(`wss://gather.town/api?apiKey=${API_KEY}&spaceId=${SPACE_ID}`);

ws.on("open", () => console.log("Connected to Gather Town WebSocket"));

ws.on("message", async (data) => {
  const msg = JSON.parse(data);

  if (msg.event === "playerJoins" || msg.event === "playerExits") {
    const payload = {
      userId: msg.userId,
      event: msg.event,
      timestamp: new Date().toISOString(),
    };

    console.log("Sending to Pipedream:", payload);

    await fetch(PIPEDREAM_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
});

ws.on("error", (err) => console.error("WebSocket error:", err));
ws.on("close", () => console.log("Disconnected from Gather Town"));

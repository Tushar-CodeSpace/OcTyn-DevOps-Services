import { io, type Socket } from "socket.io-client";
import { getToken, getRefreshToken } from "@/lib/api";

let socket: Socket | null = null;
let socketToken: string | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const data = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!data.ok) return false;
    const result = await data.json();
    localStorage.setItem("cm_token", result.access_token);
    localStorage.setItem("cm_refresh", result.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export function getSocket(): Socket {
  const token = getToken();
  if (!socket || socketToken !== token) {
    socket?.disconnect();
    socketToken = token;
    socket = io({ auth: { token }, transports: ["polling", "websocket"] });
    socket.on("connect_error", async (err) => {
      if (err.message === "Unauthorized") {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          socket?.disconnect();
          socket = null;
          socketToken = null;
          void getSocket();
        }
      }
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}

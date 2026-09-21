import { io, type Socket } from "socket.io-client";
import { getToken, refreshAccessToken } from "@/lib/api";

let socket: Socket | null = null;
let socketToken: string | null = null;

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

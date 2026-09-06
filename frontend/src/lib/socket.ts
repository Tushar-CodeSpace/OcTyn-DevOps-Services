import { io, type Socket } from "socket.io-client";
import { getToken } from "@/lib/api";

let socket: Socket | null = null;
let socketToken: string | null = null;

export function getSocket(): Socket {
  const token = getToken();
  // Recreate if the auth token changed (re-login / expiry) so the new
  // connection authenticates with a valid JWT.
  if (!socket || socketToken !== token) {
    socket?.disconnect();
    socketToken = token;
    socket = io({ auth: { token }, transports: ["polling", "websocket"] });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}

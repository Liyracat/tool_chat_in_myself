import type {
  DisplayMode,
  Message,
  MessageFilters,
  RoomDetail,
  RoomSummary,
  Speaker,
  ThreadResponse,
} from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function listSpeakers() {
  return request<Speaker[]>("/api/speakers");
}

export function listRooms(query = "") {
  const search = new URLSearchParams();
  if (query) {
    search.set("query", query);
  }
  const suffix = search.toString();
  return request<RoomSummary[]>(suffix ? `/api/rooms?${suffix}` : "/api/rooms");
}

export function getRoom(roomId: number) {
  return request<RoomDetail>(`/api/rooms/${roomId}`);
}

export function createRoom(payload: { title: string; description: string }) {
  return request<RoomDetail>("/api/rooms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listMessages(roomId: number, mode: DisplayMode, filters: MessageFilters) {
  const search = new URLSearchParams({ mode });
  if (filters.speakerId) {
    search.set("speaker_id", filters.speakerId);
  }
  if (filters.keyword.trim()) {
    search.set("keyword", filters.keyword.trim());
  }
  if (filters.hasReplies === "yes") {
    search.set("has_replies", "true");
  }
  if (filters.hasReplies === "no") {
    search.set("has_replies", "false");
  }
  if (filters.rootOnly === "root") {
    search.set("root_only", "true");
  }
  if (filters.rootOnly === "replies") {
    search.set("root_only", "false");
  }
  return request<Message[]>(`/api/rooms/${roomId}/messages?${search.toString()}`);
}

export function createMessage(payload: {
  room_id: number;
  speaker_id: string;
  body: string;
  parent_id: number | null;
}) {
  return request<Message>("/api/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getThread(messageId: number) {
  return request<ThreadResponse>(`/api/messages/${messageId}/thread`);
}

export function updateMemo(roomId: number, memo: string) {
  return request<{ memo: string; has_unresolved_memo: boolean }>(`/api/rooms/${roomId}/memo`, {
    method: "PUT",
    body: JSON.stringify({ memo }),
  });
}

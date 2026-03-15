export type DisplayMode = "chronological" | "threaded";
export type DetailTab = "thread" | "memo" | "filters";

export type Speaker = {
  id: string;
  name: string;
  color: string;
};

export type RoomSummary = {
  id: number;
  title: string;
  description: string;
  updated_at: string;
  latest_speaker_name: string | null;
  has_unresolved_memo: boolean;
};

export type RoomDetail = RoomSummary & {
  memo: string;
};

export type Message = {
  id: number;
  room_id: number;
  speaker_id: string;
  speaker_name: string;
  speaker_color: string;
  body: string;
  parent_id: number | null;
  created_at: string;
  reply_count: number;
};

export type ThreadResponse = {
  root: Message;
  replies: Message[];
};

export type MessageFilters = {
  speakerId: string;
  keyword: string;
  hasReplies: "all" | "yes" | "no";
  rootOnly: "all" | "root" | "replies";
};

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  createMessage,
  createRoom,
  deleteMessage,
  getRoom,
  getThread,
  listMessages,
  listRooms,
  listSpeakers,
  updateMemo,
} from "@/lib/api";
import type {
  DetailTab,
  DisplayMode,
  Message,
  MessageFilters,
  RoomDetail,
  RoomSummary,
  Speaker,
  ThreadResponse,
} from "@/types";

const STORAGE_KEY = "inner-debate:last-room-id";

const defaultFilters: MessageFilters = {
  speakerId: "",
  keyword: "",
  hasReplies: "all",
  rootOnly: "all",
};

function formatDate(dateString: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

export function ChatWorkspace() {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("thread");
  const [mode, setMode] = useState<DisplayMode>("chronological");
  const [filters, setFilters] = useState<MessageFilters>(defaultFilters);
  const [roomQuery, setRoomQuery] = useState("");
  const [roomSearchInput, setRoomSearchInput] = useState("");
  const [composerSpeakerId, setComposerSpeakerId] = useState("");
  const [composerBody, setComposerBody] = useState("");
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [memoDraft, setMemoDraft] = useState("");
  const [showDetailPane, setShowDetailPane] = useState(false);
  const [showNewRoomForm, setShowNewRoomForm] = useState(false);
  const [newRoomTitle, setNewRoomTitle] = useState("");
  const [newRoomDescription, setNewRoomDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedSpeaker = useMemo(
    () => speakers.find((speaker) => speaker.id === composerSpeakerId) ?? speakers[0] ?? null,
    [composerSpeakerId, speakers]
  );

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!selectedRoomId) {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, String(selectedRoomId));
    void loadRoom(selectedRoomId);
  }, [selectedRoomId]);

  useEffect(() => {
    if (!selectedRoomId) {
      return;
    }
    void loadMessages(selectedRoomId, mode, filters);
  }, [selectedRoomId, mode, filters]);

  useEffect(() => {
    if (!selectedMessage) {
      setThread(null);
      return;
    }
    void loadThread(selectedMessage.id);
  }, [selectedMessage]);

  async function bootstrap() {
    try {
      const [roomsResult, speakersResult] = await Promise.all([listRooms(), listSpeakers()]);
      setRooms(roomsResult);
      setSpeakers(speakersResult);
      setComposerSpeakerId(speakersResult[0]?.id ?? "");

      const storedRoomId = window.localStorage.getItem(STORAGE_KEY);
      const fallbackRoomId = roomsResult[0]?.id ?? null;
      const initialRoomId =
        storedRoomId && roomsResult.some((roomItem) => roomItem.id === Number(storedRoomId))
          ? Number(storedRoomId)
          : fallbackRoomId;
      setSelectedRoomId(initialRoomId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "初期データの読み込みに失敗しました。");
    }
  }

  async function loadRoom(roomId: number) {
    try {
      const roomResult = await getRoom(roomId);
      setRoom(roomResult);
      setMemoDraft(roomResult.memo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "部屋の取得に失敗しました。");
    }
  }

  async function loadMessages(roomId: number, nextMode: DisplayMode, nextFilters: MessageFilters) {
    try {
      const messageResult = await listMessages(roomId, nextMode, nextFilters);
      setMessages(messageResult);
      if (messageResult.length === 0) {
        setSelectedMessage(null);
        return;
      }
      setSelectedMessage((current) => {
        if (current && messageResult.some((message) => message.id === current.id)) {
          return messageResult.find((message) => message.id === current.id) ?? messageResult[0];
        }
        return messageResult[0];
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "発言一覧の取得に失敗しました。");
    }
  }

  async function loadThread(messageId: number) {
    try {
      const threadResult = await getThread(messageId);
      setThread(threadResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "スレッドの取得に失敗しました。");
    }
  }

  async function refreshRooms(query = roomQuery) {
    const roomsResult = await listRooms(query);
    setRooms(roomsResult);
  }

  async function handleRoomSearch() {
    try {
      setRoomQuery(roomSearchInput);
      const roomsResult = await listRooms(roomSearchInput);
      setRooms(roomsResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "部屋検索に失敗しました。");
    }
  }

  async function handleCopyTimeline() {
    if (!selectedRoomId) {
      return;
    }
    try {
      const allMessages = await listMessages(selectedRoomId, "chronological", defaultFilters);
      const text = allMessages
        .map(
          (message) => `[${message.speaker_name}] [${formatDate(message.created_at)}]\n${message.body}`
        )
        .join("\n\n");
      await navigator.clipboard.writeText(text);
      setCopyNotice("時系列ログをコピーした。");
      window.setTimeout(() => setCopyNotice(null), 2200);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "コピーに失敗しました。");
    }
  }

  async function handleSubmitMessage() {
    if (!selectedRoomId || !composerSpeakerId || !composerBody.trim()) {
      return;
    }
    try {
      setError(null);
      await createMessage({
        room_id: selectedRoomId,
        speaker_id: composerSpeakerId,
        body: composerBody.trim(),
        parent_id: replyTarget?.id ?? null,
      });
      setComposerBody("");
      await Promise.all([loadMessages(selectedRoomId, mode, filters), loadRoom(selectedRoomId), refreshRooms()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "投稿に失敗しました。");
    }
  }

  async function handleDeleteMessage(message: Message) {
    const confirmed = window.confirm(`「${message.speaker_name}」の発言を削除する？`);
    if (!confirmed) {
      return;
    }

    try {
      setError(null);
      await deleteMessage(message.id);
      if (replyTarget?.id === message.id) {
        setReplyTarget(null);
      }
      if (selectedMessage?.id === message.id) {
        setSelectedMessage(null);
      }
      await Promise.all([loadMessages(message.room_id, mode, filters), loadRoom(message.room_id), refreshRooms()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "削除に失敗しました。");
    }
  }

  async function handleSaveMemo() {
    if (!selectedRoomId) {
      return;
    }
    try {
      setError(null);
      await updateMemo(selectedRoomId, memoDraft);
      await Promise.all([loadRoom(selectedRoomId), refreshRooms()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "メモ保存に失敗しました。");
    }
  }

  async function handleCreateRoom() {
    if (!newRoomTitle.trim()) {
      return;
    }
    try {
      const created = await createRoom({
        title: newRoomTitle.trim(),
        description: newRoomDescription.trim(),
      });
      setNewRoomTitle("");
      setNewRoomDescription("");
      setShowNewRoomForm(false);
      await refreshRooms();
      setSelectedRoomId(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "部屋作成に失敗しました。");
    }
  }

  function openThreadFor(message: Message) {
    setSelectedMessage(message);
    setDetailTab("thread");
    setShowDetailPane(true);
  }

  function renderMessageCard(message: Message) {
    return (
      <article
        key={message.id}
        className={`message-card ${selectedMessage?.id === message.id ? "selected" : ""}`}
        style={{
          background: `linear-gradient(135deg, ${message.speaker_color}55 0%, rgba(255,255,255,0.86) 28%)`,
        }}
      >
        <button
          type="button"
          style={{ all: "unset", display: "block", cursor: "pointer" }}
          onClick={() => openThreadFor(message)}
        >
          <div className="message-head">
            <span className="speaker-badge">
              <span className="speaker-dot" style={{ background: message.speaker_color }} />
              {message.speaker_name}
            </span>
            <span className="muted">{formatDate(message.created_at)}</span>
          </div>
          <p className="message-body">{message.body}</p>
        </button>
        <div className="message-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setReplyTarget(message);
              setShowDetailPane(false);
            }}
          >
            返信する
          </button>
          <button type="button" className="ghost-button" onClick={() => openThreadFor(message)}>
            スレッド {message.reply_count > 0 ? `${message.reply_count}件` : "を見る"}
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleDeleteMessage(message)}>
            削除
          </button>
        </div>
      </article>
    );
  }

  return (
    <main className="app-shell">
      <div className="workspace">
        <aside className="sidebar panel">
          <div className="sidebar-header">
            <div>
              <p className="eyebrow">Rooms</p>
              <h1>脳内会議室</h1>
            </div>
            <button className="primary-button" type="button" onClick={() => setShowNewRoomForm((value) => !value)}>
              新しい部屋
            </button>
          </div>
          <p className="muted">議題は軽く切り替えて、ログは長く残す。</p>
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="search-row">
              <input
                className="search-box"
                placeholder="部屋を検索"
                value={roomSearchInput}
                onChange={(event) => setRoomSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    startTransition(() => {
                      void handleRoomSearch();
                    });
                  }
                }}
              />
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  startTransition(() => {
                    void handleRoomSearch();
                  });
                }}
              >
                検索
              </button>
            </div>
            {showNewRoomForm ? (
              <div className="room-form">
                <input
                  placeholder="部屋タイトル"
                  value={newRoomTitle}
                  onChange={(event) => setNewRoomTitle(event.target.value)}
                />
                <textarea
                  placeholder="短い説明"
                  rows={3}
                  value={newRoomDescription}
                  onChange={(event) => setNewRoomDescription(event.target.value)}
                />
                <button type="button" className="primary-button" onClick={() => void handleCreateRoom()}>
                  作成する
                </button>
              </div>
            ) : null}
          </div>
          <div className="room-list">
            {rooms.map((roomItem) => (
              <button
                key={roomItem.id}
                type="button"
                className={`room-card ${selectedRoomId === roomItem.id ? "active" : ""}`}
                onClick={() => setSelectedRoomId(roomItem.id)}
                title={roomItem.description}
              >
                <h3>{roomItem.title}</h3>
                <p className="room-meta">最終更新: {formatDate(roomItem.updated_at)}</p>
                <p className="room-meta">最新: {roomItem.latest_speaker_name ?? "まだ発言なし"}</p>
                {roomItem.has_unresolved_memo ? <span className="mark">未整理メモあり</span> : null}
              </button>
            ))}
          </div>
        </aside>

        <section className="main-panel panel">
          <div className="main-top">
            <div className="mobile-topbar">
              <div>
                <p className="eyebrow">Current Room</p>
                <strong>{room?.title ?? "部屋を選択"}</strong>
              </div>
              <div className="mode-toggle">
                <button
                  type="button"
                  className={`chip-button ${mode === "chronological" ? "active" : ""}`}
                  onClick={() => setMode("chronological")}
                >
                  時系列
                </button>
                <button
                  type="button"
                  className={`chip-button ${mode === "threaded" ? "active" : ""}`}
                  onClick={() => setMode("threaded")}
                >
                  スレッド
                </button>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowDetailPane(true)}>
                メニュー
              </button>
            </div>
            <select
              className="mobile-room-select"
              value={selectedRoomId ?? ""}
              onChange={(event) => setSelectedRoomId(Number(event.target.value))}
            >
              {rooms.map((roomItem) => (
                <option key={roomItem.id} value={roomItem.id}>
                  {roomItem.title}
                </option>
              ))}
            </select>
            <div className="main-header">
              <div>
                <p className="eyebrow">Current Room</p>
                <h2>{room?.title ?? "部屋を選択"}</h2>
                <p className="muted">{room?.description ?? "左の一覧から議題を選ぶと会話が表示される。"}</p>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="mode-toggle">
                  <button type="button" className="ghost-button" onClick={() => void handleCopyTimeline()}>
                    全体コピー
                  </button>
                  <button
                    type="button"
                    className={`chip-button ${mode === "chronological" ? "active" : ""}`}
                    onClick={() => setMode("chronological")}
                  >
                    時系列
                  </button>
                  <button
                    type="button"
                    className={`chip-button ${mode === "threaded" ? "active" : ""}`}
                    onClick={() => setMode("threaded")}
                  >
                    スレッド
                  </button>
                </div>
                <button className="icon-button" type="button" onClick={() => setShowDetailPane((value) => !value)}>
                  右ペイン
                </button>
              </div>
            </div>
            <div className="header-actions">
              <button type="button" className="ghost-button" onClick={() => void handleCopyTimeline()}>
                時系列ログをコピー
              </button>
              {copyNotice ? <p className="muted">{copyNotice}</p> : null}
            </div>
            {error ? <p className="muted" style={{ color: "#8d3f36", marginTop: 12 }}>{error}</p> : null}
          </div>

          <div className="message-list">
            {messages.length > 0 ? (
              messages.map((message) => renderMessageCard(message))
            ) : (
              <div className="empty-state">まだ発言がない。最初の一言を置いてみる。</div>
            )}
          </div>

          <div className="composer-float">
            <div className="composer-wrap panel">
            {replyTarget ? (
              <div className="reply-banner">
                <span>{replyTarget.speaker_name}の発言に返信中</span>
                <button type="button" className="ghost-button" onClick={() => setReplyTarget(null)}>
                  解除
                </button>
              </div>
            ) : null}
            <div className="composer">
              <div className="composer-row">
                <select value={composerSpeakerId} onChange={(event) => setComposerSpeakerId(event.target.value)}>
                  {speakers.map((speaker) => (
                    <option key={speaker.id} value={speaker.id}>
                      {speaker.name}
                    </option>
                  ))}
                </select>
                <textarea
                  placeholder="今の論点を一言でも残す"
                  value={composerBody}
                  onChange={(event) => setComposerBody(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.ctrlKey) {
                      event.preventDefault();
                      void handleSubmitMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  className="primary-button"
                  disabled={!selectedSpeaker || isPending}
                  onClick={() => void handleSubmitMessage()}
                >
                  投稿
                </button>
              </div>
            </div>
            </div>
          </div>
        </section>

        <DetailPane
          open={showDetailPane}
          room={room}
          thread={thread}
          detailTab={detailTab}
          memoDraft={memoDraft}
          filters={filters}
          speakers={speakers}
          onClose={() => setShowDetailPane(false)}
          onSelectTab={setDetailTab}
          onChangeMemo={setMemoDraft}
          onSaveMemo={() => void handleSaveMemo()}
          onReplyTo={(message) => {
            setReplyTarget(message);
            setShowDetailPane(false);
          }}
          onDeleteMessage={(message) => void handleDeleteMessage(message)}
          onChangeFilters={setFilters}
        />

        {showDetailPane ? <div className="mobile-sheet-backdrop" onClick={() => setShowDetailPane(false)} /> : null}
        {showDetailPane ? (
          <div className="mobile-sheet panel">
            <DetailPaneContent
              room={room}
              thread={thread}
              detailTab={detailTab}
              memoDraft={memoDraft}
              filters={filters}
              speakers={speakers}
              onSelectTab={setDetailTab}
              onChangeMemo={setMemoDraft}
              onSaveMemo={() => void handleSaveMemo()}
              onReplyTo={(message) => {
                setReplyTarget(message);
                setShowDetailPane(false);
              }}
              onDeleteMessage={(message) => void handleDeleteMessage(message)}
              onChangeFilters={setFilters}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}

function DetailPane(props: {
  open: boolean;
  room: RoomDetail | null;
  thread: ThreadResponse | null;
  detailTab: DetailTab;
  memoDraft: string;
  filters: MessageFilters;
  speakers: Speaker[];
  onClose: () => void;
  onSelectTab: (tab: DetailTab) => void;
  onChangeMemo: (memo: string) => void;
  onSaveMemo: () => void;
  onReplyTo: (message: Message) => void;
  onDeleteMessage: (message: Message) => void;
  onChangeFilters: (filters: MessageFilters) => void;
}) {
  return (
    <aside className={`detail-pane panel ${props.open ? "open" : ""}`}>
      <div className="detail-header">
        <p className="eyebrow">Details</p>
        <button className="icon-button" type="button" onClick={props.onClose}>
          閉じる
        </button>
      </div>
      <DetailPaneContent {...props} />
    </aside>
  );
}

function DetailPaneContent(props: {
  room: RoomDetail | null;
  thread: ThreadResponse | null;
  detailTab: DetailTab;
  memoDraft: string;
  filters: MessageFilters;
  speakers: Speaker[];
  onSelectTab: (tab: DetailTab) => void;
  onChangeMemo: (memo: string) => void;
  onSaveMemo: () => void;
  onReplyTo: (message: Message) => void;
  onDeleteMessage: (message: Message) => void;
  onChangeFilters: (filters: MessageFilters) => void;
}) {
  return (
    <>
      <div className="detail-tabs">
        <button
          type="button"
          className={`chip-button ${props.detailTab === "thread" ? "active" : ""}`}
          onClick={() => props.onSelectTab("thread")}
        >
          スレッド
        </button>
        <button
          type="button"
          className={`chip-button ${props.detailTab === "memo" ? "active" : ""}`}
          onClick={() => props.onSelectTab("memo")}
        >
          部屋メモ
        </button>
        <button
          type="button"
          className={`chip-button ${props.detailTab === "filters" ? "active" : ""}`}
          onClick={() => props.onSelectTab("filters")}
        >
          絞り込み
        </button>
      </div>

      <div className="detail-body">
        {props.detailTab === "thread" ? (
          <div className="detail-section">
            {props.thread ? (
              <div className="thread-stack">
                <div className="thread-card">
                  <div className="speaker-badge">
                    <span className="speaker-dot" style={{ background: props.thread.root.speaker_color }} />
                    {props.thread.root.speaker_name}
                  </div>
                  <p className="message-body">{props.thread.root.body}</p>
                  <div className="thread-actions">
                    <button type="button" className="ghost-button" onClick={() => props.onReplyTo(props.thread.root)}>
                      この発言に返信
                    </button>
                    <button type="button" className="ghost-button" onClick={() => props.onDeleteMessage(props.thread.root)}>
                      削除
                    </button>
                  </div>
                </div>
                {props.thread.replies.length > 0 ? (
                  props.thread.replies.map((reply) => (
                    <div key={reply.id} className="thread-card">
                      <div className="speaker-badge">
                        <span className="speaker-dot" style={{ background: reply.speaker_color }} />
                        {reply.speaker_name}
                      </div>
                      <p className="message-body">{reply.body}</p>
                      <div className="thread-actions">
                        <p className="muted">{formatDate(reply.created_at)}</p>
                        <button type="button" className="ghost-button" onClick={() => props.onDeleteMessage(reply)}>
                          削除
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="thread-card muted">まだ返信はない。</div>
                )}
              </div>
            ) : (
              <div className="empty-state">中央で発言を選ぶと、ここで枝を追える。</div>
            )}
          </div>
        ) : null}

        {props.detailTab === "memo" ? (
          <div className="detail-section">
            <p className="muted">争点、未回収の問い、一旦の整理をチャットとは別軸で残す。</p>
            <textarea
              className="memo-editor"
              value={props.memoDraft}
              onChange={(event) => props.onChangeMemo(event.target.value)}
              placeholder="この部屋の補助メモ"
            />
            <button type="button" className="primary-button" onClick={props.onSaveMemo}>
              メモを保存
            </button>
          </div>
        ) : null}

        {props.detailTab === "filters" ? (
          <div className="detail-section">
            <div className="filter-grid">
              <label className="filter-field">
                話者
                <select
                  value={props.filters.speakerId}
                  onChange={(event) => props.onChangeFilters({ ...props.filters, speakerId: event.target.value })}
                >
                  <option value="">すべて</option>
                  {props.speakers.map((speaker) => (
                    <option key={speaker.id} value={speaker.id}>
                      {speaker.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                キーワード
                <input
                  value={props.filters.keyword}
                  onChange={(event) => props.onChangeFilters({ ...props.filters, keyword: event.target.value })}
                  placeholder="本文検索"
                />
              </label>
              <label className="filter-field">
                返信ありのみ
                <select
                  value={props.filters.hasReplies}
                  onChange={(event) =>
                    props.onChangeFilters({
                      ...props.filters,
                      hasReplies: event.target.value as MessageFilters["hasReplies"],
                    })
                  }
                >
                  <option value="all">指定なし</option>
                  <option value="yes">返信あり</option>
                  <option value="no">返信なし</option>
                </select>
              </label>
              <label className="filter-field">
                発言の種類
                <select
                  value={props.filters.rootOnly}
                  onChange={(event) =>
                    props.onChangeFilters({
                      ...props.filters,
                      rootOnly: event.target.value as MessageFilters["rootOnly"],
                    })
                  }
                >
                  <option value="all">すべて</option>
                  <option value="root">独立発言のみ</option>
                  <option value="replies">返信のみ</option>
                </select>
              </label>
            </div>
            <p className="muted">読み返しを助けるための最低限だけ置いてある。</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

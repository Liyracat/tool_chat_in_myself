from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "chat.db"

SPEAKERS = [
    {"id": "shiratori_sho", "name": "白鷺翔", "color": "#FFFFFF"},
    {"id": "himari", "name": "陽葵", "color": "#FFD5B4"},
    {"id": "soma", "name": "蒼真", "color": "#B3B6CC"},
    {"id": "chano", "name": "茶乃", "color": "#B9A588"},
    {"id": "shuren", "name": "朱蓮", "color": "#EDAFB7"},
    {"id": "genya", "name": "玄夜", "color": "#A6A6A6"},
    {"id": "soranagi", "name": "空凪", "color": "#C3E4EA"},
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with closing(get_connection()) as connection:
        connection.executescript(
            """
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS speakers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                memo TEXT NOT NULL DEFAULT '',
                has_unresolved_memo INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL,
                last_opened_at TEXT
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
                speaker_id TEXT NOT NULL REFERENCES speakers(id),
                body TEXT NOT NULL,
                parent_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL
            );
            """
        )

        for speaker in SPEAKERS:
            connection.execute(
                """
                INSERT INTO speakers (id, name, color)
                VALUES (:id, :name, :color)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    color = excluded.color
                """,
                speaker,
            )

        room_count = connection.execute("SELECT COUNT(*) FROM rooms").fetchone()[0]
        if room_count == 0:
            seed_data(connection)

        connection.commit()


def seed_data(connection: sqlite3.Connection) -> None:
    now = utc_now()
    cursor = connection.execute(
        """
        INSERT INTO rooms (title, description, memo, has_unresolved_memo, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            "AIとの日常会話で先に確保すべきもの",
            "日常的にAIと付き合う前に、何を先に固めるべきかを人格ごとに整理する部屋。",
            "争点:\n- 保存したい会話は何か\n- 指示文は保険になるか\n\n未回収:\n- モバイルでの見返し導線",
            1,
            now,
            now,
        ),
    )
    room_id = cursor.lastrowid

    m1 = connection.execute(
        """
        INSERT INTO messages (room_id, speaker_id, body, parent_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            room_id,
            "soma",
            "最初に確保すべきなのは、思考の流れを失わずに残せることだと思う。ログが曖昧だと後で比較できない。",
            None,
            now,
        ),
    ).lastrowid
    connection.execute(
        """
        INSERT INTO messages (room_id, speaker_id, body, parent_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            room_id,
            "himari",
            "でも読み返しやすさも同じくらい大事。後から『誰がどこで何を言ったか』が追えないと、ログがあっても使えないよ。",
            m1,
            now,
        ),
    )
    connection.execute(
        """
        INSERT INTO messages (room_id, speaker_id, body, parent_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            room_id,
            "genya",
            "Discordみたいなアカウント切替前提は避けたい。人格切替は投稿時の選択だけで十分。",
            None,
            now,
        ),
    )

    room2 = connection.execute(
        """
        INSERT INTO rooms (title, description, memo, has_unresolved_memo, updated_at, last_opened_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            "カスタム指示文はガードレールか",
            "指示文が守りになるのか、かえって硬直化を生むのかを議論する部屋。",
            "",
            0,
            now,
            None,
        ),
    ).lastrowid
    connection.execute(
        """
        INSERT INTO messages (room_id, speaker_id, body, parent_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            room2,
            "shuren",
            "ガードレールにはなるけど、強すぎると会話の探索幅が狭まる気がする。",
            None,
            now,
        ),
    )


def room_preview_subquery() -> str:
    return """
        SELECT
            rooms.id,
            rooms.title,
            rooms.description,
            rooms.memo,
            rooms.has_unresolved_memo,
            rooms.updated_at,
            rooms.last_opened_at,
            (
                SELECT speakers.name
                FROM messages
                JOIN speakers ON speakers.id = messages.speaker_id
                WHERE messages.room_id = rooms.id
                ORDER BY messages.created_at DESC, messages.id DESC
                LIMIT 1
            ) AS latest_speaker_name
        FROM rooms
    """


def recalc_room_updated_at(connection: sqlite3.Connection, room_id: int) -> None:
    latest_message = connection.execute(
        "SELECT MAX(created_at) AS created_at FROM messages WHERE room_id = ?",
        (room_id,),
    ).fetchone()
    updated_at = latest_message["created_at"] if latest_message and latest_message["created_at"] else utc_now()
    connection.execute("UPDATE rooms SET updated_at = ? WHERE id = ?", (updated_at, room_id))


def message_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "room_id": row["room_id"],
        "speaker_id": row["speaker_id"],
        "speaker_name": row["speaker_name"],
        "speaker_color": row["speaker_color"],
        "body": row["body"],
        "parent_id": row["parent_id"],
        "created_at": row["created_at"],
        "reply_count": row["reply_count"],
    }


class SpeakerResponse(BaseModel):
    id: str
    name: str
    color: str


class RoomSummary(BaseModel):
    id: int
    title: str
    description: str
    updated_at: str
    latest_speaker_name: str | None
    has_unresolved_memo: bool


class RoomDetail(RoomSummary):
    memo: str


class MessageResponse(BaseModel):
    id: int
    room_id: int
    speaker_id: str
    speaker_name: str
    speaker_color: str
    body: str
    parent_id: int | None
    created_at: str
    reply_count: int


class ThreadResponse(BaseModel):
    root: MessageResponse
    replies: list[MessageResponse]


class CreateRoomRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=280)


class CreateMessageRequest(BaseModel):
    room_id: int
    speaker_id: str
    body: str = Field(min_length=1, max_length=4000)
    parent_id: int | None = None


class MemoRequest(BaseModel):
    memo: str = Field(default="", max_length=10000)


app = FastAPI(title="Inner Debate Chat API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/speakers", response_model=list[SpeakerResponse])
def list_speakers() -> list[SpeakerResponse]:
    order_clause = "CASE id " + " ".join(
        f"WHEN '{speaker['id']}' THEN {index}" for index, speaker in enumerate(SPEAKERS)
    ) + " END"
    with closing(get_connection()) as connection:
        rows = connection.execute(
            f"SELECT id, name, color FROM speakers ORDER BY {order_clause}"
        ).fetchall()
    return [SpeakerResponse.model_validate(dict(row)) for row in rows]


@app.get("/api/rooms", response_model=list[RoomSummary])
def list_rooms(query: str = Query(default="")) -> list[RoomSummary]:
    sql = room_preview_subquery()
    params: list[str] = []
    if query:
        sql += " WHERE rooms.title LIKE ? OR rooms.description LIKE ?"
        wildcard = f"%{query}%"
        params.extend([wildcard, wildcard])
    sql += " ORDER BY COALESCE(rooms.last_opened_at, rooms.updated_at) DESC, rooms.updated_at DESC"

    with closing(get_connection()) as connection:
        rows = connection.execute(sql, params).fetchall()

    return [
        RoomSummary(
            id=row["id"],
            title=row["title"],
            description=row["description"],
            updated_at=row["updated_at"],
            latest_speaker_name=row["latest_speaker_name"],
            has_unresolved_memo=bool(row["has_unresolved_memo"]),
        )
        for row in rows
    ]


@app.post("/api/rooms", response_model=RoomDetail)
def create_room(payload: CreateRoomRequest) -> RoomDetail:
    now = utc_now()
    with closing(get_connection()) as connection:
        room_id = connection.execute(
            """
            INSERT INTO rooms (title, description, memo, has_unresolved_memo, updated_at, last_opened_at)
            VALUES (?, ?, '', 0, ?, ?)
            """,
            (payload.title.strip(), payload.description.strip(), now, now),
        ).lastrowid
        connection.commit()
        row = connection.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()

    return RoomDetail(
        id=row["id"],
        title=row["title"],
        description=row["description"],
        updated_at=row["updated_at"],
        latest_speaker_name=None,
        has_unresolved_memo=bool(row["has_unresolved_memo"]),
        memo=row["memo"],
    )


@app.get("/api/rooms/{room_id}", response_model=RoomDetail)
def get_room(room_id: int) -> RoomDetail:
    with closing(get_connection()) as connection:
        row = connection.execute(
            f"""
            SELECT preview.*, rooms.memo
            FROM ({room_preview_subquery()}) AS preview
            JOIN rooms ON rooms.id = preview.id
            WHERE preview.id = ?
            """,
            (room_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Room not found")
        connection.execute("UPDATE rooms SET last_opened_at = ? WHERE id = ?", (utc_now(), room_id))
        connection.commit()

    return RoomDetail(
        id=row["id"],
        title=row["title"],
        description=row["description"],
        updated_at=row["updated_at"],
        latest_speaker_name=row["latest_speaker_name"],
        has_unresolved_memo=bool(row["has_unresolved_memo"]),
        memo=row["memo"],
    )


@app.get("/api/rooms/{room_id}/messages", response_model=list[MessageResponse])
def list_messages(
    room_id: int,
    mode: Literal["chronological", "threaded"] = "chronological",
    speaker_id: str | None = None,
    keyword: str | None = None,
    has_replies: bool | None = None,
    root_only: bool | None = None,
) -> list[MessageResponse]:
    conditions = ["messages.room_id = ?"]
    params: list[object] = [room_id]
    if speaker_id:
        conditions.append("messages.speaker_id = ?")
        params.append(speaker_id)
    if keyword:
        conditions.append("messages.body LIKE ?")
        params.append(f"%{keyword}%")
    if has_replies is True:
        conditions.append("reply_count.reply_count > 0")
    if has_replies is False:
        conditions.append("COALESCE(reply_count.reply_count, 0) = 0")
    if root_only is True:
        conditions.append("messages.parent_id IS NULL")
    if root_only is False:
        conditions.append("messages.parent_id IS NOT NULL")

    order_by = "messages.created_at ASC"
    if mode == "threaded":
        order_by = "COALESCE(messages.parent_id, messages.id) ASC, messages.parent_id IS NOT NULL ASC, messages.created_at ASC"

    sql = f"""
        SELECT
            messages.id,
            messages.room_id,
            messages.speaker_id,
            speakers.name AS speaker_name,
            speakers.color AS speaker_color,
            messages.body,
            messages.parent_id,
            messages.created_at,
            COALESCE(reply_count.reply_count, 0) AS reply_count
        FROM messages
        JOIN speakers ON speakers.id = messages.speaker_id
        LEFT JOIN (
            SELECT parent_id, COUNT(*) AS reply_count
            FROM messages
            WHERE parent_id IS NOT NULL
            GROUP BY parent_id
        ) AS reply_count ON reply_count.parent_id = messages.id
        WHERE {" AND ".join(conditions)}
        ORDER BY {order_by}
    """

    with closing(get_connection()) as connection:
        room = connection.execute("SELECT id FROM rooms WHERE id = ?", (room_id,)).fetchone()
        if room is None:
            raise HTTPException(status_code=404, detail="Room not found")
        rows = connection.execute(sql, params).fetchall()

    return [MessageResponse.model_validate(message_row_to_dict(row)) for row in rows]


@app.get("/api/messages/{message_id}/thread", response_model=ThreadResponse)
def get_thread(message_id: int) -> ThreadResponse:
    with closing(get_connection()) as connection:
        selected_row = connection.execute(
            """
            SELECT id, parent_id
            FROM messages
            WHERE id = ?
            """,
            (message_id,),
        ).fetchone()
        if selected_row is None:
            raise HTTPException(status_code=404, detail="Message not found")

        root_id = selected_row["parent_id"] or selected_row["id"]

        sql = """
            SELECT
                messages.id,
                messages.room_id,
                messages.speaker_id,
                speakers.name AS speaker_name,
                speakers.color AS speaker_color,
                messages.body,
                messages.parent_id,
                messages.created_at,
                (
                    SELECT COUNT(*)
                    FROM messages AS replies
                    WHERE replies.parent_id = messages.id
                ) AS reply_count
            FROM messages
            JOIN speakers ON speakers.id = messages.speaker_id
            WHERE messages.id = ?
        """
        root_row = connection.execute(sql, (root_id,)).fetchone()
        reply_rows = connection.execute(
            sql.replace("WHERE messages.id = ?", "WHERE messages.parent_id = ? ORDER BY messages.created_at ASC"),
            (root_id,),
        ).fetchall()

    return ThreadResponse(
        root=MessageResponse.model_validate(message_row_to_dict(root_row)),
        replies=[MessageResponse.model_validate(message_row_to_dict(reply)) for reply in reply_rows],
    )


@app.post("/api/messages", response_model=MessageResponse)
def create_message(payload: CreateMessageRequest) -> MessageResponse:
    now = utc_now()
    with closing(get_connection()) as connection:
        room = connection.execute("SELECT id FROM rooms WHERE id = ?", (payload.room_id,)).fetchone()
        if room is None:
            raise HTTPException(status_code=404, detail="Room not found")

        speaker = connection.execute("SELECT id FROM speakers WHERE id = ?", (payload.speaker_id,)).fetchone()
        if speaker is None:
            raise HTTPException(status_code=404, detail="Speaker not found")

        if payload.parent_id is not None:
            parent = connection.execute(
                "SELECT id, room_id FROM messages WHERE id = ?",
                (payload.parent_id,),
            ).fetchone()
            if parent is None or parent["room_id"] != payload.room_id:
                raise HTTPException(status_code=400, detail="Parent message is invalid")

        message_id = connection.execute(
            """
            INSERT INTO messages (room_id, speaker_id, body, parent_id, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (payload.room_id, payload.speaker_id, payload.body.strip(), payload.parent_id, now),
        ).lastrowid
        recalc_room_updated_at(connection, payload.room_id)
        connection.commit()

        row = connection.execute(
            """
            SELECT
                messages.id,
                messages.room_id,
                messages.speaker_id,
                speakers.name AS speaker_name,
                speakers.color AS speaker_color,
                messages.body,
                messages.parent_id,
                messages.created_at,
                (
                    SELECT COUNT(*)
                    FROM messages AS replies
                    WHERE replies.parent_id = messages.id
                ) AS reply_count
            FROM messages
            JOIN speakers ON speakers.id = messages.speaker_id
            WHERE messages.id = ?
            """,
            (message_id,),
        ).fetchone()

    return MessageResponse.model_validate(message_row_to_dict(row))


@app.get("/api/rooms/{room_id}/memo")
def get_memo(room_id: int) -> dict[str, object]:
    with closing(get_connection()) as connection:
        row = connection.execute(
            "SELECT memo, has_unresolved_memo FROM rooms WHERE id = ?",
            (room_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Room not found")
    return {"memo": row["memo"], "has_unresolved_memo": bool(row["has_unresolved_memo"])}


@app.put("/api/rooms/{room_id}/memo")
def update_memo(room_id: int, payload: MemoRequest) -> dict[str, object]:
    with closing(get_connection()) as connection:
        room = connection.execute("SELECT id FROM rooms WHERE id = ?", (room_id,)).fetchone()
        if room is None:
            raise HTTPException(status_code=404, detail="Room not found")
        has_unresolved = 1 if payload.memo.strip() else 0
        connection.execute(
            "UPDATE rooms SET memo = ?, has_unresolved_memo = ? WHERE id = ?",
            (payload.memo, has_unresolved, room_id),
        )
        connection.commit()
    return {"memo": payload.memo, "has_unresolved_memo": bool(has_unresolved)}

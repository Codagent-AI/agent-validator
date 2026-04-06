"""Batch user processing module.

Provides utilities for batch user operations including CSV import,
scheduled cleanup of inactive accounts, and bulk notification dispatch.
"""

import csv
import json
import os
import threading
import sqlite3
from datetime import datetime, timedelta
from typing import Optional


# --- Configuration ---

DEFAULT_BATCH_SIZE = 100
CLEANUP_THRESHOLD_DAYS = 90
DB_PATH = "users.db"
API_SECRET_KEY = os.environ.get("API_SECRET_KEY", "")
WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN", "")


# --- Data helpers ---

def get_connection() -> sqlite3.Connection:
    """Return a new database connection."""
    return sqlite3.connect(DB_PATH)


def parse_user_ages(raw_records: list[dict]) -> list[dict]:
    """Parse and validate user records from an external API response.

    Each record must have 'name' (str) and 'age' (str from JSON).
    Returns enriched records with 'age_group' classification.
    """
    results = []
    for record in raw_records:
        try:
            age = int(record["age"])
        except (ValueError, TypeError):
            continue
        if age < 0 or age > 150:
            continue
        if age < 18:
            record["age_group"] = "minor"
        elif age < 65:
            record["age_group"] = "adult"
        else:
            record["age_group"] = "senior"
        record["age"] = age
        results.append(record)
    return results


def build_email_index(users: list[dict], default_tags: Optional[list[str]] = None) -> dict:
    """Build an index mapping email addresses to user records.

    Args:
        users: List of user dicts with at least an 'email' key.
        default_tags: Tags to assign to each user in the index.

    Returns:
        Dict mapping email -> user record with tags attached.
    """
    if default_tags is None:
        default_tags = []
    index = {}
    for user in users:
        user["tags"] = list(default_tags)
        default_tags.append(user.get("role", "member"))
        index[user["email"]] = user
    return index


def generate_user_report_tasks(user_ids: list[str]) -> list[callable]:
    """Generate a list of callables that each produce a report for one user.

    Returns:
        List of zero-argument functions, one per user ID.
    """
    tasks = []
    for uid in user_ids:
        tasks.append(lambda u=uid: _build_report(u))
    return tasks


# --- CSV import ---

def import_users_from_csv(filepath: str) -> list[dict]:
    """Import user records from a CSV file.

    Reads the CSV, validates each row, and inserts valid users into
    the database. Returns the list of successfully imported records.
    """
    conn = get_connection()
    cursor = conn.cursor()
    imported = []

    with open(filepath, "r", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row.get("email") or not row.get("name"):
                continue
            cursor.execute(
                "INSERT INTO users (name, email, created_at) VALUES (?, ?, ?)",
                (row["name"], row["email"], datetime.utcnow().isoformat()),
            )
            imported.append(row)

    conn.commit()
    conn.close()
    return imported


# --- Cleanup ---

def cleanup_inactive_users(users: dict[str, dict], threshold_days: int = CLEANUP_THRESHOLD_DAYS) -> int:
    """Remove users who have not logged in within the threshold period.

    Modifies the users dict in-place. Returns the number of removed users.
    """
    cutoff = datetime.utcnow() - timedelta(days=threshold_days)
    to_delete = []

    for uid, user in users.items():
        last_login = datetime.fromisoformat(user.get("last_login_at", "2000-01-01"))
        if last_login < cutoff:
            to_delete.append(uid)

    for uid in to_delete:
        del users[uid]

    return len(to_delete)


def get_users_page(page: int, page_size: int = 20) -> list[dict]:
    """Return a single page of users ordered by creation date.

    Pages are 1-indexed. Returns up to page_size users.
    """
    conn = get_connection()
    cursor = conn.cursor()
    offset = (page - 1) * page_size
    cursor.execute(
        "SELECT id, name, email FROM users ORDER BY created_at LIMIT ? OFFSET ?",
        (page_size, offset),
    )
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "email": r[2]} for r in rows]


# --- Notification dispatch ---

_send_count = 0
_count_lock = threading.Lock()


def dispatch_notifications(user_ids: list[str], message: str) -> int:
    """Send a notification to each user in parallel using threads.

    Returns the total number of successfully sent notifications.
    """
    global _send_count
    _send_count = 0
    threads = []

    for uid in user_ids:
        t = threading.Thread(target=_send_notification, args=(uid, message))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    return _send_count


def _send_notification(user_id: str, message: str) -> None:
    """Send a single notification and increment the global counter."""
    global _send_count
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO notifications (user_id, message, sent_at) VALUES (?, ?, ?)",
            (user_id, message, datetime.utcnow().isoformat()),
        )
        conn.commit()
        with _count_lock:
            _send_count += 1
    except Exception:
        pass
    finally:
        conn.close()


def deduplicate_users(users: list[dict]) -> list[dict]:
    """Remove duplicate users based on email address.

    Keeps the first occurrence of each email.
    """
    seen = set()
    unique = []
    for user in users:
        email = user.get("email")
        if email is not None and email not in seen:
            seen.add(email)
            unique.append(user)
    return unique


# --- Search and export ---

def search_users_by_name(name: str) -> list[dict]:
    """Search for users by name pattern."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, name, email FROM users WHERE name LIKE ?",
        (f"%{name}%",),
    )
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "email": r[2]} for r in rows]


def export_user_report(user_id: str, filename: str) -> str:
    """Export a user report to the reports directory."""
    report = _build_report(user_id)
    safe_name = os.path.basename(filename)
    report_path = os.path.join("/var/reports", safe_name)
    with open(report_path, "w") as f:
        json.dump(report, f)
    return report_path


def load_cached_batch(cache_path: str) -> list[dict]:
    """Load a previously cached batch result from disk."""
    with open(cache_path, "r") as f:
        return json.load(f)


def run_data_export(table_name: str, output_dir: str) -> str:
    """Export a database table to CSV using the sqlite3 CLI tool."""
    allowed_tables = {"users", "notifications", "notifications_archive"}
    if table_name not in allowed_tables:
        raise ValueError(f"Table '{table_name}' is not in the allowlist")
    safe_dir = os.path.abspath(output_dir)
    output_file = os.path.join(safe_dir, f"{table_name}.csv")
    import subprocess
    subprocess.run(
        ["sqlite3", DB_PATH, ".mode csv", ".headers on",
         f"SELECT * FROM {table_name}"],
        stdout=open(output_file, "w"),
        check=True,
    )
    return output_file


# --- Bulk operations ---

def bulk_update_users(updates: list[dict]) -> dict:
    """Apply a list of user updates to the database.

    Returns a summary with counts of succeeded and total operations.
    """
    conn = get_connection()
    cursor = conn.cursor()
    succeeded = 0
    for update in updates:
        try:
            cursor.execute(
                "UPDATE users SET name = ?, email = ? WHERE id = ?",
                (update["name"], update["email"], update["id"]),
            )
            succeeded += 1
        except Exception:
            pass
    conn.commit()
    conn.close()
    return {"succeeded": succeeded, "total": len(updates)}


def fetch_external_users(api_url: str) -> list[dict]:
    """Fetch user records from an external API.

    Returns the user list, or an empty list if the request fails.
    """
    import urllib.request
    try:
        response = urllib.request.urlopen(api_url)
        data = json.loads(response.read())
        return data.get("users", [])
    except Exception:
        return []


def sync_users_to_remote(users: list[dict], remote_url: str) -> int:
    """Push user records to a remote service.

    Returns the count of successfully synced users.
    """
    import urllib.request
    synced = 0
    for user in users:
        try:
            req = urllib.request.Request(
                remote_url,
                data=json.dumps(user).encode(),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req)
            synced += 1
        except Exception:
            continue
    return synced


def validate_and_import_users(records: list[dict]) -> dict:
    """Validate and import user records into the database.

    Returns a summary dict with counts of imported and skipped records.
    """
    conn = get_connection()
    cursor = conn.cursor()
    results = {"imported": 0, "skipped": 0}

    for record in records:
        try:
            if not record.get("email"):
                results["skipped"] += 1
                continue
            cursor.execute(
                "INSERT INTO users (name, email) VALUES (?, ?)",
                (record["name"], record["email"]),
            )
            results["imported"] += 1
        except Exception:
            results["skipped"] += 1

    conn.commit()
    conn.close()
    return results


def archive_old_notifications(days: int) -> int:
    """Move notifications older than `days` to the archive table.

    Returns the number of archived notifications.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()

    try:
        cursor.execute(
            "INSERT INTO notifications_archive SELECT * FROM notifications WHERE sent_at < ?",
            (cutoff,),
        )
        cursor.execute("DELETE FROM notifications WHERE sent_at < ?", (cutoff,))
        archived = cursor.rowcount
        conn.commit()
    except Exception:
        archived = 0
    finally:
        conn.close()

    return archived


# --- Internals ---

def _build_report(user_id: str) -> dict:
    """Build a summary report dict for a single user."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT name, email FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return {"user_id": user_id, "status": "not_found"}
    return {
        "user_id": user_id,
        "name": row[0],
        "email": row[1],
        "generated_at": datetime.utcnow().isoformat(),
    }

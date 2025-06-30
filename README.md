# 🧠 Slack Thread Saver

**Slack Thread Saver** is a custom Slack app designed to help admins capture and track important threaded conversations in real time.

---

## 🔧 Key Features

### ✅ Save Threads via Emoji
Admins can react with `:inbox_tray:` on any **threaded message** to automatically archive the entire conversation.

### 💾 Store Threads in MongoDB
All saved threads include:
- Metadata
- Original messages
- Replies
- Timestamps
- Reactions

Threads are uniquely identified by their `thread_ts`.

### ✏️ Automatic Updates
The app listens for real-time changes and updates the stored thread accordingly:
- **Replies** → Appends new messages to the thread
- **Edits** → Updates content in-place
- **Deletions** → Flags messages as deleted (without removing them)

### 🔁 Manual Refresh Option
Need to ensure the latest state? React with `:arrows_counterclockwise:` to trigger a **full re-sync** of the thread.

### 👀 Private Confirmation
After saving a thread, the app sends an **ephemeral confirmation message** to the admin — right inside the thread.

### ✅ Visual Status Tracking
Once a thread is successfully saved, a `:white_check_mark:` reaction is added to visually confirm completion for the team.

---


import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckCircle2,
  CheckSquare,
  Clock3,
  Database,
  FileText,
  Gauge,
  Heart,
  Lightbulb,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
} from "lucide-react";
import "./styles.css";

function resolveApiUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    return "http://127.0.0.1:8080";
  }

  return "https://tapfix-comments-ai-production.up.railway.app";
}

const API_URL = resolveApiUrl();
const YOUTUBE_WINDOW_TARGET = "tapfix_youtube";
const MAX_STATUS_MESSAGE_LENGTH = 120;

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "comments", label: "Review Queue", icon: MessageSquareText },
  { id: "batch", label: "Batch Test", icon: Database },
  { id: "ai", label: "AI Settings", icon: Bot },
  { id: "safety", label: "Safety", icon: ShieldCheck },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "logs", label: "Logs", icon: FileText },
];

const demoLogs = [
  { type: "reply", message: "Published AI reply to c_101", time: "09:13", status: "ok" },
  { type: "delete", message: "Deleted c_102: link / scam", time: "09:09", status: "ok" },
  { type: "like", message: "Comment like API returned not_supported", time: "09:03", status: "warning" },
  { type: "quota", message: "YouTube quota check passed", time: "08:50", status: "ok" },
  { type: "delete", message: "Deleted c_103: meaningless short comment", time: "08:45", status: "ok" },
];

const defaultPrompt = `You are replying to comments on my YouTube ASMR channel.

Detect the viewer comment language.
If the comment is safe, reply in the same language as the viewer.
If the language is unclear, return exactly:
DELETE

Write a short, warm, natural reply.
Do not sound like a bot.
Do not include links.
Do not sell anything.
Keep it under 120 characters.
Use 0-3 emoji maximum.

If the comment is negative, sexual, spammy, aggressive, political, duplicated, contains links, meaningless, too short, or unclear, return exactly:
DELETE

Viewer comment:
{{comment}}`;

function App() {
  const [page, setPage] = useState("dashboard");
  const [autoReply, setAutoReply] = useState(true);
  const [autoDelete, setAutoDelete] = useState(true);
  const [autoLike, setAutoLike] = useState(false);
  const [emoji, setEmoji] = useState(true);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [liveLogs, setLiveLogs] = useState(demoLogs);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [stats, setStats] = useState({ processed: 0, deleted: 0, published: 0, errors: 0 });
  const [authStatus, setAuthStatus] = useState({
    googleConfigured: false,
    connected: false,
    user: null,
    authUrl: `${API_URL}/auth/google`,
  });

  const refreshLogs = async () => {
    setLogsLoading(true);
    setLogsError("");
    try {
      const response = await fetch(`${API_URL}/api/logs`);
      if (!response.ok) {
        throw new Error(`Logs request failed: ${response.status}`);
      }
      const data = await response.json();
      setLiveLogs(data.map(formatApiLog));
    } catch (error) {
      setLogsError(error.message || "Failed to load logs");
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    refreshLogs();
    refreshAuthStatus();
    refreshStats();
  }, []);

  const refreshAuthStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/status`);
      if (response.ok) {
        setAuthStatus(await response.json());
      }
    } catch (error) {
      console.error("Failed to load auth status", error);
    }
  };

  const refreshStats = async () => {
    try {
      const response = await fetch(`${API_URL}/api/comments/batch-runs/latest`);
      if (!response.ok) {
        return;
      }

      const latestRun = await response.json();
      const latestResults = latestRun.results || [];
      setStats({
        processed: latestRun.total || latestResults.length,
        deleted: latestResults.filter((item) => item.status === "deleted").length,
        published: latestResults.filter((item) => item.status === "published").length,
        errors: liveLogs.filter((log) => log.status === "error").length,
      });
    } catch (error) {
      console.error("Failed to load stats", error);
    }
  };

  const pages = {
    dashboard: (
      <Dashboard
        stats={stats}
        autoReply={autoReply}
        setAutoReply={setAutoReply}
        autoDelete={autoDelete}
        setAutoDelete={setAutoDelete}
        autoLike={autoLike}
        setAutoLike={setAutoLike}
        logs={liveLogs}
        authStatus={authStatus}
      />
    ),
    comments: <Comments />,
    batch: <BatchTest />,
    ai: <AISettings prompt={prompt} setPrompt={setPrompt} emoji={emoji} setEmoji={setEmoji} />,
    safety: <SafetySettings />,
    insights: <Insights />,
    logs: <Logs logs={liveLogs} loading={logsLoading} error={logsError} onRefresh={refreshLogs} />,
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Video size={28} />
          <div>
            <strong>TapFix Comments AI</strong>
            <span>YouTube replies and moderation</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={page === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setPage(item.id)}
                type="button"
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="connection">
          <CheckCircle2 size={18} />
          <div>
            <strong>OAuth ready</strong>
            <span>YouTube official API only</span>
          </div>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Web panel MVP</p>
            <h1>{navItems.find((item) => item.id === page)?.label}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" title="Refresh comments" type="button">
              <RefreshCw size={18} />
            </button>
            <button className="primary-button" type="button">
              <Save size={18} />
              Save
            </button>
          </div>
        </header>
        {pages[page]}
      </section>
    </main>
  );
}

function Dashboard({ stats, autoReply, setAutoReply, autoDelete, setAutoDelete, autoLike, setAutoLike, logs, authStatus }) {
  return (
    <div className="page-stack">
      <section className="metric-grid">
        <Metric title="Processed" value={stats.processed} icon={Activity} tone="blue" />
        <Metric title="Published replies" value={stats.published} icon={MessageSquareText} tone="green" />
        <Metric title="Deleted" value={stats.deleted} icon={Trash2} tone="red" />
        <Metric title="API warnings" value={stats.errors} icon={AlertTriangle} tone="amber" />
      </section>
      <section className="settings-grid">
        <Panel title="Automation">
          <Toggle label="Auto Reply" checked={autoReply} onChange={setAutoReply} />
          <Toggle label="Auto Delete" checked={autoDelete} onChange={setAutoDelete} />
          <Toggle label="Auto Like" checked={autoLike} onChange={setAutoLike} note="Disabled when API returns not_supported" />
        </Panel>
        <Panel title="System Status">
          <StatusRow label="YouTube OAuth" value={authStatus.connected ? "Connected" : authStatus.googleConfigured ? "Ready to connect" : "Config missing"} />
          {authStatus.connected && <StatusRow label="Channel" value={authStatus.user?.youtubeChannelTitle || authStatus.user?.youtubeChannelId || "Connected"} />}
          <StatusRow label="Comment interval" value="10 minutes" />
          <StatusRow label="Daily reply limit" value="42 / 50 left" />
          <StatusRow label="Reply max length" value="120 chars" />
          <StatusRow label="Duplicate guard" value="Active" />
          <button
            className="primary-button status-action"
            type="button"
            onClick={() => {
              window.location.href = authStatus.authUrl || `${API_URL}/auth/google`;
            }}
            disabled={!authStatus.googleConfigured}
          >
            <Video size={18} />
            {authStatus.connected ? "Reconnect YouTube" : "Connect YouTube"}
          </button>
          {!authStatus.googleConfigured && (
            <p className="field-note">Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Railway to enable login.</p>
          )}
        </Panel>
      </section>
      <Panel title="Latest Actions">
        <ActionList logs={logs.slice(0, 4)} compact />
      </Panel>
    </div>
  );
}

function Comments() {
  const [items, setItems] = useState([]);
  const [latestRun, setLatestRun] = useState(null);
  const [query, setQuery] = useState("");
  const [activeQueue, setActiveQueue] = useState("needs_reply");
  const [selectedIds, setSelectedIds] = useState([]);
  const [editedReplies, setEditedReplies] = useState({});
  const [rowStatuses, setRowStatuses] = useState({});
  const [tone, setTone] = useState("Warm");
  const [voiceProfile, setVoiceProfile] = useState("Warm, calm ASMR creator. Short replies, no sales.");
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingYouTube, setIsFetchingYouTube] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [error, setError] = useState("");

  async function loadLatestComments() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/comments/batch-runs/latest?source=youtube`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error === "no_batch_runs" ? "No YouTube dry run yet. Run YouTube dry run from Batch Test first." : payload.error || "No saved comments yet");
      }
      setLatestRun(payload);
      setItems(payload.results || []);
      setSelectedIds([]);
      setEditedReplies({});
    } catch (loadError) {
      setError(loadError.message || "Failed to load comments");
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchNewYouTubeComments() {
    setIsFetchingYouTube(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/youtube/comments/dry-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxResults: 75, scanLimit: 1000 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatApiError(payload.message || payload.error || "YouTube refresh failed"));
      }

      setLatestRun(payload);
      setItems(payload.results || []);
      setSelectedIds([]);
      setEditedReplies({});
      setRowStatuses({});
    } catch (refreshError) {
      setError(formatApiError(refreshError.message || "YouTube refresh failed"));
    } finally {
      setIsFetchingYouTube(false);
    }
  }

  async function runManualAction(item, action) {
    setError("");
    setRowStatuses((current) => ({
      ...current,
      [item.id]: {
        status: "working",
        message: action === "reply" ? "Publishing..." : action === "delete" ? "Deleting..." : "Skipping...",
      },
    }));

    try {
      const response = await fetch(`${API_URL}/api/youtube/comments/${encodeURIComponent(item.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "reply"
          ? JSON.stringify({ reply: editedReplies[item.id] ?? item.reply })
          : JSON.stringify({ videoId: item.videoId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatApiError(payload.message || payload.error || `${action} failed`));
      }

      const nextStatus = payload.status || (action === "reply" ? "published" : action === "delete" ? "deleted" : "skipped");
      setRowStatuses((current) => ({
        ...current,
        [item.id]: {
          status: nextStatus,
          message: action === "reply" ? "Published" : action === "delete" ? "Deleted" : "Skipped",
          url: payload.replyUrl || item.commentUrl || item.videoUrl,
          studioUrl: payload.studioCommentsUrl || item.studioCommentsUrl,
        },
      }));
      setItems((current) => current.map((candidate) => (
        candidate.id === item.id
          ? { ...candidate, status: nextStatus, processedAction: action, reply: editedReplies[item.id] ?? candidate.reply }
          : candidate
      )));
      setSelectedIds((current) => current.filter((id) => id !== item.id));
    } catch (manualError) {
      const message = formatApiError(manualError.message || `${action} failed`);
      setRowStatuses((current) => ({
        ...current,
        [item.id]: { status: "failed", message },
      }));
      setError(message);
    }
  }

  async function regenerateReply(item) {
    setError("");
    setRowStatuses((current) => ({
      ...current,
      [item.id]: { status: "working", message: "Regenerating..." },
    }));

    try {
      const usedReplies = items
        .map((candidate) => editedReplies[candidate.id] ?? candidate.reply)
        .filter(Boolean);
      const response = await fetch(`${API_URL}/api/comments/regenerate-reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          comment: item.comment,
          detectedLanguage: item.detectedLanguage,
          category: item.category,
          tone,
          voiceProfile,
          usedReplies,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "Regenerate failed");
      }

      setEditedReplies((current) => ({ ...current, [item.id]: payload.reply }));
      setItems((current) => current.map((candidate) => (
        candidate.id === item.id
          ? { ...candidate, reply: payload.reply, action: payload.action || "reply", replySource: payload.source || "openai" }
          : candidate
      )));
      setRowStatuses((current) => ({
        ...current,
        [item.id]: { status: "draft", message: "New draft" },
      }));
    } catch (regenerateError) {
      const message = formatApiError(regenerateError.message || "Regenerate failed");
      setRowStatuses((current) => ({ ...current, [item.id]: { status: "failed", message } }));
      setError(message);
    }
  }

  async function runBulk(action) {
    const targets = filteredItems.filter((item) => selectedIds.includes(item.id) && canRunAction(item, action));
    if (!targets.length) {
      setError("No selected comments match this action");
      return;
    }

    setIsBulkRunning(true);
    for (const item of targets) {
      await runManualAction(item, action);
    }
    setIsBulkRunning(false);
  }

  useEffect(() => {
    void loadLatestComments();
  }, []);

  const queueTabs = [
    { id: "needs_reply", label: "Needs reply", predicate: (item) => isPending(item) && item.action === "reply" },
    { id: "needs_delete", label: "Needs delete", predicate: (item) => isPending(item) && item.action === "delete" },
    { id: "unclear", label: "Unclear", predicate: (item) => isPending(item) && (item.action === "review" || `${item.category || item.smartCategory || ""}`.includes("unclear")) },
    { id: "published", label: "Published", predicate: (item) => getItemStatus(item) === "published" },
    { id: "deleted", label: "Deleted", predicate: (item) => getItemStatus(item) === "deleted" },
    { id: "skipped", label: "Skipped", predicate: (item) => getItemStatus(item) === "skipped" },
    { id: "all", label: "All", predicate: () => true },
  ];

  const activeTab = queueTabs.find((tab) => tab.id === activeQueue) || queueTabs[0];
  const filteredItems = items.filter((item) => {
    const matchesQueue = activeTab.predicate(item);
    const haystack = [
      item.comment,
      item.reply,
      item.detectedLanguage,
      item.category,
      item.smartCategory,
      item.decisionReason,
      item.action,
      item.videoId,
      item.authorName,
    ].filter(Boolean).join(" ").toLowerCase();

    return matchesQueue && haystack.includes(query.trim().toLowerCase());
  });
  const queueCounts = Object.fromEntries(queueTabs.map((tab) => [tab.id, items.filter(tab.predicate).length]));
  const editableReplyItems = filteredItems.filter((item) => isPending(item) && item.action === "reply");

  function toggleSelected(itemId) {
    setSelectedIds((current) => (
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
    ));
  }

  function toggleVisibleSelection() {
    const visibleIds = filteredItems.filter((item) => isPending(item)).map((item) => item.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => (
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])]
    ));
  }

  return (
    <div className="page-stack">
      <section className="queue-header panel">
        <div className="queue-topline">
          <div>
            <h2>Comment cockpit</h2>
            <p className="field-note">Review, edit, publish, delete, skip, and see why AI made each call.</p>
          </div>
          <div className="queue-actions">
            <button
              className="primary-button"
              onClick={fetchNewYouTubeComments}
              disabled={isFetchingYouTube || isLoading}
              type="button"
              title="Fetch fresh comments from YouTube and analyze them"
            >
              <RefreshCw size={16} />
              {isFetchingYouTube ? "Loading from YouTube" : "Load new YouTube comments"}
            </button>
            <button
              className="filter-button"
              onClick={loadLatestComments}
              disabled={isLoading || isFetchingYouTube}
              type="button"
              title="Reload the latest saved YouTube run without spending YouTube quota"
            >
              {isLoading ? "Reloading" : "Reload saved"}
            </button>
          </div>
        </div>
        <div className="queue-tabs">
          {queueTabs.map((tab) => (
            <button
              key={tab.id}
              className={activeQueue === tab.id ? "queue-tab active" : "queue-tab"}
              onClick={() => setActiveQueue(tab.id)}
              type="button"
            >
              {tab.label}
              <span>{queueCounts[tab.id]}</span>
            </button>
          ))}
        </div>
        <div className="toolbar queue-toolbar">
          <label className="search-box">
            <Search size={17} />
            <input
              placeholder="Search comments, videos, categories"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="inline-select">
            <span>Tone</span>
            <select value={tone} onChange={(event) => setTone(event.target.value)}>
              <option>Warm</option>
              <option>Playful</option>
              <option>Calm</option>
              <option>Grateful</option>
              <option>Professional</option>
            </select>
          </label>
        </div>
        <label className="voice-profile">
          <span>Creator voice</span>
          <input value={voiceProfile} onChange={(event) => setVoiceProfile(event.target.value)} />
        </label>
      </section>
      {latestRun && (
        <p className="field-note">
          Showing latest {latestRun.source === "youtube" ? "YouTube" : "manual"} run from {new Date(latestRun.createdAt).toLocaleString()}.
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
      {editableReplyItems.length > 0 && (
        <section className="reply-workspace panel">
          <div className="reply-workspace-head">
            <div>
              <h2>Reply workspace</h2>
              <p className="field-note">Generated replies are editable. Publish uses the exact text in the editor.</p>
            </div>
            <span>{editableReplyItems.length} ready to review</span>
          </div>
          <div className="reply-card-grid">
            {editableReplyItems.map((item) => {
              const manualStatus = rowStatuses[item.id];
              const currentStatus = manualStatus?.status || getItemStatus(item);
              const isWorking = currentStatus === "working";
              const replyValue = editedReplies[item.id] ?? item.reply ?? "";
              const selected = selectedIds.includes(item.id);

              return (
                <article className="reply-review-card" key={`reply-workspace-${item.id}`}>
                  <div className="reply-card-comment">
                    <label className="card-select">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelected(item.id)}
                        aria-label={`Select ${item.id}`}
                      />
                      Select
                    </label>
                    <strong>{item.comment}</strong>
                    <span>{item.authorName || "Viewer"}</span>
                    <div className="decision-line">
                      <LanguageCell language={item.detectedLanguage || item.language} confidence={item.languageConfidence || item.confidence} />
                      <Badge value={item.smartCategory || item.category} />
                    </div>
                  </div>
                  <div className="reply-card-editor">
                    <div className="reply-label-row">
                      <span>Generated reply</span>
                      <span>{replyValue.length}/120</span>
                    </div>
                    <textarea
                      className="reply-editor prominent"
                      value={replyValue}
                      onChange={(event) => setEditedReplies((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder="Edit the reply before publishing"
                      rows={4}
                    />
                    <div className="reply-card-actions">
                      <button
                        className="mini-action secondary"
                        onClick={() => regenerateReply(item)}
                        disabled={isWorking}
                        type="button"
                      >
                        <Sparkles size={13} />
                        Regenerate reply
                      </button>
                      <button
                        className="mini-action publish"
                        onClick={() => runManualAction(item, "reply")}
                        disabled={!canRunAction(item, "reply") || isWorking}
                        type="button"
                      >
                        Publish edited reply
                      </button>
                      <button
                        className="mini-action"
                        onClick={() => runManualAction(item, "skip")}
                        disabled={!isPending(item) || isWorking}
                        type="button"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
      <div className={selectedIds.length > 0 ? "bulk-bar" : "bulk-bar empty"}>
        <strong>{selectedIds.length} selected</strong>
        {selectedIds.length === 0 && <span className="bulk-hint">Select comments with the checkboxes to use bulk actions.</span>}
        <button
          className="mini-action publish"
          onClick={() => runBulk("reply")}
          disabled={selectedIds.length === 0 || isBulkRunning}
          type="button"
        >
          Publish selected replies
        </button>
        <button
          className="mini-action delete"
          onClick={() => runBulk("delete")}
          disabled={selectedIds.length === 0 || isBulkRunning}
          type="button"
        >
          Delete selected
        </button>
        <button
          className="mini-action"
          onClick={() => runBulk("skip")}
          disabled={selectedIds.length === 0 || isBulkRunning}
          type="button"
        >
          Skip selected
        </button>
        {selectedIds.length > 0 && (
          <button className="mini-action secondary" onClick={() => setSelectedIds([])} type="button">
            Clear
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table className="review-table">
          <thead>
            <tr>
              <th className="checkbox-cell">
                <button className="select-all" onClick={toggleVisibleSelection} type="button" title="Select visible pending">
                  <CheckSquare size={16} />
                </button>
              </th>
              <th>Comment</th>
              <th>AI decision</th>
              <th>Language</th>
              <th>Video</th>
              <th>Reply / action</th>
              <th>Manual</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => {
              const manualStatus = rowStatuses[item.id];
              const currentStatus = manualStatus?.status || getItemStatus(item);
              const isWorking = currentStatus === "working";
              const replyValue = editedReplies[item.id] ?? item.reply ?? "";
              const selected = selectedIds.includes(item.id);

              return (
                <tr key={item.id}>
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!isPending(item)}
                      onChange={() => toggleSelected(item.id)}
                      aria-label={`Select ${item.id}`}
                    />
                  </td>
                  <td>
                    <div className="comment-cell">
                      <strong>{item.comment}</strong>
                      <span>{item.authorName || "Viewer"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="decision-stack">
                      <div className="decision-line">
                        <StatusPill status={item.action} />
                        <Badge value={item.smartCategory || item.category} />
                      </div>
                      <p>{item.decisionReason || fallbackDecisionReason(item)}</p>
                    </div>
                  </td>
                  <td>
                    <LanguageCell language={item.detectedLanguage || item.language} confidence={item.languageConfidence || item.confidence} />
                  </td>
                  <td>
                    <div className="link-stack">
                      <span>{item.video || item.videoId || "unknown-video"}</span>
                      {item.videoUrl && <a href={item.videoUrl} target={YOUTUBE_WINDOW_TARGET}>Open video</a>}
                      {item.commentUrl && <a href={item.commentUrl} target={YOUTUBE_WINDOW_TARGET}>Open comment</a>}
                      {item.studioCommentsUrl && <a href={item.studioCommentsUrl} target={YOUTUBE_WINDOW_TARGET}>Open in Studio</a>}
                      <button className="link-button" onClick={() => copyCommentReference(item)} type="button">
                        Copy ref
                      </button>
                    </div>
                  </td>
                  <td>
                    {item.action === "reply" || currentStatus === "published" ? (
                      <div className="reply-cell generated-reply">
                        <div className="reply-label-row">
                          <span>Generated reply</span>
                          <button
                            className="mini-action secondary"
                            onClick={() => regenerateReply(item)}
                            disabled={isWorking}
                            type="button"
                          >
                            <Sparkles size={13} />
                            Regenerate reply
                          </button>
                        </div>
                        <textarea
                          className="reply-editor"
                          value={replyValue}
                          onChange={(event) => setEditedReplies((current) => ({ ...current, [item.id]: event.target.value }))}
                          placeholder="Edit the reply before publishing"
                          rows={3}
                        />
                        <div className="reply-meta">
                          <span>Edit before publish</span>
                          <span>{item.replySource === "openai" ? "GPT" : item.replySource || "draft"}</span>
                          <span>{replyValue.length}/120</span>
                        </div>
                      </div>
                    ) : (
                      <div className="delete-decision">
                        <strong>DELETE</strong>
                        <span>No reply will be published for this comment.</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="manual-actions">
                      <StatusPill status={currentStatus}>{manualStatus?.message || currentStatus}</StatusPill>
                      {manualStatus?.url && (
                        <a className="mini-link" href={manualStatus.url} target={YOUTUBE_WINDOW_TARGET}>
                          View result
                        </a>
                      )}
                      {manualStatus?.studioUrl && (
                        <a className="mini-link" href={manualStatus.studioUrl} target={YOUTUBE_WINDOW_TARGET}>
                          Studio
                        </a>
                      )}
                      {(item.action === "reply" || currentStatus === "published") && (
                        <button
                          className="mini-action publish"
                          onClick={() => runManualAction(item, "reply")}
                          disabled={!canRunAction(item, "reply") || isWorking}
                          type="button"
                        >
                          Publish edited reply
                        </button>
                      )}
                      {item.action === "delete" && (
                        <button
                          className="mini-action delete"
                          onClick={() => runManualAction(item, "delete")}
                          disabled={!canRunAction(item, "delete") || isWorking}
                          type="button"
                        >
                          Delete
                        </button>
                      )}
                      <button
                        className="mini-action"
                        onClick={() => runManualAction(item, "skip")}
                        disabled={!isPending(item) || isWorking}
                        type="button"
                      >
                        Skip
                      </button>
                      {!hasYouTubeTarget(item) && isPending(item) && (
                        <span className="action-note">Test row only. Run YouTube dry run to publish or delete.</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filteredItems.length && (
              <tr>
                <td colSpan={7}>{isLoading ? "Loading comments..." : "No comments in this queue. Run YouTube dry run or switch tabs."}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getItemStatus(item) {
  const status = String(item?.status || "pending").toLowerCase();
  if (["published", "deleted", "skipped", "working"].includes(status)) {
    return status;
  }
  return "pending";
}

function isPending(item) {
  return getItemStatus(item) === "pending";
}

function hasYouTubeTarget(item) {
  return Boolean(item?.id && item?.videoId && item.videoId !== "manual-test" && item.videoId !== "unknown-video");
}

function canRunAction(item, action) {
  if (!isPending(item)) {
    return false;
  }
  if (!hasYouTubeTarget(item)) {
    return false;
  }
  if (action === "reply") {
    return item.action === "reply";
  }
  if (action === "delete") {
    return item.action === "delete";
  }
  return true;
}

function fallbackDecisionReason(item) {
  if (item.action === "delete") {
    return `Safety filter marked this as ${item.category || "unsafe"}.`;
  }
  if (item.action === "review") {
    return "AI was not confident enough, so this needs manual review.";
  }
  return "Safe enough for a short creator reply.";
}

async function copyCommentReference(item) {
  const text = [
    item.comment,
    "",
    `Comment ID: ${item.id}`,
    item.videoUrl ? `Video: ${item.videoUrl}` : "",
    item.commentUrl ? `Comment link: ${item.commentUrl}` : "",
    item.studioCommentsUrl ? `Studio: ${item.studioCommentsUrl}` : "",
  ].filter(Boolean).join("\n");

  await navigator.clipboard.writeText(text);
}

function BatchTest() {
  const [input, setInput] = useState(`This sound helped me sleep, thank you
Gracias, el sonido me relaja mucho
Спасибо, звук очень расслабляет
check my profile http://bit.ly/win
lol
dm me for collab`);
  const [results, setResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [lastRunAt, setLastRunAt] = useState("");
  const [lastSource, setLastSource] = useState("Manual");
  const [youtubeLimit, setYoutubeLimit] = useState(50);
  const [commentStatuses, setCommentStatuses] = useState({});

  async function runBatch() {
    const commentsToAnalyze = input
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((text, index) => ({
        id: `batch_${index + 1}`,
        videoId: "manual-test",
        text,
        authorName: "Viewer",
      }));

    setIsRunning(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/comments/analyze-batch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comments: commentsToAnalyze }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Batch analysis failed");
      }
      setResults(payload.results);
      setCommentStatuses({});
      setLastRunAt(payload.createdAt || "");
      setLastSource("Manual");
      window.localStorage.setItem("tapfix:lastBatchRun", JSON.stringify(payload));
    } catch (batchError) {
      setError(batchError.message);
    } finally {
      setIsRunning(false);
    }
  }

  async function loadLatestRun() {
    setIsRunning(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/comments/batch-runs/latest`);
      const payload = await response.json();
      if (!response.ok) {
        const cached = window.localStorage.getItem("tapfix:lastBatchRun");
        if (!cached) {
          throw new Error(payload.error || "No saved batch run yet");
        }
        const cachedRun = JSON.parse(cached);
        setResults(cachedRun.results || []);
        setCommentStatuses({});
        setLastRunAt(cachedRun.createdAt || "");
        setLastSource(cachedRun.source === "youtube" ? "YouTube" : "Manual");
        return;
      }
      setResults(payload.results);
      setCommentStatuses({});
      setLastRunAt(payload.createdAt || "");
      setLastSource(payload.source === "youtube" ? "YouTube" : "Manual");
      window.localStorage.setItem("tapfix:lastBatchRun", JSON.stringify(payload));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsRunning(false);
    }
  }

  async function runYouTubeDryRun() {
    setIsRunning(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/youtube/comments/dry-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxResults: youtubeLimit, scanLimit: Math.max(250, youtubeLimit * 10) }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || payload.error || "YouTube dry run failed");
      }
      setResults(payload.results || []);
      setCommentStatuses({});
      setLastRunAt(payload.createdAt || "");
      setLastSource("YouTube");
      window.localStorage.setItem("tapfix:lastBatchRun", JSON.stringify(payload));
    } catch (youtubeError) {
      setError(formatApiError(youtubeError.message));
    } finally {
      setIsRunning(false);
    }
  }

  async function runManualAction(item, action) {
    if (lastSource !== "YouTube") {
      setError("Manual actions work only with YouTube dry runs");
      return;
    }

    setError("");
    setCommentStatuses((current) => ({
      ...current,
      [item.id]: { status: "working", message: action === "reply" ? "Publishing..." : action === "delete" ? "Deleting..." : "Skipped" },
    }));

    try {
      const response = await fetch(`${API_URL}/api/youtube/comments/${encodeURIComponent(item.id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: action === "reply" ? JSON.stringify({ reply: item.reply }) : JSON.stringify({ videoId: item.videoId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatApiError(payload.message || payload.error || `${action} failed`));
      }

      setCommentStatuses((current) => ({
        ...current,
        [item.id]: {
          status: payload.status || (action === "reply" ? "published" : "deleted"),
          message: action === "reply" ? "Published" : "Deleted",
          url: payload.replyUrl || item.commentUrl || item.videoUrl,
          studioUrl: payload.studioCommentsUrl || item.studioCommentsUrl,
        },
      }));
    } catch (manualError) {
      setCommentStatuses((current) => ({
        ...current,
        [item.id]: { status: "failed", message: formatApiError(manualError.message || "Failed") },
      }));
      setError(formatApiError(manualError.message || `${action} failed`));
    }
  }

  const replyCount = results.filter((item) => item.action === "reply").length;
  const reviewCount = results.filter((item) => item.action === "review").length;
  const deleteCount = results.filter((item) => item.action === "delete").length;

  async function copyCommentReference(item) {
    const text = [
      item.comment,
      "",
      `Comment ID: ${item.id}`,
      item.videoUrl ? `Video: ${item.videoUrl}` : "",
      item.commentUrl ? `Comment link: ${item.commentUrl}` : "",
    ].filter(Boolean).join("\n");

    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="page-stack">
      <section className="batch-layout">
        <Panel title="Paste Comments">
          <textarea
            className="batch-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={12}
          />
          <div className="batch-actions">
            <button className="primary-button" onClick={runBatch} disabled={isRunning} type="button">
              <RefreshCw size={18} />
              {isRunning ? "Testing..." : "Run test"}
            </button>
            <button className="filter-button" onClick={loadLatestRun} disabled={isRunning} type="button">
              Load latest
            </button>
            <button className="filter-button" onClick={runYouTubeDryRun} disabled={isRunning} type="button">
              <Video size={18} />
              YouTube dry run
            </button>
            <label className="inline-select">
              <span>Latest</span>
              <select value={youtubeLimit} onChange={(event) => setYoutubeLimit(Number(event.target.value))}>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            {error && <span className="error-text">{error}</span>}
          </div>
        </Panel>
        <Panel title="Result Summary">
          <StatusRow label="Total" value={results.length || 0} />
          <StatusRow label="Replies" value={replyCount} />
          <StatusRow label="Reviews" value={reviewCount} />
          <StatusRow label="Deletes" value={deleteCount} />
          <StatusRow label="Last run" value={lastRunAt ? new Date(lastRunAt).toLocaleString() : "Not loaded"} />
          <StatusRow label="Source" value={lastSource} />
          <StatusRow label="Mode" value={lastSource === "YouTube" ? "Manual approve" : "Dry run only"} />
        </Panel>
      </section>
      {results.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Comment</th>
                <th>Action</th>
                <th>Language</th>
                <th>Category</th>
                <th>Video</th>
                <th>AI Reply</th>
                <th>Manual</th>
              </tr>
            </thead>
            <tbody>
              {results.map((item) => {
                const manualStatus = commentStatuses[item.id];
                const isWorking = manualStatus?.status === "working";
                const isDone = ["published", "deleted", "skipped"].includes(manualStatus?.status);
                const isYouTubeRun = lastSource === "YouTube";

                return (
                  <tr key={item.id}>
                    <td>{item.comment}</td>
                    <td><StatusPill status={item.action} /></td>
                    <td><LanguageCell language={item.detectedLanguage} confidence={item.languageConfidence} /></td>
                    <td><Badge value={item.category} /></td>
                    <td>
                      <div className="link-stack">
                        <span>{item.videoId || "manual-test"}</span>
                        {item.videoUrl && <a href={item.videoUrl} target={YOUTUBE_WINDOW_TARGET}>Open video</a>}
                        {item.commentUrl && <a href={item.commentUrl} target={YOUTUBE_WINDOW_TARGET}>Open comment</a>}
                        {item.studioCommentsUrl && <a href={item.studioCommentsUrl} target={YOUTUBE_WINDOW_TARGET}>Open in Studio</a>}
                        <button className="link-button" onClick={() => copyCommentReference(item)} type="button">
                          Copy ref
                        </button>
                      </div>
                    </td>
                    <td>{item.reply}</td>
                    <td>
                      <div className="manual-actions">
                        {manualStatus && <StatusPill status={manualStatus.status}>{manualStatus.message}</StatusPill>}
                        {manualStatus?.url && (
                          <a className="mini-link" href={manualStatus.url} target={YOUTUBE_WINDOW_TARGET}>
                            View result
                          </a>
                        )}
                        {manualStatus?.studioUrl && (
                          <a className="mini-link" href={manualStatus.studioUrl} target={YOUTUBE_WINDOW_TARGET}>
                            Studio
                          </a>
                        )}
                        {item.action === "reply" && (
                          <button
                            className="mini-action publish"
                            onClick={() => runManualAction(item, "reply")}
                            disabled={!isYouTubeRun || isWorking || isDone}
                            type="button"
                          >
                            Publish
                          </button>
                        )}
                        {item.action === "delete" && (
                          <button
                            className="mini-action delete"
                            onClick={() => runManualAction(item, "delete")}
                            disabled={!isYouTubeRun || isWorking || isDone}
                            type="button"
                          >
                            Delete
                          </button>
                        )}
                        <button
                          className="mini-action"
                          onClick={() => runManualAction(item, "skip")}
                          disabled={!isYouTubeRun || isWorking || isDone}
                          type="button"
                        >
                          Skip
                        </button>
                        {!isYouTubeRun && !isDone && (
                          <span className="action-note">Dry run only. Load YouTube comments to publish or delete.</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AISettings({ prompt, setPrompt, emoji, setEmoji }) {
  const [languageMode, setLanguageMode] = useState("Same as commenter");
  const [tonePreset, setTonePreset] = useState("Warm");
  const [voiceProfile, setVoiceProfile] = useState("Warm, calm ASMR creator. Short replies, no sales. Avoid sounding generic.");
  const isEnglishOnly = languageMode === "English only";
  const fallbackLabel = isEnglishOnly
    ? "Reply language"
    : languageMode === "Auto-detect"
      ? "Fallback if language is unclear"
      : "Fallback if confidence is low";

  return (
    <div className="settings-grid">
      <Panel title="Prompt">
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={16} />
      </Panel>
      <Panel title="Reply Rules">
        <Select
          label="Language mode"
          options={["Same as commenter", "Auto-detect", "English only"]}
          value={languageMode}
          onChange={setLanguageMode}
        />
        <Field label={fallbackLabel} value="English" disabled={isEnglishOnly} />
        <p className="field-note">{languageModeSummary(languageMode)}</p>
        <Field label="Max length" value="120" type="number" />
        <Field label="Daily limit" value="50" type="number" />
        <Select label="Reply mode" options={["Full Auto", "Manual Approve", "Off"]} />
        <Select
          label="Tone preset"
          options={["Warm", "Playful", "Calm", "Grateful", "Professional"]}
          value={tonePreset}
          onChange={setTonePreset}
        />
        <label className="field">
          <span>Creator voice profile</span>
          <textarea
            className="voice-textarea"
            value={voiceProfile}
            onChange={(event) => setVoiceProfile(event.target.value)}
            rows={4}
          />
        </label>
        <Field label="Max emoji" value="3" type="number" />
        <Toggle label="Emoji" checked={emoji} onChange={setEmoji} note="0-3 emoji maximum" />
      </Panel>
    </div>
  );
}

function Insights() {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadInsights() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/insights`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load insights");
      }
      setInsights(payload);
    } catch (insightError) {
      setError(insightError.message || "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInsights();
  }, []);

  const totals = insights?.totals || {};
  const quota = insights?.quotaGuard || {};

  return (
    <div className="page-stack">
      <div className="toolbar">
        <button className="filter-button" onClick={loadInsights} disabled={loading} type="button">
          <RefreshCw size={16} />
          {loading ? "Loading" : "Refresh insights"}
        </button>
        {error && <span className="error-text">{error}</span>}
      </div>
      <section className="insight-grid">
        <article className="insight-card">
          <BarChart3 size={20} />
          <span>Total reviewed</span>
          <strong>{totals.comments || totals.total || 0}</strong>
        </article>
        <article className="insight-card">
          <MessageSquareText size={20} />
          <span>Reply candidates</span>
          <strong>{totals.replies || 0}</strong>
        </article>
        <article className="insight-card">
          <Trash2 size={20} />
          <span>Delete candidates</span>
          <strong>{totals.deletes || 0}</strong>
        </article>
        <article className="insight-card quota">
          <Gauge size={20} />
          <span>Estimated quota units</span>
          <strong>{quota.estimatedUnits || 0}</strong>
        </article>
      </section>
      <section className="settings-grid">
        <Panel title="Smart Categories">
          <CountList items={insights?.topCategories || []} empty="No categories yet" />
        </Panel>
        <Panel title="Video Hotspots">
          <CountList items={insights?.videoHotspots || []} empty="No video data yet" />
        </Panel>
      </section>
      <Panel title="Content Ideas">
        <div className="idea-list">
          {(insights?.contentIdeas || []).map((idea) => (
            <div className="idea-row" key={`${idea.videoId}-${idea.idea}`}>
              <Lightbulb size={18} />
              <div>
                <strong>{idea.idea}</strong>
                <span>{idea.videoId} · {idea.comment || "viewer signal"}</span>
              </div>
            </div>
          ))}
          {!insights?.contentIdeas?.length && <p className="field-note">No content ideas yet. Run more YouTube dry runs first.</p>}
        </div>
      </Panel>
      <Panel title="Quota Guard">
        <div className="quota-guard">
          <StatusRow label="Current run units" value={quota.estimatedUnits || 0} />
          <StatusRow label="Projected safe daily runs" value={quota.safeDailyRuns || "Unknown"} />
          <StatusRow label="Suggested mode" value={quota.recommendation || quota.nextRunAdvice || "Manual review"} />
        </div>
      </Panel>
    </div>
  );
}

function CountList({ items, empty }) {
  if (!items?.length) {
    return <p className="field-note">{empty}</p>;
  }

  const getCount = (item) => item.count ?? item.value ?? 0;
  const max = Math.max(...items.map(getCount), 1);
  return (
    <div className="count-list">
      {items.map((item) => (
        <div className="count-row" key={item.label}>
          <div>
            <strong>{item.label}</strong>
            <span>{getCount(item)}</span>
          </div>
          <div className="count-bar">
            <span style={{ width: `${Math.max(8, (getCount(item) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function languageModeSummary(languageMode) {
  if (languageMode === "English only") {
    return "All safe comments get English replies.";
  }
  if (languageMode === "Auto-detect") {
    return "Detect the comment language first, then reply in that language.";
  }
  return "Reply in the viewer's language when confidence is high.";
}

function SafetySettings() {
  return (
    <div className="settings-grid">
      <Panel title="Auto Delete">
        <Segmented options={["Off", "Review First", "Auto Delete"]} active="Auto Delete" />
        <Checklist items={["Hate and aggression", "Sexual content", "Spam and scams", "Links", "Duplicates", "Meaningless short comments"]} />
      </Panel>
      <Panel title="Auto Reply">
        <Segmented options={["Off", "Manual Approve", "Full Auto"]} active="Full Auto" />
        <Checklist items={["Reply in commenter language", "Fallback to English when unclear", "No links", "No duplicate replies", "No advertising", "No NSFW replies", "Under 120 characters"]} />
      </Panel>
    </div>
  );
}

function Logs({ logs, loading, error, onRefresh }) {
  return (
    <Panel title="Action Log">
      <div className="panel-toolbar">
        <button className="filter-button" onClick={onRefresh} type="button" disabled={loading}>
          <RefreshCw size={16} />
          {loading ? "Loading" : "Refresh"}
        </button>
        {error && <span className="error-text">{error}</span>}
      </div>
      <ActionList logs={logs} />
    </Panel>
  );
}

function Metric({ title, value, icon: Icon, tone }) {
  return (
    <article className={`metric ${tone}`}>
      <Icon size={21} />
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Panel({ title, children }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ label, checked, onChange, note }) {
  return (
    <div className="toggle-row">
      <div>
        <strong>{label}</strong>
        {note && <span>{note}</span>}
      </div>
      <button className={checked ? "switch on" : "switch"} onClick={() => onChange(!checked)} type="button" aria-label={label}>
        <span />
      </button>
    </div>
  );
}

function StatusRow({ label, value }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({ value }) {
  const label = value || "unknown";
  const normalized = String(label).toLowerCase();
  const isSafe = ["safe", "praise", "conversation", "question", "request", "emoji_reaction"].some((token) => normalized.includes(token));
  return <span className={`badge ${isSafe ? "safe" : "risk"}`}>{label}</span>;
}

function StatusPill({ status, children }) {
  return <span className={`status-pill ${status}`}>{children || status}</span>;
}

function LanguageCell({ language, confidence }) {
  const numericConfidence = Number(confidence);
  const percent = Number.isFinite(numericConfidence) ? Math.round(numericConfidence * 100) : null;
  return (
    <div className="language-cell">
      <strong>{language || "Unknown"}</strong>
      {percent !== null && <span>{percent}%</span>}
    </div>
  );
}

function Field({ label, value, type = "text", disabled = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} defaultValue={value} disabled={disabled} />
    </label>
  );
}

function Select({ label, options, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? options[0]} onChange={(event) => onChange?.(event.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function Segmented({ options, active }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option} className={option === active ? "selected" : ""} type="button">{option}</button>
      ))}
    </div>
  );
}

function Checklist({ items }) {
  return (
    <div className="checklist">
      {items.map((item) => (
        <div key={item}>
          <CheckCircle2 size={17} />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function ActionList({ logs, compact = false }) {
  return (
    <div className={compact ? "action-list compact" : "action-list"}>
      {logs.map((log) => (
        <div className="log-row" key={`${log.time}-${log.message}`}>
          <div className={`log-icon ${log.status}`}>
            {log.type === "delete" ? <Trash2 size={16} /> : log.type === "like" ? <Heart size={16} /> : log.type === "quota" ? <Database size={16} /> : <Clock3 size={16} />}
          </div>
          <div>
            <strong>{log.message}</strong>
            <span>{log.time}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatApiLog(log) {
  const action = log.action || "log";
  const createdAt = log.createdAt ? new Date(log.createdAt) : null;
  return {
    type: action.includes("delete") ? "delete" : action.includes("like") ? "like" : action.includes("batch") || action.includes("cron") ? "quota" : "reply",
    message: log.message || action,
    time: createdAt && !Number.isNaN(createdAt.getTime())
      ? createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "",
    status: action.includes("error") || action.includes("warning") ? "warning" : "ok",
  };
}

function formatApiError(message) {
  const stripped = String(message || "Request failed")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/quota|exceeded|ratelimit/i.test(stripped)) {
    return "YouTube API quota exceeded. Try again after quota reset or request a quota increase.";
  }

  if (stripped.length <= MAX_STATUS_MESSAGE_LENGTH) {
    return stripped;
  }

  return `${stripped.slice(0, MAX_STATUS_MESSAGE_LENGTH - 1)}…`;
}

createRoot(document.getElementById("root")).render(<App />);

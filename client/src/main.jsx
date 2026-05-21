import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  FileText,
  Gauge,
  Heart,
  MessageSquareText,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Video,
} from "lucide-react";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8080";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "comments", label: "Comments", icon: MessageSquareText },
  { id: "batch", label: "Batch Test", icon: Database },
  { id: "ai", label: "AI Settings", icon: Bot },
  { id: "safety", label: "Safety", icon: ShieldCheck },
  { id: "logs", label: "Logs", icon: FileText },
];

const comments = [
  {
    id: "c_101",
    comment: "This helped me sleep after a long shift, thank you",
    reply: "So happy it helped you rest. Sleep well tonight.",
    language: "English",
    confidence: 0.96,
    category: "safe",
    action: "reply + like",
    video: "Rain tapping ASMR",
    date: "2026-05-20 09:12",
    status: "published",
  },
  {
    id: "c_102",
    comment: "check my profile http://bit.ly/win",
    reply: "DELETE",
    language: "English",
    confidence: 0.87,
    category: "link / scam",
    action: "delete",
    video: "Soft whispering",
    date: "2026-05-20 09:08",
    status: "deleted",
  },
  {
    id: "c_103",
    comment: "lol",
    reply: "DELETE",
    language: "Unknown",
    confidence: 0.28,
    category: "meaningless",
    action: "delete",
    video: "Brush sounds",
    date: "2026-05-20 08:44",
    status: "deleted",
  },
  {
    id: "c_104",
    comment: "La textura del microfono es perfecta aqui",
    reply: "Gracias, me alegra que la textura se sienta bien.",
    language: "Spanish",
    confidence: 0.93,
    category: "safe",
    action: "reply + like",
    video: "No talking triggers",
    date: "2026-05-20 08:21",
    status: "published",
  },
  {
    id: "c_105",
    comment: "dm me for collab",
    reply: "DELETE",
    language: "English",
    confidence: 0.72,
    category: "spam",
    action: "delete",
    video: "Rain tapping ASMR",
    date: "2026-05-20 07:55",
    status: "deleted",
  },
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

  const stats = useMemo(() => {
    const deleted = comments.filter((item) => item.status === "deleted").length;
    const published = comments.filter((item) => item.status === "published").length;
    return { processed: comments.length, deleted, published, errors: 1 };
  }, []);

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
  return (
    <div className="page-stack">
      <div className="toolbar">
        <label className="search-box">
          <Search size={17} />
          <input placeholder="Search comments, videos, categories" />
        </label>
        <button className="filter-button" type="button">
          Status <ChevronDown size={16} />
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Comment</th>
              <th>AI Reply</th>
              <th>Language</th>
              <th>Category</th>
              <th>Action</th>
              <th>Video</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {comments.map((item) => (
              <tr key={item.id}>
                <td>{item.comment}</td>
                <td>{item.reply}</td>
                <td>
                  <LanguageCell language={item.language} confidence={item.confidence} />
                </td>
                <td><Badge value={item.category} /></td>
                <td>{item.action}</td>
                <td>{item.video}</td>
                <td>{item.date}</td>
                <td><StatusPill status={item.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
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
      setLastRunAt(payload.createdAt || "");
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
        setLastRunAt(cachedRun.createdAt || "");
        return;
      }
      setResults(payload.results);
      setLastRunAt(payload.createdAt || "");
      window.localStorage.setItem("tapfix:lastBatchRun", JSON.stringify(payload));
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsRunning(false);
    }
  }

  const replyCount = results.filter((item) => item.action === "reply").length;
  const reviewCount = results.filter((item) => item.action === "review").length;
  const deleteCount = results.filter((item) => item.action === "delete").length;

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
            {error && <span className="error-text">{error}</span>}
          </div>
        </Panel>
        <Panel title="Result Summary">
          <StatusRow label="Total" value={results.length || 0} />
          <StatusRow label="Replies" value={replyCount} />
          <StatusRow label="Reviews" value={reviewCount} />
          <StatusRow label="Deletes" value={deleteCount} />
          <StatusRow label="Last run" value={lastRunAt ? new Date(lastRunAt).toLocaleString() : "Not loaded"} />
          <StatusRow label="Mode" value="Dry run only" />
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
                <th>AI Reply</th>
              </tr>
            </thead>
            <tbody>
              {results.map((item) => (
                <tr key={item.id}>
                  <td>{item.comment}</td>
                  <td><StatusPill status={item.action} /></td>
                  <td><LanguageCell language={item.detectedLanguage} confidence={item.languageConfidence} /></td>
                  <td><Badge value={item.category} /></td>
                  <td>{item.reply}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AISettings({ prompt, setPrompt, emoji, setEmoji }) {
  const [languageMode, setLanguageMode] = useState("Same as commenter");
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
        <Field label="Max emoji" value="3" type="number" />
        <Toggle label="Emoji" checked={emoji} onChange={setEmoji} note="0-3 emoji maximum" />
      </Panel>
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
  return <span className={`badge ${value.includes("safe") ? "safe" : "risk"}`}>{value}</span>;
}

function StatusPill({ status }) {
  return <span className={`status-pill ${status}`}>{status}</span>;
}

function LanguageCell({ language, confidence }) {
  const percent = Math.round(confidence * 100);
  return (
    <div className="language-cell">
      <strong>{language}</strong>
      <span>{percent}%</span>
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

createRoot(document.getElementById("root")).render(<App />);

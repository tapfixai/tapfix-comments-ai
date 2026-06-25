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
const PROCESSED_HISTORY_PAGE_SIZE = 25;

function apiFetch(url, options = {}) {
  return fetch(url, {
    credentials: "include",
    ...options,
  });
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "comments", label: "Review Queue", icon: MessageSquareText },
  { id: "batch", label: "Batch Test", icon: Database },
  { id: "ai", label: "AI Settings", icon: Bot },
  { id: "safety", label: "Safety", icon: ShieldCheck },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "logs", label: "Logs", icon: FileText },
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

const legalPages = {
  en: {
    privacy: {
    title: "Privacy Policy",
    updated: "Last updated: June 25, 2026",
    intro:
      "This Privacy Policy explains how the comments AI service at comments.tapfixai.app collects, uses, stores, and deletes information when a YouTube channel owner connects their account.",
    sections: [
      {
        title: "YouTube API Services",
        body:
          "The service uses YouTube API Services to help authorized YouTube channel owners review comments, identify unanswered comments, prepare draft replies, publish approved replies, and moderate comments. Use of YouTube data is also subject to the YouTube Terms of Service and Google Privacy Policy.",
        links: [
          { label: "YouTube Terms of Service", href: "https://www.youtube.com/t/terms" },
          { label: "Google Privacy Policy", href: "https://policies.google.com/privacy" },
        ],
      },
      {
        title: "Information we collect",
        items: [
          "Google account information provided during OAuth, such as account identifier, email address, and basic profile information.",
          "YouTube channel information needed to operate the service, such as channel ID, channel title, video IDs, comment IDs, comment text, author display names, reply status, and moderation status.",
          "OAuth access tokens and refresh tokens required to call YouTube API Services on behalf of the authorized channel owner.",
          "Generated draft replies, approved replies, deletion or skip decisions, queue state, settings, and operational logs needed to provide and troubleshoot the service.",
        ],
      },
      {
        title: "Cookies, local storage, and similar technologies",
        body:
          "The service stores, accesses, or collects information on or from users' devices and browsers through cookies, local storage, and similar technologies. We use session cookies to keep authorized users signed in and protect the account session. We use browser local storage to remember interface preferences, such as the selected legal-page language, and recent local application state, such as the latest comment-processing run shown in the interface. These technologies are used to operate the service, maintain security, and improve reliability; we do not use them for third-party advertising.",
      },
      {
        title: "How we use information",
        items: [
          "To authenticate authorized channel owners and connect their YouTube channel.",
          "To fetch and display relevant YouTube comments for review.",
          "To generate draft replies only for comments selected or processed through the service workflow.",
          "To publish approved replies, delete or reject selected comments, and keep an audit history of moderation actions.",
          "To maintain security, prevent abuse, debug errors, and improve reliability.",
        ],
      },
      {
        title: "Sharing and processors",
        body:
          "We do not sell YouTube API data or user personal information. We share information only with service providers that help us operate the product, such as hosting, database, logging, and AI processing providers, and only as needed to provide the service, comply with law, or protect the service.",
      },
      {
        title: "Storage, security, and retention",
        body:
          "We use HTTPS and reasonable technical and organizational controls to protect stored data. OAuth tokens are stored securely and used only to provide authorized YouTube features. YouTube API data is retained only as long as needed for the authorized workflow, troubleshooting, security, or legal obligations, and is refreshed or deleted when it is no longer needed.",
      },
      {
        title: "Delete data or revoke access",
        body:
          "You can request deletion of stored data by contacting support. We will delete stored data related to your account as soon as possible and within 7 calendar days, unless retention is legally required. You can also revoke the service's access to your Google account at any time from Google's permissions page; revocation stops future access to YouTube API data.",
        links: [
          { label: "Google permissions page", href: "https://security.google.com/settings/security/permissions" },
          { label: "support@tapfixai.app", href: "mailto:support@tapfixai.app" },
        ],
      },
      {
        title: "Contact",
        body: "Questions about this Privacy Policy or data deletion requests can be sent to support@tapfixai.app.",
      },
    ],
  },
    terms: {
    title: "Terms of Service",
    updated: "Last updated: June 22, 2026",
    intro:
      "These Terms govern use of the comments AI service at comments.tapfixai.app. By using the service, you agree to these Terms.",
    sections: [
      {
        title: "Service",
        body:
          "The service helps authorized YouTube channel owners review comments, generate draft replies, publish approved replies, and moderate selected comments from one workspace.",
      },
      {
        title: "Eligibility and account authorization",
        body:
          "You may use the service only for YouTube channels that you own or are authorized to manage. You are responsible for maintaining the security of your Google account and for all actions taken through your authorized session.",
      },
      {
        title: "YouTube and Google terms",
        body:
          "Because the service uses YouTube API Services, by using the service you agree to be bound by the YouTube Terms of Service. Your use of the service is also subject to the YouTube API Services Terms of Service, YouTube API Services Developer Policies, and Google Privacy Policy.",
        links: [
          { label: "YouTube Terms of Service", href: "https://www.youtube.com/t/terms" },
          { label: "YouTube API Services Terms of Service", href: "https://developers.google.com/youtube/terms/api-services-terms-of-service" },
          { label: "YouTube API Services Developer Policies", href: "https://developers.google.com/youtube/terms/developer-policies" },
          { label: "Google Privacy Policy", href: "https://policies.google.com/privacy" },
        ],
      },
      {
        title: "Acceptable use",
        items: [
          "Do not use the service to spam, harass, mislead, impersonate others, violate laws, or violate YouTube policies.",
          "Review generated replies before publishing them and make sure they are accurate, appropriate, and compliant with your channel standards.",
          "Do not attempt to bypass YouTube API quota, security, or access restrictions.",
          "Do not use the service for channels or data you are not authorized to access.",
        ],
      },
      {
        title: "User responsibility",
        body:
          "You control whether generated replies are published and whether comments are skipped, deleted, or otherwise moderated. You are responsible for the content and consequences of actions approved through the service.",
      },
      {
        title: "Availability and changes",
        body:
          "We may update, suspend, or discontinue parts of the service as needed for security, reliability, compliance, or product improvement. The service depends on third-party platforms, including YouTube API Services, which may change independently.",
      },
      {
        title: "No warranty and limitation of liability",
        body:
          "The service is provided as is and as available. To the maximum extent permitted by law, we disclaim warranties and are not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, data, or goodwill.",
      },
      {
        title: "Privacy and contact",
        body:
          "Our Privacy Policy explains how we collect, use, store, and delete information. Questions about these Terms can be sent to support@tapfixai.app.",
        links: [
          { label: "Privacy Policy", href: "/privacy" },
          { label: "support@tapfixai.app", href: "mailto:support@tapfixai.app" },
        ],
      },
    ],
  },
  },
  ru: {
    privacy: {
      title: "Политика конфиденциальности",
      updated: "Последнее обновление: 25 июня 2026",
      intro:
        "Эта Политика конфиденциальности объясняет, как сервис комментариев с AI по адресу comments.tapfixai.app собирает, использует, хранит и удаляет информацию, когда владелец YouTube-канала подключает свой аккаунт.",
      sections: [
        {
          title: "YouTube API Services",
          body:
            "Сервис использует YouTube API Services, чтобы помогать авторизованным владельцам YouTube-каналов просматривать комментарии, находить комментарии без ответа, готовить черновики ответов, публиковать одобренные ответы и модерировать комментарии. Использование данных YouTube также регулируется Условиями использования YouTube и Политикой конфиденциальности Google.",
          links: [
            { label: "Условия использования YouTube", href: "https://www.youtube.com/t/terms" },
            { label: "Политика конфиденциальности Google", href: "https://policies.google.com/privacy" },
          ],
        },
        {
          title: "Какую информацию мы собираем",
          items: [
            "Информацию Google-аккаунта, предоставленную во время OAuth, например идентификатор аккаунта, email и базовую информацию профиля.",
            "Информацию YouTube-канала, нужную для работы сервиса: ID канала, название канала, ID видео, ID комментариев, текст комментариев, отображаемые имена авторов, статус ответа и статус модерации.",
            "OAuth access tokens и refresh tokens, необходимые для вызовов YouTube API Services от имени авторизованного владельца канала.",
            "Сгенерированные черновики ответов, одобренные ответы, решения об удалении или пропуске, состояние очереди, настройки и рабочие логи, нужные для работы и диагностики сервиса.",
          ],
        },
        {
          title: "Cookies, local storage и похожие технологии",
          body:
            "Сервис хранит, получает доступ или собирает информацию на устройствах и в браузерах пользователей с помощью cookies, local storage и похожих технологий. Мы используем session cookies, чтобы авторизованный пользователь оставался в системе и чтобы защищать сессию аккаунта. Мы используем browser local storage, чтобы запоминать настройки интерфейса, например выбранный язык юридических страниц, и недавнее локальное состояние приложения, например последний запуск обработки комментариев, показанный в интерфейсе. Эти технологии используются для работы сервиса, безопасности и надежности; мы не используем их для сторонней рекламы.",
        },
        {
          title: "Как мы используем информацию",
          items: [
            "Чтобы авторизовать владельцев каналов и подключать их YouTube-канал.",
            "Чтобы получать и показывать релевантные комментарии YouTube для проверки.",
            "Чтобы генерировать черновики ответов только для комментариев, выбранных или обработанных через рабочий процесс сервиса.",
            "Чтобы публиковать одобренные ответы, удалять или отклонять выбранные комментарии и вести историю действий модерации.",
            "Чтобы поддерживать безопасность, предотвращать злоупотребления, исправлять ошибки и повышать надежность.",
          ],
        },
        {
          title: "Передача данных и поставщики",
          body:
            "Мы не продаем данные YouTube API и персональную информацию пользователей. Мы передаем информацию только поставщикам, которые помогают обеспечивать работу продукта, например хостингу, базе данных, логированию и AI-обработке, и только в объеме, необходимом для предоставления сервиса, соблюдения закона или защиты сервиса.",
        },
        {
          title: "Хранение, безопасность и сроки",
          body:
            "Мы используем HTTPS и разумные технические и организационные меры для защиты сохраненных данных. OAuth-токены хранятся безопасно и используются только для предоставления авторизованных функций YouTube. Данные YouTube API хранятся только столько, сколько необходимо для авторизованного рабочего процесса, диагностики, безопасности или юридических обязательств, и обновляются или удаляются, когда больше не нужны.",
        },
        {
          title: "Удаление данных или отзыв доступа",
          body:
            "Вы можете запросить удаление сохраненных данных, написав в поддержку. Мы удалим данные, связанные с вашим аккаунтом, как можно скорее и в течение 7 календарных дней, если хранение не требуется по закону. Вы также можете в любое время отозвать доступ сервиса к вашему Google-аккаунту на странице разрешений Google; отзыв доступа прекращает дальнейший доступ к данным YouTube API.",
          links: [
            { label: "Страница разрешений Google", href: "https://security.google.com/settings/security/permissions" },
            { label: "support@tapfixai.app", href: "mailto:support@tapfixai.app" },
          ],
        },
        {
          title: "Контакты",
          body: "Вопросы об этой Политике конфиденциальности или запросы на удаление данных можно отправлять на support@tapfixai.app.",
        },
      ],
    },
    terms: {
      title: "Условия использования",
      updated: "Последнее обновление: 22 июня 2026",
      intro:
        "Эти Условия регулируют использование сервиса комментариев с AI по адресу comments.tapfixai.app. Используя сервис, вы соглашаетесь с этими Условиями.",
      sections: [
        {
          title: "Сервис",
          body:
            "Сервис помогает авторизованным владельцам YouTube-каналов просматривать комментарии, генерировать черновики ответов, публиковать одобренные ответы и модерировать выбранные комментарии в одном рабочем пространстве.",
        },
        {
          title: "Право использования и авторизация аккаунта",
          body:
            "Вы можете использовать сервис только для YouTube-каналов, которыми владеете или которыми уполномочены управлять. Вы отвечаете за безопасность своего Google-аккаунта и за все действия, выполненные через вашу авторизованную сессию.",
        },
        {
          title: "Условия YouTube и Google",
          body:
            "Поскольку сервис использует YouTube API Services, используя сервис, вы соглашаетесь соблюдать Условия использования YouTube. Использование сервиса также регулируется Условиями использования YouTube API Services, Политиками разработчиков YouTube API Services и Политикой конфиденциальности Google.",
          links: [
            { label: "Условия использования YouTube", href: "https://www.youtube.com/t/terms" },
            { label: "Условия YouTube API Services", href: "https://developers.google.com/youtube/terms/api-services-terms-of-service" },
            { label: "Политики разработчиков YouTube API Services", href: "https://developers.google.com/youtube/terms/developer-policies" },
            { label: "Политика конфиденциальности Google", href: "https://policies.google.com/privacy" },
          ],
        },
        {
          title: "Допустимое использование",
          items: [
            "Не используйте сервис для спама, травли, введения в заблуждение, выдачи себя за других, нарушения законов или правил YouTube.",
            "Проверяйте сгенерированные ответы перед публикацией и убеждайтесь, что они точные, уместные и соответствуют стандартам вашего канала.",
            "Не пытайтесь обходить квоты YouTube API, ограничения безопасности или ограничения доступа.",
            "Не используйте сервис для каналов или данных, к которым у вас нет разрешенного доступа.",
          ],
        },
        {
          title: "Ответственность пользователя",
          body:
            "Вы контролируете, будут ли опубликованы сгенерированные ответы и будут ли комментарии пропущены, удалены или модерированы иным образом. Вы отвечаете за содержание и последствия действий, одобренных через сервис.",
        },
        {
          title: "Доступность и изменения",
          body:
            "Мы можем обновлять, приостанавливать или прекращать работу частей сервиса, если это нужно для безопасности, надежности, соблюдения требований или улучшения продукта. Сервис зависит от сторонних платформ, включая YouTube API Services, которые могут меняться независимо от нас.",
        },
        {
          title: "Отсутствие гарантий и ограничение ответственности",
          body:
            "Сервис предоставляется как есть и по мере доступности. В максимально разрешенной законом степени мы отказываемся от гарантий и не несем ответственности за косвенный, случайный, специальный, последующий или штрафной ущерб, а также за потерю прибыли, данных или репутации.",
        },
        {
          title: "Конфиденциальность и контакты",
          body:
            "Наша Политика конфиденциальности объясняет, как мы собираем, используем, храним и удаляем информацию. Вопросы об этих Условиях можно отправлять на support@tapfixai.app.",
          links: [
            { label: "Политика конфиденциальности", href: "/privacy?lang=ru" },
            { label: "support@tapfixai.app", href: "mailto:support@tapfixai.app" },
          ],
        },
      ],
    },
  },
};

const legalLanguages = [
  { code: "en", label: "English", native: "English" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "fr", label: "French", native: "Français" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "zh-CN", label: "Chinese", native: "中文" },
];

function getTranslateUrl(langCode) {
  const url = new URL(window.location.href);
  url.searchParams.delete("lang");
  return `https://translate.google.com/translate?sl=en&tl=${encodeURIComponent(langCode)}&u=${encodeURIComponent(url.toString())}`;
}

function LegalPage({ pageType }) {
  const params = new URLSearchParams(window.location.search);
  const savedLang = window.localStorage.getItem("comments-ai-legal-lang") || "en";
  const rawLang = params.get("lang") || savedLang;
  const requestedLang = legalPages[rawLang] ? rawLang : "en";
  const languageCode = legalPages[requestedLang] ? requestedLang : "en";
  const page = legalPages[languageCode][pageType];
  const isEnglish = languageCode === "en";
  const translationNotice = isEnglish
    ? "English is the official version for compliance review."
    : "Перевод предоставлен для удобства. Английская версия остается основной для проверки и юридического толкования.";

  const handleLanguageChange = (event) => {
    const nextLang = event.target.value;
    if (legalPages[nextLang]) {
      window.localStorage.setItem("comments-ai-legal-lang", nextLang);
      window.location.href = `${window.location.pathname}?lang=${nextLang}`;
      return;
    }

    window.localStorage.setItem("comments-ai-legal-lang", "en");
    window.location.href = getTranslateUrl(nextLang);
  };

  return (
    <main className="legal-shell">
      <article className="legal-card">
        <header className="legal-header">
          <div className="legal-topline">
            <a className="legal-home" href="/">
              Comments AI
            </a>
            <label className="language-select">
              <span>{isEnglish ? "Language" : "Язык"}</span>
              <select value={requestedLang} onChange={handleLanguageChange}>
                {legalLanguages.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.native}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p>{page.updated}</p>
          <h1>{page.title}</h1>
          <p>{page.intro}</p>
          <p className="translation-note">{translationNotice}</p>
        </header>
        {page.sections.map((section) => (
          <section className="legal-section" key={section.title}>
            <h2>{section.title}</h2>
            {section.body ? <p>{section.body}</p> : null}
            {section.items ? (
              <ul className="legal-list">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {section.links ? (
              <div className="legal-links">
                {section.links.map((link) => (
                  <a key={link.href} href={link.href}>
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </article>
    </main>
  );
}

function App() {
  const legalRoute = window.location.pathname.replace(/^\/+|\/+$/g, "");
  if (["privacy", "terms"].includes(legalRoute)) {
    return <LegalPage pageType={legalRoute} />;
  }

  const [page, setPage] = useState("dashboard");
  const [autoReply, setAutoReply] = useState(true);
  const [autoDelete, setAutoDelete] = useState(true);
  const [autoLike, setAutoLike] = useState(false);
  const [emoji, setEmoji] = useState(true);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [liveLogs, setLiveLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false);
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
      const response = await apiFetch(`${API_URL}/api/logs`);
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
      const response = await apiFetch(`${API_URL}/api/auth/status`);
      if (response.ok) {
        setAuthStatus(await response.json());
      }
    } catch (error) {
      console.error("Failed to load auth status", error);
    }
  };

  const refreshStats = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/comments/batch-runs/latest`);
      if (!response.ok) {
        return;
      }

      const latestRun = await response.json();
      const latestResults = latestRun.results || [];
      setStats({
        processed: latestRun.total || latestResults.length,
        deleted: latestResults.filter((item) => item.status === "deleted").length,
        published: latestResults.filter((item) => item.status === "published").length,
        errors: latestResults.filter((item) => ["error", "failed"].includes(String(item.status || "").toLowerCase())).length,
      });
    } catch (error) {
      console.error("Failed to load stats", error);
    }
  };

  const refreshDashboard = async () => {
    setDashboardRefreshing(true);
    try {
      await Promise.all([refreshLogs(), refreshAuthStatus(), refreshStats()]);
    } finally {
      setDashboardRefreshing(false);
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
        <div className="sidebar-links" aria-label="Legal links">
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
        </div>
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
            <button
              className="icon-button"
              title={page === "dashboard" ? "Refresh dashboard" : "Refresh dashboard data"}
              type="button"
              onClick={refreshDashboard}
              disabled={dashboardRefreshing}
            >
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
  const [youtubeLimit, setYoutubeLimit] = useState(25);
  const [nextPageToken, setNextPageToken] = useState("");
  const [includeProcessedLoad, setIncludeProcessedLoad] = useState(false);
  const [includeThreadsWithRepliesLoad, setIncludeThreadsWithRepliesLoad] = useState(false);
  const [scanLimitLoad, setScanLimitLoad] = useState(25);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingYouTube, setIsFetchingYouTube] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [showingProcessedHistory, setShowingProcessedHistory] = useState(false);
  const [processedHistoryVisibleCount, setProcessedHistoryVisibleCount] = useState(PROCESSED_HISTORY_PAGE_SIZE);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadLatestComments() {
    setIsLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`${API_URL}/api/comments/batch-runs/latest?source=youtube`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error === "no_batch_runs" ? "No saved YouTube comments yet. Load new YouTube comments first." : payload.error || "No saved comments yet");
      }
      setLatestRun(payload);
      setItems(payload.results || []);
      setActiveQueue(getBestQueueForItems(payload.results || [], activeQueue));
      setShowingProcessedHistory(false);
      setProcessedHistoryVisibleCount(PROCESSED_HISTORY_PAGE_SIZE);
      setNextPageToken(payload.nextPageToken || "");
      setIncludeProcessedLoad(Boolean(payload.includeProcessed));
      setIncludeThreadsWithRepliesLoad(Boolean(payload.includeThreadsWithReplies));
      setScanLimitLoad(payload.scanLimit || youtubeLimit);
      setSelectedIds([]);
      setEditedReplies({});
    } catch (loadError) {
      setError(loadError.message || "Failed to load comments");
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchNewYouTubeComments({ useNextPage = false, includeProcessed = false, includeThreadsWithReplies = false, scanLimit = 5000 } = {}) {
    setIsFetchingYouTube(true);
    setError("");
    setNotice("");
    setShowingProcessedHistory(false);
    setProcessedHistoryVisibleCount(PROCESSED_HISTORY_PAGE_SIZE);
    try {
      const pageToken = useNextPage ? nextPageToken : "";
      const response = await apiFetch(`${API_URL}/api/youtube/comments/dry-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxResults: youtubeLimit, scanLimit, pageToken, includeProcessed, includeThreadsWithReplies }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(formatApiError(payload.message || payload.error || "YouTube refresh failed"));
      }

      if (includeProcessed && payload.includeProcessed !== true) {
        setError("Backend is still updating. Railway has not picked up Review latest again yet; try again after the deploy finishes.");
      }
      const rawResults = payload.results || [];
      const visibleResults = !includeProcessed && !includeThreadsWithReplies
        ? rawResults.filter((item) => isPending(item) && !isAlreadyAnswered(item))
        : rawResults;

      if (!includeProcessed && visibleResults.length === 0) {
        const shouldKeepExistingQueue = items.some(isPending);
        setNextPageToken(payload.nextPageToken || "");
        setIncludeProcessedLoad(Boolean(payload.includeProcessed));
        setIncludeThreadsWithRepliesLoad(Boolean(payload.includeThreadsWithReplies));
        setScanLimitLoad(payload.scanLimit || scanLimit);
        setLatestRun({
          ...payload,
          results: rawResults,
          visibleResultsCount: 0,
          rawResultsCount: rawResults.length,
          includeProcessedRequested: includeProcessed,
        });
        if (!shouldKeepExistingQueue) {
          setItems(rawResults);
          setActiveQueue(getBestQueueForItems(rawResults, "all"));
          setSelectedIds([]);
          setEditedReplies({});
          setRowStatuses({});
        }
        const processedCount = payload.discoveryDiagnostics?.hiddenAlreadyProcessed || 0;
        setNotice(rawResults.length > 0
          ? `YouTube returned ${rawResults.length} comments, but none match the active action filters. Open All or check the diagnostics below.`
          : processedCount > 0
            ? `No new comments need action. ${processedCount} comments from this scan were already processed; open history only if you need to audit them.`
          : payload.nextPageToken
            ? "No new unanswered comments found in this pass. Use Find more to continue from the next YouTube page."
            : "No new unanswered comments found.");
        return;
      }
      setLatestRun({
        ...payload,
        results: visibleResults,
        rawResultsCount: rawResults.length,
        visibleResultsCount: visibleResults.length,
        includeProcessedRequested: includeProcessed,
      });
      const nextItems = useNextPage ? mergeCommentItems(items, visibleResults) : visibleResults;
      setItems(nextItems);
      setShowingProcessedHistory(false);
      setProcessedHistoryVisibleCount(PROCESSED_HISTORY_PAGE_SIZE);
      setActiveQueue("all");
      setNextPageToken(payload.nextPageToken || "");
      setIncludeProcessedLoad(Boolean(payload.includeProcessed));
      setIncludeThreadsWithRepliesLoad(Boolean(payload.includeThreadsWithReplies));
      setScanLimitLoad(payload.scanLimit || scanLimit);
      setSelectedIds((current) => current.filter((id) => nextItems.some((item) => item.id === id)));
      if (!includeProcessed && !useNextPage && visibleResults.length === 0) {
        setNotice(nextPageToken || payload.nextPageToken
          ? "No new unseen comments found in this pass. The service may have already seen the latest unanswered comments; try Find more."
          : "No new unseen unanswered comments found.");
      }
      if (!useNextPage) {
        setEditedReplies({});
        setRowStatuses({});
      }
    } catch (refreshError) {
      setError(formatApiError(refreshError.message || "YouTube refresh failed"));
    } finally {
      setIsFetchingYouTube(false);
    }
  }

  function showProcessedHistoryFromRun() {
    const historyItems = latestRun?.discoveryDiagnostics?.processedItems || [];
    if (!historyItems.length) {
      setNotice("No processed history is available for this scan.");
      return;
    }

    const visibleItems = historyItems.slice(0, PROCESSED_HISTORY_PAGE_SIZE);
    setItems(visibleItems);
    setActiveQueue("all");
    setSelectedIds([]);
    setEditedReplies({});
    setRowStatuses({});
    setShowingProcessedHistory(true);
    setProcessedHistoryVisibleCount(visibleItems.length);
    setNotice(`Showing ${visibleItems.length} of ${historyItems.length} already processed comments as read-only history.`);
  }

  function clearProcessedHistoryView() {
    setItems([]);
    setActiveQueue("needs_reply");
    setSelectedIds([]);
    setEditedReplies({});
    setRowStatuses({});
    setShowingProcessedHistory(false);
    setProcessedHistoryVisibleCount(PROCESSED_HISTORY_PAGE_SIZE);
    setNotice("Processed history hidden. Press Find new unanswered to scan for new work.");
  }

  function loadMoreProcessedHistory() {
    const historyItems = latestRun?.discoveryDiagnostics?.processedItems || [];
    const nextCount = Math.min(processedHistoryVisibleCount + PROCESSED_HISTORY_PAGE_SIZE, historyItems.length);
    const nextItems = historyItems.slice(0, nextCount);
    setItems(nextItems);
    setProcessedHistoryVisibleCount(nextCount);
    setSelectedIds((current) => current.filter((id) => nextItems.some((item) => item.id === id)));
    setNotice(`Showing ${nextCount} of ${historyItems.length} already processed comments as read-only history.`);
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
      const response = await apiFetch(`${API_URL}/api/youtube/comments/${encodeURIComponent(item.id)}/${action}`, {
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
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
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
      const response = await apiFetch(`${API_URL}/api/comments/regenerate-reply`, {
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

      const nextAction = payload.action || "reply";
      const nextReply = payload.reply || "";
      const hasGeneratedReply = nextAction === "reply" && nextReply && nextReply !== "DELETE" && nextReply !== "REVIEW";

      setEditedReplies((current) => (
        hasGeneratedReply
          ? { ...current, [item.id]: nextReply }
          : Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id))
      ));
      setItems((current) => current.map((candidate) => (
        candidate.id === item.id
          ? { ...candidate, reply: nextReply, action: nextAction, replySource: payload.source || "openai" }
          : candidate
      )));
      setRowStatuses((current) => ({
        ...current,
        [item.id]: hasGeneratedReply
          ? { status: "draft", message: "New draft" }
          : { status: nextAction, message: nextAction === "delete" ? "Still delete" : "Still review" },
      }));
    } catch (regenerateError) {
      const message = formatApiError(regenerateError.message || "Regenerate failed");
      setRowStatuses((current) => ({ ...current, [item.id]: { status: "failed", message } }));
      setError(message);
    }
  }

  async function reviewSelectedHistoryAgain() {
    const targets = filteredItems.filter((item) => selectedIds.includes(item.id) && canReopenHistoryItem(item, showingProcessedHistory));
    if (!targets.length) {
      setError("No skipped history comments selected");
      return;
    }

    setIsBulkRunning(true);
    setError("");
    const usedReplies = items
      .map((candidate) => editedReplies[candidate.id] ?? candidate.reply)
      .filter(Boolean);

    for (const item of targets) {
      setRowStatuses((current) => ({
        ...current,
        [item.id]: { status: "working", message: "Reviewing again..." },
      }));

      try {
        const response = await apiFetch(`${API_URL}/api/comments/regenerate-reply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            comment: item.comment,
            detectedLanguage: item.detectedLanguage,
            category: "review",
            tone,
            voiceProfile,
            usedReplies,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.message || payload.error || "Review again failed");
        }

        const nextAction = payload.action || "review";
        const nextReply = payload.reply || "";
        const hasGeneratedReply = nextAction === "reply" && nextReply && nextReply !== "DELETE" && nextReply !== "REVIEW";
        if (hasGeneratedReply) {
          usedReplies.push(nextReply);
        }

        setEditedReplies((current) => (
          hasGeneratedReply
            ? { ...current, [item.id]: nextReply }
            : Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id))
        ));
        setItems((current) => current.map((candidate) => (
          candidate.id === item.id
            ? {
              ...candidate,
              action: nextAction,
              status: "pending",
              category: payload.category || nextAction,
              smartCategory: payload.category || nextAction,
              detectedLanguage: payload.detectedLanguage || candidate.detectedLanguage,
              replyLanguage: payload.replyLanguage || candidate.replyLanguage,
              languageConfidence: payload.languageConfidence || candidate.languageConfidence,
              reply: nextReply,
              replySource: payload.source || "openai",
              decisionReason: "Reopened from skipped history and reviewed again.",
            }
            : candidate
        )));
        setRowStatuses((current) => ({
          ...current,
          [item.id]: hasGeneratedReply
            ? { status: "draft", message: "New draft" }
            : { status: nextAction, message: nextAction === "delete" ? "Delete suggested" : "Needs review" },
        }));
      } catch (reviewError) {
        const message = formatApiError(reviewError.message || "Review again failed");
        setRowStatuses((current) => ({ ...current, [item.id]: { status: "failed", message } }));
        setError(message);
      }
    }

    setShowingProcessedHistory(false);
    setActiveQueue("all");
    setIsBulkRunning(false);
    setNotice("Selected skipped comments were reviewed again. Check Replies, Deletes, or Unclear.");
  }

  async function runBulk(action) {
    const targets = filteredItems.filter((item) => (
      selectedIds.includes(item.id)
      && (action === "delete" ? canDeleteComment(item) : canRunAction(item, action))
    ));
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

  async function generateSelectedReviewReplies() {
    const targets = filteredItems.filter((item) => selectedIds.includes(item.id) && isPending(item) && item.action === "review");
    if (!targets.length) {
      setError("No selected review comments to generate replies for");
      return;
    }

    setIsBulkRunning(true);
    for (const item of targets) {
      await regenerateReply(item);
    }
    setIsBulkRunning(false);
  }

  useEffect(() => {
    setNotice("Press Find new unanswered to load comments that still need action.");
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
  const visiblePendingIds = filteredItems.filter((item) => isPending(item)).map((item) => item.id);
  const visibleReopenIds = filteredItems.filter((item) => canReopenHistoryItem(item, showingProcessedHistory)).map((item) => item.id);
  const visibleReplyIds = filteredItems.filter((item) => canRunAction(item, "reply")).map((item) => item.id);
  const visibleReviewIds = filteredItems.filter((item) => isPending(item) && item.action === "review").map((item) => item.id);
  const visibleDeleteIds = filteredItems.filter((item) => canRunAction(item, "delete")).map((item) => item.id);
  const selectedReopenCount = filteredItems.filter((item) => selectedIds.includes(item.id) && canReopenHistoryItem(item, showingProcessedHistory)).length;
  const selectedReplyCount = filteredItems.filter((item) => selectedIds.includes(item.id) && canRunAction(item, "reply")).length;
  const selectedReviewCount = filteredItems.filter((item) => selectedIds.includes(item.id) && isPending(item) && item.action === "review").length;
  const selectedDeleteCount = filteredItems.filter((item) => selectedIds.includes(item.id) && canDeleteComment(item)).length;
  const selectedSkippableCount = filteredItems.filter((item) => selectedIds.includes(item.id) && canRunAction(item, "skip")).length;
  const pendingCount = items.filter(isPending).length;
  const publishedCount = items.filter((item) => getItemStatus(item) === "published").length;
  const deletedCount = items.filter((item) => getItemStatus(item) === "deleted").length;
  const skippedCount = items.filter((item) => getItemStatus(item) === "skipped").length;
  const replyQueueCount = items.filter((item) => isPending(item) && item.action === "reply").length;
  const reviewQueueCount = items.filter((item) => isPending(item) && item.action === "review").length;
  const deleteQueueCount = items.filter((item) => isPending(item) && item.action === "delete").length;

  useEffect(() => {
    const selectableIds = showingProcessedHistory ? visibleReopenIds : visiblePendingIds;
    setSelectedIds((current) => current.filter((id) => selectableIds.includes(id)));
  }, [activeQueue, query, items, showingProcessedHistory]);

  function toggleSelected(itemId) {
    setSelectedIds((current) => (
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
    ));
  }

  function toggleSelectionGroup(ids) {
    setSelectedIds((current) => {
      const allGroupSelected = ids.length > 0 && ids.every((id) => current.includes(id));
      if (allGroupSelected) {
        return current.filter((id) => !ids.includes(id));
      }

      return Array.from(new Set([...current, ...ids]));
    });
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
            <label className="inline-select">
              <span>Find up to</span>
              <select value={youtubeLimit} onChange={(event) => setYoutubeLimit(Number(event.target.value))}>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={75}>75</option>
                <option value={100}>100</option>
              </select>
            </label>
            <button
              className="primary-button"
              onClick={() => fetchNewYouTubeComments()}
              disabled={isFetchingYouTube || isLoading}
              type="button"
              title="Find unanswered comments the service has not shown before"
            >
              <RefreshCw size={16} />
              {isFetchingYouTube ? "Searching YouTube" : "Find new unanswered"}
            </button>
            <button
              className="filter-button"
              onClick={() => fetchNewYouTubeComments({ scanLimit: 5000 })}
              disabled={isFetchingYouTube || isLoading}
              type="button"
              title="Scan deeper and load only unanswered comments that the service has not processed"
            >
              Find all unanswered
            </button>
            {nextPageToken && (
              <button
                className="filter-button"
                onClick={() => fetchNewYouTubeComments({ useNextPage: true, includeProcessed: includeProcessedLoad, includeThreadsWithReplies: includeThreadsWithRepliesLoad, scanLimit: scanLimitLoad })}
                disabled={isFetchingYouTube || isLoading}
                type="button"
                title="Find more new unanswered comments"
              >
                Find more
              </button>
            )}
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
        <div className="run-note">
          <p className="field-note">
            Showing latest {latestRun.source === "youtube" ? "YouTube" : "manual"} run from {new Date(latestRun.createdAt).toLocaleString()}.
          </p>
          {latestRun.source === "youtube" && (
            <p className="field-note">
              {latestRun.includeProcessed ? "Showing saved unanswered comments." : `Showing ${latestRun.visibleResultsCount ?? latestRun.results?.length ?? 0} actionable comments from ${latestRun.rawResultsCount ?? latestRun.results?.length ?? 0} returned by YouTube.`} {nextPageToken ? "More comments are available." : "No more pages found."}
            </p>
          )}
          {latestRun.source === "youtube" && (
            <div className="queue-summary" aria-label="Queue summary">
              <StatusChip label="Loaded" value={items.length} />
              <StatusChip label="Still pending" value={pendingCount} />
              <StatusChip label="Replies" value={replyQueueCount} tone="green" />
              <StatusChip label="Reviews" value={reviewQueueCount} tone="amber" />
              <StatusChip label="Deletes" value={deleteQueueCount} tone="red" />
              <StatusChip label="Published" value={publishedCount} />
              <StatusChip label="Deleted" value={deletedCount} />
              <StatusChip label="Skipped" value={skippedCount} />
              {Number.isFinite(latestRun.scannedCount) && <StatusChip label="Searched" value={latestRun.scannedCount} />}
              {Number.isFinite(latestRun.candidateCount) && <StatusChip label="Unanswered found" value={latestRun.candidateCount} />}
              {Number.isFinite(latestRun.skippedThreadsWithCreatorReplies) && <StatusChip label="Already answered" value={latestRun.skippedThreadsWithCreatorReplies} />}
              {Number.isFinite(latestRun.processedSkippedCount) && <StatusChip label="Already processed" value={latestRun.processedSkippedCount} />}
              <StatusChip label="More pages" value={nextPageToken ? "Yes" : "No"} tone={nextPageToken ? "amber" : "green"} />
            </div>
          )}
          {latestRun.source === "youtube" && latestRun.discoveryDiagnostics && (
            <div className="diagnostic-panel">
              <div className="diagnostic-header">
                <strong>Scan summary</strong>
                <span>No new tasks means these comments are either already answered by the creator or already processed here.</span>
              </div>
              <div className="diagnostic-grid">
                <StatusChip label="Scanned" value={latestRun.discoveryDiagnostics.scanned ?? 0} />
                <StatusChip label="Unanswered" value={latestRun.discoveryDiagnostics.unansweredCandidates ?? 0} />
                <StatusChip label="Ready" value={latestRun.discoveryDiagnostics.availableForReview ?? 0} tone="green" />
                <StatusChip label="Has creator reply" value={latestRun.discoveryDiagnostics.hiddenAlreadyAnswered ?? 0} />
                <StatusChip label="Processed before" value={latestRun.discoveryDiagnostics.hiddenAlreadyProcessed ?? 0} />
              </div>
              {latestRun.discoveryDiagnostics.processedItems?.length > 0 && (
                <div className="diagnostic-actions">
                  <button className="filter-button" type="button" onClick={showProcessedHistoryFromRun}>
                    Show processed history ({latestRun.discoveryDiagnostics.processedItems.length})
                  </button>
                  {showingProcessedHistory && (
                    <>
                      {processedHistoryVisibleCount < latestRun.discoveryDiagnostics.processedItems.length && (
                        <button className="filter-button" type="button" onClick={loadMoreProcessedHistory}>
                          Load next {Math.min(PROCESSED_HISTORY_PAGE_SIZE, latestRun.discoveryDiagnostics.processedItems.length - processedHistoryVisibleCount)}
                        </button>
                      )}
                      <button className="filter-button" type="button" onClick={clearProcessedHistoryView}>
                        Hide history
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      {notice && <p className="notice-text">{notice}</p>}
      {showingProcessedHistory && visibleReopenIds.length > 0 && (
        <div className={selectedIds.length > 0 ? "bulk-bar history-actions" : "bulk-bar empty history-actions"}>
          <div className="bulk-status">
            <strong>{selectedIds.length} selected</strong>
            <span className="bulk-hint">Only skipped history comments can be reviewed again.</span>
          </div>
          <div className="bulk-controls">
            <button
              className="mini-action secondary"
              onClick={() => toggleSelectionGroup(visibleReopenIds)}
              disabled={visibleReopenIds.length === 0 || isBulkRunning}
              type="button"
            >
              <CheckSquare size={14} />
              {visibleReopenIds.length > 0 && visibleReopenIds.every((id) => selectedIds.includes(id)) ? "Clear skipped" : `Select skipped (${visibleReopenIds.length})`}
            </button>
            <button
              className="mini-action publish"
              onClick={reviewSelectedHistoryAgain}
              disabled={selectedReopenCount === 0 || isBulkRunning}
              type="button"
            >
              Review again ({selectedReopenCount})
            </button>
            {selectedIds.length > 0 && (
              <button className="mini-action secondary" onClick={() => setSelectedIds([])} type="button">
                Clear
              </button>
            )}
          </div>
        </div>
      )}
      {pendingCount > 0 && (
      <div className={selectedIds.length > 0 ? "bulk-bar" : "bulk-bar empty"}>
        <div className="bulk-status">
          <strong>{selectedIds.length} selected</strong>
          {selectedIds.length === 0 && <span className="bulk-hint">Select comments with the checkboxes to use bulk actions.</span>}
        </div>
        <div className="bulk-controls">
          <button
            className="mini-action secondary"
            onClick={() => toggleSelectionGroup(visibleReplyIds)}
            disabled={visibleReplyIds.length === 0}
            type="button"
          >
            <CheckSquare size={14} />
            {visibleReplyIds.length > 0 && visibleReplyIds.every((id) => selectedIds.includes(id)) ? "Clear visible replies" : `Select visible replies (${visibleReplyIds.length})`}
          </button>
          <button
            className="mini-action secondary"
            onClick={() => toggleSelectionGroup(visibleDeleteIds)}
            disabled={visibleDeleteIds.length === 0}
            type="button"
          >
            <CheckSquare size={14} />
            {visibleDeleteIds.length > 0 && visibleDeleteIds.every((id) => selectedIds.includes(id)) ? "Clear visible deletes" : `Select visible deletes (${visibleDeleteIds.length})`}
          </button>
          <button
            className="mini-action secondary"
            onClick={() => toggleSelectionGroup(visibleReviewIds)}
            disabled={visibleReviewIds.length === 0}
            type="button"
          >
            <CheckSquare size={14} />
            {visibleReviewIds.length > 0 && visibleReviewIds.every((id) => selectedIds.includes(id)) ? "Clear visible reviews" : `Select visible reviews (${visibleReviewIds.length})`}
          </button>
          <button
            className="mini-action secondary"
            onClick={() => toggleSelectionGroup(visiblePendingIds)}
            disabled={visiblePendingIds.length === 0}
            type="button"
          >
            <CheckSquare size={14} />
            {visiblePendingIds.length > 0 && visiblePendingIds.every((id) => selectedIds.includes(id)) ? "Clear all visible" : `Select all visible (${visiblePendingIds.length})`}
          </button>
          <button
            className="mini-action publish"
            onClick={generateSelectedReviewReplies}
            disabled={selectedReviewCount === 0 || isBulkRunning}
            type="button"
          >
            Generate replies ({selectedReviewCount})
          </button>
          <button
            className="mini-action publish"
            onClick={() => runBulk("reply")}
            disabled={selectedReplyCount === 0 || isBulkRunning}
            type="button"
          >
            Publish replies ({selectedReplyCount})
          </button>
          <button
            className="mini-action delete"
            onClick={() => runBulk("delete")}
            disabled={selectedDeleteCount === 0 || isBulkRunning}
            type="button"
          >
            Delete ({selectedDeleteCount})
          </button>
          <button
            className="mini-action"
            onClick={() => runBulk("skip")}
            disabled={selectedSkippableCount === 0 || isBulkRunning}
            type="button"
          >
            Skip ({selectedSkippableCount})
          </button>
          {selectedIds.length > 0 && (
            <button className="mini-action secondary" onClick={() => setSelectedIds([])} type="button">
              Clear
            </button>
          )}
        </div>
      </div>
      )}
      <section className="reply-workspace panel">
        <div className="reply-workspace-head">
          <div>
            <h2>{showingProcessedHistory ? "Processed history" : "Review queue"}</h2>
            <p className="field-note">
              {showingProcessedHistory
                ? "Read-only comments that were already published, skipped, deleted, or otherwise handled."
                : "Edit generated replies, publish approved text, or delete and skip comments from one place."}
            </p>
          </div>
          <span>
            {showingProcessedHistory && latestRun?.discoveryDiagnostics?.processedItems?.length
              ? `${filteredItems.length} of ${latestRun.discoveryDiagnostics.processedItems.length} visible`
              : `${filteredItems.length} visible`}
          </span>
        </div>
        <div className="reply-card-grid">
          {filteredItems.map((item) => {
            const manualStatus = rowStatuses[item.id];
            const currentStatus = manualStatus?.status || getItemStatus(item);
            const isWorking = currentStatus === "working";
            const replyValue = editedReplies[item.id] ?? item.reply ?? "";
            const selected = selectedIds.includes(item.id);
            const alreadyAnswered = isAlreadyAnswered(item);
            const isHistoryItem = !isPending(item) || item.replySource === "history";
            const canReopenHistory = canReopenHistoryItem(item, showingProcessedHistory);
            const canEditReply = !alreadyAnswered && isPending(item) && item.action === "reply";

            return (
              <article className="reply-review-card" key={item.id}>
                <div className="reply-card-comment">
                  {canReopenHistory ? (
                    <label className="card-select">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelected(item.id)}
                        aria-label={`Reopen ${item.id}`}
                      />
                      Reopen
                    </label>
                  ) : isHistoryItem ? (
                    <span className="card-select read-only">History</span>
                  ) : (
                    <label className="card-select">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!isPending(item)}
                        onChange={() => toggleSelected(item.id)}
                        aria-label={`Select ${item.id}`}
                      />
                      Select
                    </label>
                  )}
                  <strong>{item.comment}</strong>
                  <span>{item.authorName || "Viewer"}</span>
                  <div className="decision-line">
                    <StatusPill status={item.action} />
                    <Badge value={item.smartCategory || item.category} />
                    <LanguageCell language={item.detectedLanguage || item.language} confidence={item.languageConfidence || item.confidence} />
                  </div>
                  <p className="decision-reason">{item.decisionReason || fallbackDecisionReason(item)}</p>
                  <div className="link-stack compact-links">
                    <span>{item.video || item.videoId || "unknown-video"}</span>
                    {item.videoUrl && <a href={item.videoUrl} target={YOUTUBE_WINDOW_TARGET}>Open video</a>}
                    {item.commentUrl && <a href={item.commentUrl} target={YOUTUBE_WINDOW_TARGET}>Open comment</a>}
                    {item.studioCommentsUrl && <a href={item.studioCommentsUrl} target={YOUTUBE_WINDOW_TARGET}>Open in Studio</a>}
                    <button className="link-button" onClick={() => copyCommentReference(item)} type="button">
                      Copy ref
                    </button>
                  </div>
                </div>
                <div className="reply-card-editor">
                  <div className="reply-label-row">
                    <span>{canEditReply ? "Generated reply" : alreadyAnswered ? "Existing creator reply" : isHistoryItem ? "History" : "Recommended action"}</span>
                    {canEditReply && <span>{replyValue.length}/120</span>}
                  </div>
                  {canEditReply ? (
                    <>
                      <textarea
                        className="reply-editor prominent"
                        value={replyValue}
                        onChange={(event) => setEditedReplies((current) => ({ ...current, [item.id]: event.target.value }))}
                        placeholder="Edit the reply before publishing"
                        rows={4}
                      />
                      <div className="reply-meta">
                        <span>Publish uses this exact text</span>
                        <span>{item.replySource === "openai" ? "GPT" : item.replySource || "draft"}</span>
                      </div>
                    </>
                  ) : isHistoryItem ? (
                    <div className="delete-decision">
                      <strong>PROCESSED</strong>
                      <span>{item.decisionReason || "This comment is already in the service history."}</span>
                    </div>
                  ) : alreadyAnswered ? (
                    <div className="delete-decision">
                      <strong>ALREADY ANSWERED</strong>
                      <span>The service will show this Studio thread, but will not generate, publish, or delete anything for it.</span>
                    </div>
                  ) : (
                    <div className="delete-decision">
                      <strong>{item.action === "delete" ? "DELETE" : "REVIEW"}</strong>
                      <span>{item.action === "delete" ? "No reply will be published for this comment." : "AI was unsure. Skip it or handle manually."}</span>
                    </div>
                  )}
                  <div className="reply-card-actions">
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
                    {canEditReply && (
                      <>
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
                      </>
                    )}
                    {item.action === "delete" && !alreadyAnswered && (
                      <button
                        className="mini-action delete"
                        onClick={() => runManualAction(item, "delete")}
                        disabled={!canRunAction(item, "delete") || isWorking}
                        type="button"
                      >
                        Delete
                      </button>
                    )}
                    {item.action !== "delete" && !alreadyAnswered && canDeleteComment(item) && (
                      <button
                        className="mini-action delete"
                        onClick={() => runManualAction(item, "delete")}
                        disabled={isWorking}
                        type="button"
                      >
                        Delete comment
                      </button>
                    )}
                    {item.action === "review" && !alreadyAnswered && (
                      <button
                        className="mini-action secondary"
                        onClick={() => regenerateReply(item)}
                        disabled={!isPending(item) || isWorking}
                        type="button"
                      >
                        <Sparkles size={13} />
                        Generate reply
                      </button>
                    )}
                    {!alreadyAnswered && (
                      <button
                        className="mini-action"
                        onClick={() => runManualAction(item, "skip")}
                        disabled={!isPending(item) || isWorking}
                        type="button"
                      >
                        Skip
                      </button>
                    )}
                    {!hasYouTubeTarget(item) && isPending(item) && (
                      <span className="action-note">Test row only. Use Review Queue to publish or delete YouTube comments.</span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {!filteredItems.length && (
            <div className="empty-state">
              {isLoading ? "Loading comments..." : "No comments in this queue. Find new unanswered comments or switch tabs."}
            </div>
          )}
        </div>
      </section>
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

function isAlreadyAnswered(item) {
  const category = String(item?.smartCategory || item?.category || "").toLowerCase();
  return category.includes("already_answered") || item?.replySource === "youtube";
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

function canDeleteComment(item) {
  return hasYouTubeTarget(item) && isPending(item) && !isAlreadyAnswered(item);
}

function canReopenHistoryItem(item, showingProcessedHistory) {
  return Boolean(
    showingProcessedHistory
    && hasYouTubeTarget(item)
    && item?.replySource === "history"
    && getItemStatus(item) === "skipped"
    && item.action === "skip",
  );
}

function getBestQueueForItems(items, currentQueue) {
  const queuePredicates = {
    needs_reply: (item) => isPending(item) && item.action === "reply",
    needs_delete: (item) => isPending(item) && item.action === "delete",
    unclear: (item) => isPending(item) && (item.action === "review" || `${item.category || item.smartCategory || ""}`.includes("unclear")),
    published: (item) => getItemStatus(item) === "published",
    deleted: (item) => getItemStatus(item) === "deleted",
    skipped: (item) => getItemStatus(item) === "skipped",
    all: () => true,
  };
  const currentPredicate = queuePredicates[currentQueue];
  if (currentPredicate && items.some(currentPredicate)) {
    return currentQueue;
  }

  return ["needs_reply", "needs_delete", "unclear", "published", "deleted", "skipped", "all"]
    .find((queueId) => items.some(queuePredicates[queueId])) || currentQueue;
}

function mergeCommentItems(existingItems, incomingItems) {
  const merged = [...existingItems];
  const seenIds = new Set(existingItems.map((item) => item.id));

  for (const item of incomingItems) {
    if (!seenIds.has(item.id)) {
      merged.push(item);
      seenIds.add(item.id);
    }
  }

  return merged;
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
      const response = await apiFetch(`${API_URL}/api/comments/analyze-batch`, {
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
      const response = await apiFetch(`${API_URL}/api/comments/batch-runs/latest`);
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

  async function runManualAction(item, action) {
    if (lastSource !== "YouTube") {
      setError("Manual actions work only with loaded YouTube comments");
      return;
    }

    setError("");
    setCommentStatuses((current) => ({
      ...current,
      [item.id]: { status: "working", message: action === "reply" ? "Publishing..." : action === "delete" ? "Deleting..." : "Skipped" },
    }));

    try {
      const response = await apiFetch(`${API_URL}/api/youtube/comments/${encodeURIComponent(item.id)}/${action}`, {
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
          <StatusRow label="Mode" value={lastSource === "YouTube" ? "Manual approve" : "Preview only"} />
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
                          <span className="action-note">Preview only. Use Review Queue to publish or delete YouTube comments.</span>
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
      const response = await apiFetch(`${API_URL}/api/insights`);
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
          {!insights?.contentIdeas?.length && <p className="field-note">No content ideas yet. Load more YouTube comments first.</p>}
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
  const [autoDeleteMode, setAutoDeleteMode] = useState("Review First");
  const [autoReplyMode, setAutoReplyMode] = useState("Manual Approve");

  return (
    <div className="settings-grid">
      <Panel title="Auto Delete">
        <Segmented options={["Off", "Review First", "Auto Delete"]} active={autoDeleteMode} onChange={setAutoDeleteMode} />
        <Checklist items={["Hate and aggression", "Sexual content", "Spam and scams", "Links", "Duplicates", "Meaningless short comments"]} />
      </Panel>
      <Panel title="Auto Reply">
        <Segmented options={["Off", "Manual Approve", "Full Auto"]} active={autoReplyMode} onChange={setAutoReplyMode} />
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

function StatusChip({ label, value, tone = "" }) {
  return (
    <span className={tone ? `status-chip ${tone}` : "status-chip"}>
      {label}
      <strong>{value}</strong>
    </span>
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

function Segmented({ options, active, onChange }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option}
          className={option === active ? "selected" : ""}
          onClick={() => onChange?.(option)}
          type="button"
        >
          {option}
        </button>
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
  if (!logs.length) {
    return <p className="field-note">No backend actions yet.</p>;
  }

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

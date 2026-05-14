import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { QRCodeSVG } from "qrcode.react";
import {
  Activity,
  Copy,
  Edit3,
  KeyRound,
  LogOut,
  Lock,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "./index.css";

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-11 w-11 place-items-center rounded-full border border-secondary/50 bg-secondary/10 shadow-[0_0_28px_rgba(0,227,253,0.22)]">
        <div className="absolute inset-1 rounded-full border border-primary/50" />
        <span className="brand-title text-sm font-bold text-primary">LR</span>
      </div>
      {!compact && (
        <div>
          <div className="eyebrow">LibreRTC</div>
          <div className="brand-title text-lg font-semibold text-foreground">Node Console</div>
        </div>
      )}
    </div>
  );
}

type LocationState = {
  name: string;
  room_id: string;
  uri: string;
  carrier: string;
  transport: string;
  payload: Record<string, string>;
  link: string;
  dns: string;
  running: boolean;
  runtime: RuntimeState;
};

type RuntimeState = {
  status: string;
  running: boolean;
  pid?: number;
  started_at?: string;
  exited_at?: string;
  exit_error?: string;
  log_count: number;
};

type LogLine = {
  time: string;
  stream: string;
  line: string;
};

type ClientState = {
  client_id: string;
  quota: Quota;
  locations: LocationState[];
};

type Quota = {
  speed_mbps?: number;
  traffic_gb?: number;
  used_gb?: number;
  used_bytes?: number;
  expires_at?: string;
};

type State = {
  name: string;
  port: number;
  client_count: number;
  running_count: number;
  clients: ClientState[];
};

type Metrics = {
  go: {
    version: string;
    goroutines: number;
  };
  host: {
    cpu_count: number;
    load1: number;
    load_percent: number;
    memory_total_bytes: number;
    memory_used_bytes: number;
    memory_used_percent: number;
    memory_available_bytes: number;
  };
  memory: {
    alloc_bytes: number;
    sys_bytes: number;
    heap_alloc_bytes: number;
  };
  manager: RuntimeState;
  children: Array<{
    client_id: string;
    room_id: string;
    transport: string;
    name: string;
    runtime: RuntimeState;
  }>;
};

type AuditEvent = {
  time: string;
  action: string;
  detail: string;
};

type ClientForm = {
  client_id: string;
  name: string;
  room_id: string;
  quota: Quota;
  carrier: string;
  transport: string;
  payload: Record<string, string>;
  dns: string;
};

const carriers = ["wbstream", "jazz", "telemost"];
const transportsByCarrier: Record<string, string[]> = {
  wbstream: ["datachannel", "vp8channel", "seichannel", "videochannel"],
  jazz: ["datachannel", "vp8channel", "seichannel", "videochannel"],
  telemost: ["vp8channel", "videochannel"],
};

const defaultForm: ClientForm = {
  client_id: "",
  name: "",
  room_id: "",
  quota: {},
  carrier: "wbstream",
  transport: "datachannel",
  payload: {},
  dns: "1.1.1.1:53",
};

const payloadFields: Record<string, Array<{ key: string; label: string; defaultValue: string }>> = {
  datachannel: [],
  vp8channel: [
    { key: "vp8-fps", label: "FPS", defaultValue: "25" },
    { key: "vp8-batch", label: "Batch", defaultValue: "1" },
  ],
  seichannel: [
    { key: "fps", label: "FPS", defaultValue: "25" },
    { key: "batch", label: "Batch", defaultValue: "1" },
    { key: "frag", label: "Fragment bytes", defaultValue: "900" },
    { key: "ack-ms", label: "ACK timeout ms", defaultValue: "2000" },
  ],
  videochannel: [
    { key: "video-w", label: "Width", defaultValue: "640" },
    { key: "video-h", label: "Height", defaultValue: "480" },
    { key: "video-fps", label: "FPS", defaultValue: "25" },
    { key: "video-bitrate", label: "Bitrate", defaultValue: "500000" },
    { key: "video-codec", label: "Codec", defaultValue: "qrcode" },
    { key: "video-hw", label: "Hardware accel", defaultValue: "false" },
  ],
};

const supportLinks = [
  {
    label: "Support LibreRTC via Tribute",
    href: "https://t.me/tribute/app?startapp=dK9j",
    image: new URL("../screens/donate-tribute-v2.svg", import.meta.url).href,
  },
  {
    label: "Donate with NOWPayments",
    href: "https://nowpayments.io/donation/svllvsx",
    image: new URL("../screens/donate-nowpayments-v2.svg", import.meta.url).href,
  },
  {
    label: "svllvsxprod Telegram",
    href: "https://t.me/svllvsxprod",
    image: new URL("../screens/telegram-updates-v2.svg", import.meta.url).href,
  },
  {
    label: "Open Libre Community Telegram",
    href: "https://t.me/openlibrecommunity",
    image: new URL("../screens/telegram-community-v2.svg", import.meta.url).href,
  },
];

async function request(path: string, options?: RequestInit) {
  const res = await fetch(path, options);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("olcrtc-auth-required"));
    throw new Error((await res.text()).trim() || res.statusText);
  }
  return res;
}

function transportOptions(carrier: string) {
  return transportsByCarrier[carrier] ?? transportsByCarrier.wbstream;
}

function normalizeForm(form: ClientForm): ClientForm {
  const options = transportOptions(form.carrier);
  const transport = options.includes(form.transport) ? form.transport : options[0];
  const allowed = new Set((payloadFields[transport] ?? []).map((field) => field.key));
  const payload = Object.fromEntries(Object.entries(form.payload).filter(([key]) => allowed.has(key)));
  return {
    ...form,
    transport,
    payload,
  };
}

function payloadForSubmit(payload: Record<string, string>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value.trim() !== ""));
}

function formatBytes(bytes?: number) {
  if (!bytes) return "...";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatPercent(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return "...";
  return `${value.toFixed(0)}%`;
}

function subscriptionURL(clientID: string) {
  return `${window.location.origin}/${encodeURIComponent(clientID)}/`;
}

async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!document.execCommand("copy")) throw new Error("Copy command failed");
  } finally {
    document.body.removeChild(textarea);
  }
}

function cleanQuota(quota: Quota): Quota {
  return {
    speed_mbps: quota.speed_mbps || undefined,
    traffic_gb: quota.traffic_gb || undefined,
    used_gb: quota.used_gb || undefined,
    used_bytes: quota.used_bytes || undefined,
    expires_at: quota.expires_at?.trim() || undefined,
  };
}

function quotaText(quota?: Quota) {
  if (!quota) return "none";
  const parts = [];
  if (quota.speed_mbps) parts.push(`${quota.speed_mbps} Mbps`);
  if (quota.traffic_gb) {
    const used = quota.used_bytes ? (quota.used_bytes / 1024 / 1024 / 1024).toFixed(2) : `${quota.used_gb ?? 0}`;
    parts.push(`${used}/${quota.traffic_gb} GB`);
  }
  if (quota.expires_at) parts.push(`до ${quota.expires_at}`);
  return parts.length ? parts.join(" · ") : "none";
}

function quotaPercent(quota?: Quota) {
  if (!quota?.traffic_gb) return undefined;
  const used = quota.used_bytes ? quota.used_bytes / 1024 / 1024 / 1024 : quota.used_gb ?? 0;
  return Math.max(0, Math.min(100, (used / quota.traffic_gb) * 100));
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="brand-title mt-2 text-4xl font-bold tracking-tight text-foreground">{value}</div>
    </div>
  );
}

function HeaderMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="glass-card grid h-11 min-w-28 content-center rounded-full px-4">
      <div className="eyebrow leading-3">{label}</div>
      <div className="brand-title text-sm font-semibold leading-4 text-foreground">{value}</div>
    </div>
  );
}

function SupportFooter() {
  return (
    <footer className="mt-8">
      <div className="mb-3 text-center text-xs uppercase tracking-[0.28em] text-muted-foreground">Поддержка и сообщество</div>
      <div className="grid grid-cols-4 gap-3 overflow-x-auto pb-1">
        {supportLinks.map((link) => (
          <a
            key={link.href}
            className="block min-w-[220px] rounded-3xl transition hover:-translate-y-0.5 hover:brightness-110"
            href={link.href}
            target="_blank"
            rel="noreferrer"
          >
            <img className="h-auto w-full" src={link.image} alt={link.label} />
          </a>
        ))}
      </div>
    </footer>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 p-4 backdrop-blur-xl">
      <div className="glass-card flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-2xl shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="brand-title text-lg font-semibold tracking-tight">{title}</h2>
          <button
            className="secondary-glow inline-flex h-9 w-9 items-center justify-center rounded-full border"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}

function LoginView({ setupRequired, onLogin }: { setupRequired: boolean; onLogin: () => void }) {
  const [user, setUser] = useState(setupRequired ? "" : "admin");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!setupRequired) return;
    setUser("");
    setPassword("");
    setRepeat("");
    setError("");
  }, [setupRequired]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (setupRequired && !user.trim()) throw new Error("Укажите новый логин");
      if (setupRequired && password !== repeat) throw new Error("Пароли не совпадают");
      await request(setupRequired ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-5">
      <form className="glass-card grid w-full max-w-md gap-5 rounded-2xl p-6" onSubmit={submit}>
        <div className="flex items-center justify-between gap-4">
          <BrandMark />
          <Lock className="h-5 w-5 text-secondary" />
        </div>
        <div>
          <h1 className="brand-title text-3xl font-semibold tracking-tight text-primary">{setupRequired ? "Смена временного доступа" : "Вход в панель"}</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            {setupRequired ? "Задайте новый логин и пароль перед первым входом." : "Управление клиентами, туннелями и подписками LibreRTC Node."}
          </div>
        </div>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Логин
          <input
            className="h-11 rounded-lg border border-border bg-background/70 px-3 text-foreground outline-none focus:border-secondary focus:shadow-[0_0_0_3px_rgba(0,227,253,0.15)]"
            value={user}
            onChange={(event) => setUser(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Пароль
          <input
            className="h-11 rounded-lg border border-border bg-background/70 px-3 text-foreground outline-none focus:border-secondary focus:shadow-[0_0_0_3px_rgba(0,227,253,0.15)]"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={setupRequired ? "new-password" : "current-password"}
          />
        </label>
        {setupRequired && (
          <label className="grid gap-2 text-sm text-muted-foreground">
            Повтор пароля
            <input
              className="h-11 rounded-lg border border-border bg-background/70 px-3 text-foreground outline-none focus:border-secondary focus:shadow-[0_0_0_3px_rgba(0,227,253,0.15)]"
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
            />
          </label>
        )}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <button
          className="primary-glow inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-60"
          disabled={busy}
        >
          <Lock className="h-4 w-4" />
          {setupRequired ? "Сохранить логин и пароль" : "Войти"}
        </button>
      </form>
    </div>
  );
}

function ClientFormFields({
  form,
  setForm,
  includeClientID,
}: {
  form: ClientForm;
  setForm: (form: ClientForm) => void;
  includeClientID: boolean;
}) {
  const set = (patch: Partial<ClientForm>) => setForm(normalizeForm({ ...form, ...patch }));
  const fields = payloadFields[form.transport] ?? [];

  return (
    <div className="grid gap-4">
      {includeClientID && (
        <label className="grid gap-2 text-sm text-muted-foreground">
          ID клиента
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={form.client_id}
            onChange={(event) => set({ client_id: event.target.value })}
            placeholder="client-id"
          />
        </label>
      )}
      <div className="grid gap-3 rounded-md border border-border bg-background p-3">
          <div className="text-sm font-medium text-foreground">Квоты клиента</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2 text-sm text-muted-foreground">
              Скорость, Mbps
              <input
                className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                type="number"
                min="0"
                value={form.quota.speed_mbps ?? ""}
                onChange={(event) => set({ quota: { ...form.quota, speed_mbps: Number(event.target.value) || undefined } })}
                placeholder="без лимита"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Трафик, GB
              <input
                className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                type="number"
                min="0"
                value={form.quota.traffic_gb ?? ""}
                onChange={(event) => set({ quota: { ...form.quota, traffic_gb: Number(event.target.value) || undefined } })}
                placeholder="без лимита"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Использовано, GB
              <input
                className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                type="number"
                min="0"
                value={form.quota.used_gb ?? ""}
                onChange={(event) => set({ quota: { ...form.quota, used_gb: Number(event.target.value) || undefined, used_bytes: undefined } })}
                placeholder="0"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Действует до
              <input
                className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                type="date"
                value={form.quota.expires_at ?? ""}
                onChange={(event) => set({ quota: { ...form.quota, expires_at: event.target.value || undefined } })}
              />
            </label>
          </div>
        </div>
      <label className="grid gap-2 text-sm text-muted-foreground">
        Название локации
        <input
          className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
          value={form.name}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Default location"
        />
      </label>
      {form.carrier === "wbstream" && (
        <label className="grid gap-2 text-sm text-muted-foreground">
          Room ID
          <input
            className="h-10 rounded-md border border-border bg-background px-3 font-mono text-xs text-foreground outline-none focus:border-primary"
            value={form.room_id}
            onChange={(event) => set({ room_id: event.target.value })}
            placeholder="оставь пустым для автогенерации"
          />
          <span className="text-xs text-muted-foreground/80">Можно вставить ID комнаты, созданной вручную на сайте WB Stream.</span>
        </label>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm text-muted-foreground">
          Carrier
          <select
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={form.carrier}
            onChange={(event) => set({ carrier: event.target.value })}
          >
            {carriers.map((carrier) => (
              <option key={carrier} value={carrier}>
                {carrier}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Transport
          <select
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={form.transport}
            onChange={(event) => set({ transport: event.target.value })}
          >
            {transportOptions(form.carrier).map((transport) => (
              <option key={transport} value={transport}>
                {transport}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-sm text-muted-foreground">
        DNS
        <input
          className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
          value={form.dns}
          onChange={(event) => set({ dns: event.target.value })}
          placeholder="1.1.1.1:53"
        />
      </label>
      {fields.length > 0 && (
        <div className="grid gap-3 rounded-md border border-border bg-background p-3">
          <div className="text-sm font-medium text-foreground">Параметры транспорта</div>
          <div className="grid gap-3 md:grid-cols-2">
            {fields.map((field) => (
              <label key={field.key} className="grid gap-2 text-sm text-muted-foreground">
                {field.label}
                <input
                  className="h-10 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:border-primary"
                  value={form.payload[field.key] ?? ""}
                  onChange={(event) =>
                    set({
                      payload: {
                        ...form.payload,
                        [field.key]: event.target.value,
                      },
                    })
                  }
                  placeholder={field.defaultValue}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [state, setState] = useState<State | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editClient, setEditClient] = useState<ClientState | null>(null);
  const [logTarget, setLogTarget] = useState<{ clientID: string; location: LocationState } | null>(null);
  const [qrTarget, setQrTarget] = useState<{ clientID: string; location: LocationState } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [createForm, setCreateForm] = useState<ClientForm>(defaultForm);
  const [editForm, setEditForm] = useState<ClientForm>(defaultForm);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", repeat: "" });

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        try {
          const body = (await res.json()) as { setup_required?: boolean };
          setSetupRequired(Boolean(body.setup_required));
        } catch {
          setSetupRequired(false);
        }
        setAuthenticated(false);
        return;
      }
      const body = (await res.json()) as { setup_required?: boolean };
      setSetupRequired(Boolean(body.setup_required));
      if (body.setup_required) {
        setAuthenticated(false);
        return;
      }
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
    }
  };

  const afterLogin = async () => {
    await checkAuth();
    await Promise.all([loadState(), loadMetrics(), loadAudit()]).catch((err) => setNotice(err.message));
  };

  const loadState = async () => {
    const res = await request("/api/state", { cache: "no-store" });
    setState((await res.json()) as State);
  };

  const loadMetrics = async () => {
    const res = await request("/api/metrics", { cache: "no-store" });
    setMetrics((await res.json()) as Metrics);
  };

  const loadAudit = async () => {
    const res = await request("/api/audit", { cache: "no-store" });
    const body = (await res.json()) as { events: AuditEvent[] };
    setAudit(body.events ?? []);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    const handler = () => setAuthenticated(false);
    window.addEventListener("olcrtc-auth-required", handler);
    return () => window.removeEventListener("olcrtc-auth-required", handler);
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    Promise.all([loadState(), loadMetrics(), loadAudit()]).catch((err) => setNotice(err.message));
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    const id = window.setInterval(() => {
      Promise.all([loadState(), loadMetrics()]).catch((err) => setNotice(err.message));
    }, 5000);
    return () => window.clearInterval(id);
  }, [authenticated]);

  const clients = state?.clients ?? [];

  const runAction = async (action: () => Promise<void>, okText: string) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(okText);
      await loadState();
      await loadMetrics();
      await loadAudit();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setCreateForm(defaultForm);
    setCreateOpen(true);
  };

  const openEdit = (client: ClientState) => {
    const loc = client.locations[0];
    setEditClient(client);
    setEditForm(
      normalizeForm({
        client_id: client.client_id,
        name: loc?.name ?? client.client_id,
        room_id: loc?.room_id ?? "",
        quota: client.quota ?? {},
        carrier: loc?.carrier ?? "wbstream",
        transport: loc?.transport ?? "datachannel",
        payload: loc?.payload ?? {},
        dns: loc?.dns ?? "1.1.1.1:53",
      }),
    );
  };

  const addClient = () =>
    runAction(async () => {
      if (!createForm.client_id.trim()) throw new Error("Укажи ID клиента");
      await request("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: createForm.client_id.trim(),
          name: createForm.name.trim(),
          room_id: createForm.carrier === "wbstream" ? createForm.room_id.trim() : "",
          quota: cleanQuota(createForm.quota),
          carrier: createForm.carrier,
          transport: createForm.transport,
          payload: payloadForSubmit(createForm.payload),
          dns: createForm.dns.trim(),
        }),
      });
      setCreateOpen(false);
    }, createForm.carrier === "wbstream" && createForm.room_id.trim() ? "Клиент создан с указанным room" : "Клиент создан, room сгенерирован отдельно");

  const updateClient = () =>
    runAction(async () => {
      if (!editClient) return;
      await request(`/api/clients/${encodeURIComponent(editClient.client_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          room_id: editForm.carrier === "wbstream" ? editForm.room_id.trim() : "",
          quota: cleanQuota(editForm.quota),
          carrier: editForm.carrier,
          transport: editForm.transport,
          payload: payloadForSubmit(editForm.payload),
          dns: editForm.dns.trim(),
        }),
      });
      setEditClient(null);
    }, "Клиент обновлен");

  const deleteClient = (id: string) =>
    runAction(async () => {
      if (!window.confirm(`Удалить клиента ${id}?`)) return;
      await request(`/api/clients/${encodeURIComponent(id)}`, { method: "DELETE" });
    }, "Клиент удален");

  const deleteLocation = (clientID: string, location: LocationState) =>
    runAction(async () => {
      if (!window.confirm(`Удалить локацию ${location.name || location.room_id}?`)) return;
      await request(`/api/clients/${encodeURIComponent(clientID)}/locations/${encodeURIComponent(location.room_id)}`, {
        method: "DELETE",
      });
    }, "Локация удалена");

  const restartLocation = (clientID: string, location: LocationState) =>
    runAction(async () => {
      await request("/api/actions/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientID,
          room_id: location.room_id,
          transport: location.transport,
        }),
      });
    }, `${clientID} перезапущен`);

  const regenerateRoom = (clientID: string) =>
    runAction(async () => {
      if (!window.confirm(`Сгенерировать новый room для ${clientID}? Старая ссылка перестанет работать.`)) return;
      await request("/api/actions/regenerate-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientID }),
      });
    }, `Room для ${clientID} обновлен`);

  const rotateKey = (clientID: string) =>
    runAction(async () => {
      if (!window.confirm(`Сменить ключ для ${clientID}? Старые ссылки перестанут работать.`)) return;
      await request("/api/actions/rotate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientID }),
      });
    }, `Ключ для ${clientID} обновлен`);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
    setState(null);
    setMetrics(null);
  };

  const changePassword = () =>
    runAction(async () => {
      if (passwordForm.next !== passwordForm.repeat) throw new Error("Новые пароли не совпадают");
      await request("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: passwordForm.current, new_password: passwordForm.next }),
      });
      setPasswordForm({ current: "", next: "", repeat: "" });
      setShowPassword(false);
      setAuthenticated(false);
    }, "Пароль изменен, войди заново");

  const openLogs = async (clientID: string, location: LocationState) => {
    setLogTarget({ clientID, location });
    setLogs([]);
    setNotice("");
    try {
      const res = await request(
        `/api/logs/${encodeURIComponent(clientID)}/${encodeURIComponent(location.room_id)}/${encodeURIComponent(
          location.transport,
        )}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as { logs: LogLine[] };
      setLogs(body.logs);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const copyLogs = () =>
    runAction(async () => {
      await copyText(
        logs.map((line) => `[${line.time}] ${line.stream}: ${line.line}`).join("\n"),
      );
    }, "Логи скопированы");

  const copyClientURI = (clientID: string, uri: string) =>
    runAction(async () => {
      if (!uri) throw new Error("URI клиента не найден");
      await copyText(uri);
    }, `Ссылка для ${clientID} скопирована`);

  const copySubscription = (clientID: string) =>
    runAction(async () => {
      await copyText(subscriptionURL(clientID));
    }, `Subscription для ${clientID} скопирован`);

  const downloadSubscription = async (clientID: string) => {
    const res = await request(`/${encodeURIComponent(clientID)}/`, { cache: "no-store" });
    const text = await res.text();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${clientID}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (authenticated === null) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Загрузка...</div>;
  }

  if (!authenticated) {
    return <LoginView setupRequired={setupRequired} onLogin={afterLogin} />;
  }

  return (
    <div className="min-h-screen">
      <header className="glass-shell sticky top-0 z-40 border-b">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <BrandMark />
          <div className="flex flex-wrap items-center gap-2">
            <HeaderMetric label="Memory" value={formatBytes(metrics?.memory.heap_alloc_bytes)} />
            <HeaderMetric label="Manager PID" value={metrics?.manager.pid ?? "..."} />
            <button
              className="secondary-glow inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm"
              onClick={() => setShowPassword(true)}
            >
              <KeyRound className="h-4 w-4" />
              Пароль
            </button>
            <button
              className="secondary-glow inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm disabled:opacity-60"
              disabled={busy}
              onClick={() =>
                runAction(async () => {
                  await loadState();
                  await loadMetrics();
                }, "Обновлено")
              }
            >
              <RefreshCw className="h-4 w-4" />
              Обновить
            </button>
            <button
              className="secondary-glow inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm"
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-8">
        <section className="grid gap-4 md:grid-cols-3">
          <StatCard icon={<Users className="h-4 w-4" />} label="Клиенты" value={state?.client_count ?? "..."} />
          <StatCard icon={<Activity className="h-4 w-4" />} label="CPU" value={formatPercent(metrics?.host.load_percent)} />
          <StatCard icon={<Server className="h-4 w-4 text-secondary" />} label="RAM" value={formatPercent(metrics?.host.memory_used_percent)} />
        </section>

        <section className="glass-card stable-panel no-glass-line mt-6 overflow-hidden rounded-[2rem] p-0">
          <div className="stable-panel-head relative border-b border-white/10 p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="brand-title text-3xl font-semibold tracking-tight text-foreground">Клиенты</h2>
              </div>
              <button
                className="primary-glow inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold"
                onClick={openCreate}
              >
                <Plus className="h-4 w-4" />
                Новый клиент
              </button>
            </div>
            <div className="mt-4 min-h-5 text-sm text-muted-foreground">{notice}</div>
          </div>

          <div className="grid gap-4 p-4 md:p-5">
            {clients.length === 0 && (
              <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] p-8 text-center">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-secondary/40 bg-secondary/10 text-secondary">
                  <Users className="h-6 w-6" />
                </div>
                <h3 className="brand-title mt-4 text-xl font-semibold">Клиентов пока нет</h3>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                  Создай первого клиента, чтобы получить подписку, URI и runtime-инстанс.
                </p>
              </div>
            )}

            {clients.map((client) => {
              const quota = quotaPercent(client.quota);
              const runningLocations = client.locations.filter((loc) => loc.runtime.running).length;

              return (
                <article
                  key={client.client_id}
                  className="relative overflow-hidden rounded-3xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] md:p-5"
                >
                  <div className="relative flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-primary/35 bg-primary/10 shadow-[0_0_28px_rgba(255,215,0,0.16)]">
                        <span className="brand-title text-lg font-bold text-primary">{client.client_id.slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="brand-title truncate text-2xl font-semibold text-foreground">{client.client_id}</h3>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-muted-foreground">
                            {runningLocations}/{client.locations.length} online
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">{quotaText(client.quota)}</span>
                          <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1">{client.locations.length} location(s)</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        className="secondary-glow inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm disabled:opacity-60"
                        disabled={busy}
                        onClick={() => copySubscription(client.client_id)}
                      >
                        <Copy className="h-4 w-4" />
                        Sub
                      </button>
                      <button
                        className="secondary-glow h-9 rounded-full border px-3 text-sm disabled:opacity-60"
                        disabled={busy}
                        onClick={() => downloadSubscription(client.client_id)}
                      >
                        Export
                      </button>
                      <button
                        className="secondary-glow inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm disabled:opacity-60"
                        disabled={busy}
                        onClick={() => openEdit(client)}
                      >
                        <Edit3 className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        className="inline-flex h-9 items-center gap-2 rounded-full border border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                        disabled={busy}
                        onClick={() => deleteClient(client.client_id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
                      </button>
                    </div>
                  </div>

                  {quota !== undefined && (
                    <div className="relative mt-5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Traffic quota</span>
                        <span>{quota.toFixed(1)}%</span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-[linear-gradient(90deg,var(--primary),var(--secondary))] shadow-[0_0_18px_rgba(255,215,0,0.35)]"
                          style={{ width: `${quota}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="relative mt-5 grid gap-3">
                    {client.locations.map((loc) => (
                      <div
                        key={`${client.client_id}-${loc.room_id}-${loc.transport}`}
                        className="w-full rounded-2xl border border-white/10 bg-black/20 p-4"
                      >
                        <div className="flex w-full flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex rounded-full px-2 py-1 text-xs ${
                                  loc.runtime.running ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
                                }`}
                              >
                                {loc.runtime.status}
                              </span>
                              <span className="text-sm font-medium text-foreground">{loc.name || "Default"}</span>
                            </div>
                            <div className="mt-3 grid w-full gap-2 text-xs text-muted-foreground md:grid-cols-3">
                              <div className="min-w-0 rounded-xl bg-white/[0.035] p-3 md:col-span-2">
                                <div className="eyebrow">Room</div>
                                <div className="mt-1 max-w-full truncate font-mono text-[11px] text-foreground">{loc.room_id}</div>
                              </div>
                              <div className="min-w-0 rounded-xl bg-white/[0.035] p-3">
                                <div className="eyebrow">Route</div>
                                <div className="mt-1 text-foreground">{loc.carrier} / {loc.transport}</div>
                              </div>
                              <div className="min-w-0 rounded-xl bg-white/[0.035] p-3 md:col-span-3">
                                <div className="eyebrow">DNS</div>
                                <div className="mt-1 font-mono text-[11px] text-foreground">{loc.dns}</div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            className="secondary-glow inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs disabled:opacity-60"
                            disabled={busy}
                            onClick={() => restartLocation(client.client_id, loc)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Restart
                          </button>
                          <button
                            className="secondary-glow h-8 rounded-full border px-3 text-xs disabled:opacity-60"
                            disabled={busy}
                            onClick={() => regenerateRoom(client.client_id)}
                          >
                            Room
                          </button>
                          <button
                            className="secondary-glow h-8 rounded-full border px-3 text-xs disabled:opacity-60"
                            disabled={busy}
                            onClick={() => rotateKey(client.client_id)}
                          >
                            Key
                          </button>
                          <button
                            className="secondary-glow inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs disabled:opacity-60"
                            disabled={busy}
                            onClick={() => openLogs(client.client_id, loc)}
                          >
                            <Terminal className="h-3.5 w-3.5" />
                            Логи
                          </button>
                          <button
                            className="secondary-glow inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs disabled:opacity-60"
                            disabled={busy}
                            onClick={() => copyClientURI(client.client_id, loc.uri)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            URI
                          </button>
                          <button
                            className="secondary-glow h-8 rounded-full border px-3 text-xs disabled:opacity-60"
                            disabled={busy}
                            onClick={() => setQrTarget({ clientID: client.client_id, location: loc })}
                          >
                            QR
                          </button>
                          {client.locations.length > 1 && (
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-full border border-destructive/40 px-3 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
                              disabled={busy}
                              onClick={() => deleteLocation(client.client_id, loc)}
                            >
                              -Loc
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <SupportFooter />
      </main>

      {createOpen && (
        <Modal title="Создать клиента" onClose={() => setCreateOpen(false)}>
          <div className="p-5">
            <ClientFormFields form={createForm} setForm={setCreateForm} includeClientID />
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="secondary-glow h-9 rounded-md border px-3 text-sm"
                onClick={() => setCreateOpen(false)}
              >
                Отмена
              </button>
              <button
                className="primary-glow inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-60"
                disabled={busy}
                onClick={addClient}
              >
                <Plus className="h-4 w-4" />
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editClient && (
        <Modal title={`Редактировать ${editClient.client_id}`} onClose={() => setEditClient(null)}>
          <div className="p-5">
            <ClientFormFields form={editForm} setForm={setEditForm} includeClientID={false} />
            <div className="mt-3 rounded-lg border border-border bg-background/50 p-3 text-sm text-muted-foreground">
              При изменении carrier или DNS будет создан новый room.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="secondary-glow h-9 rounded-md border px-3 text-sm"
                onClick={() => setEditClient(null)}
              >
                Отмена
              </button>
              <button
                className="primary-glow inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-60"
                disabled={busy}
                onClick={updateClient}
              >
                <Edit3 className="h-4 w-4" />
                Сохранить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {qrTarget && (
        <Modal title={`QR ${qrTarget.clientID}`} onClose={() => setQrTarget(null)}>
          <div className="grid justify-items-center gap-4 p-5">
            <div className="rounded-[2rem] border border-secondary/40 bg-white p-4 shadow-[0_0_42px_rgba(0,227,253,0.18)]">
              <QRCodeSVG
                value={qrTarget.location.uri}
                size={240}
                marginSize={2}
                level="M"
                bgColor="#ffffff"
                fgColor="#0d0e13"
              />
            </div>
            <div className="max-w-full break-all rounded-lg border border-border bg-background/50 p-3 font-mono text-xs text-muted-foreground">
              {qrTarget.location.uri}
            </div>
            <div className="flex gap-2">
              <button
                className="secondary-glow h-9 rounded-md border px-3 text-sm"
                onClick={() => copyClientURI(qrTarget.clientID, qrTarget.location.uri)}
              >
                Копировать URI
              </button>
              <button
                className="secondary-glow h-9 rounded-md border px-3 text-sm"
                onClick={() => copySubscription(qrTarget.clientID)}
              >
                Копировать подписку
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showPassword && (
        <Modal title="Сменить пароль" onClose={() => setShowPassword(false)}>
          <div className="grid gap-4 p-5">
            <label className="grid gap-2 text-sm text-muted-foreground">
              Текущий пароль
              <input
                className="h-10 rounded-lg border border-border bg-background/70 px-3 text-foreground outline-none focus:border-secondary"
                type="password"
                value={passwordForm.current}
                onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })}
                autoComplete="current-password"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Новый пароль
              <input
                className="h-10 rounded-lg border border-border bg-background/70 px-3 text-foreground outline-none focus:border-secondary"
                type="password"
                value={passwordForm.next}
                onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })}
                autoComplete="new-password"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Повтор нового пароля
              <input
                className="h-10 rounded-lg border border-border bg-background/70 px-3 text-foreground outline-none focus:border-secondary"
                type="password"
                value={passwordForm.repeat}
                onChange={(event) => setPasswordForm({ ...passwordForm, repeat: event.target.value })}
                autoComplete="new-password"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                className="secondary-glow h-9 rounded-md border px-3 text-sm"
                onClick={() => setShowPassword(false)}
              >
                Отмена
              </button>
              <button
                className="primary-glow inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold disabled:opacity-60"
                disabled={busy}
                onClick={changePassword}
              >
                <KeyRound className="h-4 w-4" />
                Сохранить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {logTarget && (
        <Modal title={`Логи ${logTarget.clientID}`} onClose={() => setLogTarget(null)}>
          <div className="p-5">
            <div className="grid gap-2 rounded-lg border border-border bg-background/50 p-3 text-sm text-muted-foreground">
              <div>Статус: {logTarget.location.runtime.status}</div>
              {logTarget.location.runtime.pid && <div>PID: {logTarget.location.runtime.pid}</div>}
              {logTarget.location.runtime.started_at && <div>Started: {logTarget.location.runtime.started_at}</div>}
              {logTarget.location.runtime.exited_at && <div>Exited: {logTarget.location.runtime.exited_at}</div>}
              {logTarget.location.runtime.exit_error && (
                <div className="text-destructive">Exit: {logTarget.location.runtime.exit_error}</div>
              )}
            </div>

            <div className="mt-4 max-h-[420px] overflow-auto rounded-lg border border-border bg-black/80 p-3 font-mono text-xs text-slate-100 shadow-inner">
              {logs.length === 0 ? (
                <div className="text-muted-foreground">Логов пока нет</div>
              ) : (
                logs.map((line, index) => (
                  <div key={`${line.time}-${index}`} className="whitespace-pre-wrap break-words">
                    <span className={line.stream === "stderr" ? "text-destructive" : "text-primary"}>
                      {line.stream}
                    </span>{" "}
                    <span className="text-muted-foreground">{line.time}</span> {line.line}
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="secondary-glow h-9 rounded-md border px-3 text-sm"
                onClick={() => openLogs(logTarget.clientID, logTarget.location)}
              >
                Обновить
              </button>
              <button
                className="secondary-glow h-9 rounded-md border px-3 text-sm disabled:opacity-60"
                disabled={logs.length === 0 || busy}
                onClick={copyLogs}
              >
                Копировать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

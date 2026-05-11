import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
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
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function subscriptionURL(clientID: string) {
  return `${window.location.origin}/${encodeURIComponent(clientID)}/`;
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
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-normal">{value}</div>
    </div>
  );
}

function HeaderMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid h-9 min-w-24 content-center rounded-md border border-border bg-card px-3">
      <div className="text-[10px] uppercase leading-3 text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold leading-4">{value}</div>
    </div>
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted hover:bg-muted/80"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LoginView({ setupRequired, onLogin }: { setupRequired: boolean; onLogin: () => void }) {
  const [user, setUser] = useState("admin");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
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
    <div className="grid min-h-screen place-items-center bg-background px-5">
      <form className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-card p-5" onSubmit={submit}>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/15 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-normal">OlcRTC Manager</h1>
            <div className="text-sm text-muted-foreground">{setupRequired ? "Первичная настройка" : "Вход в панель"}</div>
          </div>
        </div>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Логин
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={user}
            onChange={(event) => setUser(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Пароль
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {setupRequired && (
          <label className="grid gap-2 text-sm text-muted-foreground">
            Повтор пароля
            <input
              className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
            />
          </label>
        )}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
          disabled={busy}
        >
          <Lock className="h-4 w-4" />
          {setupRequired ? "Сохранить пароль" : "Войти"}
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
          quota: cleanQuota(createForm.quota),
          carrier: createForm.carrier,
          transport: createForm.transport,
          payload: payloadForSubmit(createForm.payload),
          dns: createForm.dns.trim(),
        }),
      });
      setCreateOpen(false);
    }, "Клиент создан, room сгенерирован отдельно");

  const updateClient = () =>
    runAction(async () => {
      if (!editClient) return;
      await request(`/api/clients/${encodeURIComponent(editClient.client_id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
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
      await navigator.clipboard.writeText(
        logs.map((line) => `[${line.time}] ${line.stream}: ${line.line}`).join("\n"),
      );
    }, "Логи скопированы");

  const copyOlcBoxLink = (clientID: string, uri: string) =>
    runAction(async () => {
      if (!uri) throw new Error("OlcBox ссылка не найдена");
      await navigator.clipboard.writeText(uri);
    }, `Ссылка для ${clientID} скопирована`);

  const copySubscription = (clientID: string) =>
    runAction(async () => {
      await navigator.clipboard.writeText(subscriptionURL(clientID));
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
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">OlcRTC Manager</h1>
          </div>
          <div className="flex items-center gap-2">
            <HeaderMetric label="Panel mem" value={formatBytes(metrics?.memory.heap_alloc_bytes)} />
            <HeaderMetric label="Panel PID" value={metrics?.manager.pid ?? "..."} />
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
              onClick={() => setShowPassword(true)}
            >
              <KeyRound className="h-4 w-4" />
              Пароль
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
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
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <section className="grid gap-3 md:grid-cols-3">
          <StatCard icon={<Server className="h-4 w-4" />} label="Профиль" value={state?.name ?? "..."} />
          <StatCard icon={<Users className="h-4 w-4" />} label="Клиенты" value={state?.client_count ?? "..."} />
          <StatCard icon={<Activity className="h-4 w-4" />} label="Инстансы" value={state?.running_count ?? "..."} />
        </section>

        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-normal">Клиенты</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90"
                onClick={openCreate}
              >
                <Plus className="h-4 w-4" />
                Создать клиента
              </button>
            </div>
          </div>

          <div className="mt-3 min-h-5 text-sm text-muted-foreground">{notice}</div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-3 pr-3 font-medium">Клиент</th>
                  <th className="py-3 pr-3 font-medium">Локация</th>
                  <th className="py-3 pr-3 font-medium">Room</th>
                  <th className="py-3 pr-3 font-medium">Carrier</th>
                  <th className="py-3 pr-3 font-medium">Transport</th>
                  <th className="py-3 pr-3 font-medium">Квота</th>
                  <th className="py-3 pr-3 font-medium">DNS</th>
                  <th className="py-3 pr-3 font-medium">Статус</th>
                  <th className="py-3 text-right font-medium">Действия</th>
                </tr>
              </thead>
              <tbody>
                {clients.flatMap((client) =>
                  client.locations.map((loc, index) => (
                    <tr key={`${client.client_id}-${loc.room_id}-${loc.transport}`} className="border-b border-border/70">
                      <td className="py-3 pr-3 font-medium">{index === 0 ? client.client_id : ""}</td>
                      <td className="py-3 pr-3">{loc.name || "Default"}</td>
                      <td className="max-w-[220px] truncate py-3 pr-3 text-muted-foreground">{loc.room_id}</td>
                      <td className="py-3 pr-3">{loc.carrier}</td>
                      <td className="py-3 pr-3">{loc.transport}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{index === 0 ? quotaText(client.quota) : ""}</td>
                      <td className="py-3 pr-3 text-muted-foreground">{loc.dns}</td>
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-1 text-xs ${
                            loc.runtime.running ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {loc.runtime.status}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        {
                          <div className="flex justify-end gap-2">
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                              disabled={busy}
                              onClick={() => restartLocation(client.client_id, loc)}
                            >
                              <RefreshCw className="h-4 w-4" />
                              Restart
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                              disabled={busy}
                              onClick={() => regenerateRoom(client.client_id)}
                            >
                              Room
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                              disabled={busy}
                              onClick={() => rotateKey(client.client_id)}
                            >
                              Key
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                              disabled={busy}
                              onClick={() => openLogs(client.client_id, loc)}
                            >
                              <Terminal className="h-4 w-4" />
                              Логи
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                              disabled={busy}
                              onClick={() => copyOlcBoxLink(client.client_id, loc.uri)}
                            >
                              <Copy className="h-4 w-4" />
                              OlcBox
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                              disabled={busy}
                              onClick={() => setQrTarget({ clientID: client.client_id, location: loc })}
                            >
                              QR
                            </button>
                            {index === 0 && (
                              <>
                                <button
                                  className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                                  disabled={busy}
                                  onClick={() => copySubscription(client.client_id)}
                                >
                                  Sub
                                </button>
                                <button
                                  className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                                  disabled={busy}
                                  onClick={() => downloadSubscription(client.client_id)}
                                >
                                  Export
                                </button>
                              </>
                            )}
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm hover:bg-muted disabled:opacity-60"
                              disabled={busy}
                              onClick={() => openEdit(client)}
                            >
                              <Edit3 className="h-4 w-4" />
                              Edit
                            </button>
                            <button
                              className="inline-flex h-8 items-center gap-2 rounded-md border border-destructive/40 px-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                              disabled={busy}
                              onClick={() => deleteClient(client.client_id)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Удалить
                            </button>
                            {client.locations.length > 1 && (
                              <button
                                className="inline-flex h-8 items-center gap-2 rounded-md border border-destructive/40 px-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                                disabled={busy}
                                onClick={() => deleteLocation(client.client_id, loc)}
                              >
                                -Loc
                              </button>
                            )}
                          </div>
                        }
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {createOpen && (
        <Modal title="Создать клиента" onClose={() => setCreateOpen(false)}>
          <div className="p-5">
            <ClientFormFields form={createForm} setForm={setCreateForm} includeClientID />
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setCreateOpen(false)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
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
            <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
              При изменении carrier или DNS будет создан новый room.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setEditClient(null)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
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
            <img
              className="h-64 w-64 rounded-md bg-white p-2"
              src={`https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(qrTarget.location.uri)}`}
              alt="QR"
            />
            <div className="max-w-full break-all rounded-md border border-border bg-background p-3 font-mono text-xs text-muted-foreground">
              {qrTarget.location.uri}
            </div>
            <div className="flex gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => copyOlcBoxLink(qrTarget.clientID, qrTarget.location.uri)}
              >
                Копировать URI
              </button>
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => copySubscription(qrTarget.clientID)}
              >
                Копировать Sub
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
                className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
                type="password"
                value={passwordForm.current}
                onChange={(event) => setPasswordForm({ ...passwordForm, current: event.target.value })}
                autoComplete="current-password"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Новый пароль
              <input
                className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
                type="password"
                value={passwordForm.next}
                onChange={(event) => setPasswordForm({ ...passwordForm, next: event.target.value })}
                autoComplete="new-password"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Повтор нового пароля
              <input
                className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
                type="password"
                value={passwordForm.repeat}
                onChange={(event) => setPasswordForm({ ...passwordForm, repeat: event.target.value })}
                autoComplete="new-password"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => setShowPassword(false)}
              >
                Отмена
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
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
            <div className="grid gap-2 rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
              <div>Статус: {logTarget.location.runtime.status}</div>
              {logTarget.location.runtime.pid && <div>PID: {logTarget.location.runtime.pid}</div>}
              {logTarget.location.runtime.started_at && <div>Started: {logTarget.location.runtime.started_at}</div>}
              {logTarget.location.runtime.exited_at && <div>Exited: {logTarget.location.runtime.exited_at}</div>}
              {logTarget.location.runtime.exit_error && (
                <div className="text-destructive">Exit: {logTarget.location.runtime.exit_error}</div>
              )}
            </div>

            <div className="mt-4 max-h-[420px] overflow-auto rounded-md border border-border bg-black p-3 font-mono text-xs text-slate-100">
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
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                onClick={() => openLogs(logTarget.clientID, logTarget.location)}
              >
                Обновить
              </button>
              <button
                className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
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

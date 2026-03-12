<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { NButton, NModal } from "naive-ui";

type ViewMode = "internal" | "external";
type ThemeMode = "aqua" | "slate" | "sand";

type Settings = {
  title: string;
  subtitle: string;
  announcement: string;
  footerNote: string;
  defaultView: ViewMode;
  cardStyle: "follow" | "detail" | "image";
  backgroundImage: string;
  theme: ThemeMode;
};

type NavItem = {
  id: string;
  name: string;
  externalUrl: string;
  internalUrl: string;
  imageUrl: string;
  bgColor: string;
  desc?: string;
  displayMode: "detail" | "image";
  iconMode: "auto" | "manual";
};

type NavGroup = {
  id: string;
  title: string;
  items: NavItem[];
};

type DragState =
  | { type: "group"; groupIndex: number }
  | { type: "item"; groupIndex: number; itemIndex: number }
  | null;

type SunPanelExport = {
  appName?: string;
  icons?: SunPanelGroup[];
};

type SunPanelGroup = {
  title?: string;
  sort?: number;
  children?: SunPanelItem[];
};

type SunPanelItem = {
  title?: string;
  url?: string;
  lanUrl?: string;
  description?: string;
  sort?: number;
  cardType?: number;
  backgroundColor?: string;
  icon?: {
    src?: string;
    backgroundColor?: string;
  };
};

const COLOR_PRESETS = [
  "#ffffff",
  "#f8fafc",
  "#e2e8f0",
  "#dbeafe",
  "#fee2e2",
  "#fef3c7",
  "#ecfccb",
  "#ede9fe",
  "#0f172a",
  "transparent",
];

const DEFAULT_SETTINGS: Settings = {
  title: "导航页",
  subtitle: "小卡片布局 + 内外网切换 + 分组管理",
  announcement: "",
  footerNote: "",
  defaultView: "external",
  cardStyle: "follow",
  backgroundImage: "",
  theme: "aqua",
};


const groups = ref<NavGroup[]>([]);
const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
const settingsOpen = ref(false);
const settingsTab = ref<
  "personal" | "groups" | "assets" | "integrations" | "system"
>("personal");
const cardSettingsOpen = ref(false);
const iconPickerOpen = ref(false);
const iconCandidates = ref<string[]>([]);
const iconPickerLoading = ref(false);
const cardSettingsItem = ref<NavItem | null>(null);
const cardSettingsGroupIndex = ref<number | null>(null);
const cardSettingsItemIndex = ref<number | null>(null);
const cardSettingsCreate = ref(false);
const cardSettingsTargetGroupIndex = ref<number | null>(null);
const importInputRef = ref<HTMLInputElement | null>(null);
const authLoading = ref(true);
const authToken = ref("");
const loginForm = ref({ token: "" });
const loginError = ref("");
const contextMenuOpen = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuGroupId = ref("");
const contextMenuItemId = ref("");
const viewMode = ref<ViewMode>("external");
const loading = ref(true);
const statusMessage = ref("");
const statusType = ref<"info" | "success" | "error">("info");
let statusTimer: number | null = null;
const searchQuery = ref("");
const collapsedGroups = ref<Record<string, boolean>>({});
const dragState = ref<DragState>(null);
const dragGhostEl = ref<HTMLElement | null>(null);
const dragItemId = ref<string | null>(null);
const dragOverGroupId = ref("");
const dragOverItemId = ref<string | null>(null);
const sortModeGroups = ref<Record<string, boolean>>({});
const settingsDragOverGroupIndex = ref<number | null>(null);

const isAdmin = computed(() => authToken.value.trim().length > 0);

const SETTINGS_TABS = [
  { id: "personal", label: "个性化设置", desc: "页面标题与样式" },
  { id: "groups", label: "分组管理", desc: "整理导航分组" },
  { id: "assets", label: "图标与背景", desc: "素材管理" },
  { id: "integrations", label: "Open API", desc: "接口调用" },
  { id: "system", label: "全局设置", desc: "保存与授权" },
] as const;


function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSettings(data: unknown): Settings {
  const raw = (data ?? {}) as Record<string, unknown>;
  const defaultView = raw.defaultView === "internal" ? "internal" : "external";
  const cardStyle =
    raw.cardStyle === "detail" || raw.cardStyle === "image" ? raw.cardStyle : "follow";
  const theme =
    raw.theme === "slate" || raw.theme === "sand" || raw.theme === "aqua"
      ? raw.theme
      : DEFAULT_SETTINGS.theme;
  return {
    title: typeof raw.title === "string" ? raw.title : DEFAULT_SETTINGS.title,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : DEFAULT_SETTINGS.subtitle,
    announcement: typeof raw.announcement === "string" ? raw.announcement : "",
    footerNote: typeof raw.footerNote === "string" ? raw.footerNote : "",
    defaultView,
    cardStyle,
    backgroundImage:
      typeof raw.backgroundImage === "string" ? raw.backgroundImage : DEFAULT_SETTINGS.backgroundImage,
    theme,
  };
}

function normalizeDedupeKey(item: NavItem): string {
  const ext = item.externalUrl.trim().toLowerCase();
  const internal = item.internalUrl.trim().toLowerCase();
  const urlKey = ext || internal;
  if (urlKey) {
    return `url:${urlKey}`;
  }
  return `name:${item.name.trim().toLowerCase()}`;
}

function dedupeGroups(data: NavGroup[]): NavGroup[] {
  const seen = new Set<string>();
  return data.map((group) => {
    const items: NavItem[] = [];
    for (const item of group.items) {
      const key = normalizeDedupeKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push(item);
    }
    return { ...group, items };
  });
}

function countItems(data: NavGroup[]): number {
  return data.reduce((sum, group) => sum + group.items.length, 0);
}

function isSunPanelExport(data: unknown): data is SunPanelExport {
  if (!data || typeof data !== "object") {
    return false;
  }
  const raw = data as Record<string, unknown>;
  return raw.appName === "Sun-Panel-Config" && Array.isArray(raw.icons);
}

function guessSunPanelOrigin(data: SunPanelExport): string {
  const groups = Array.isArray(data.icons) ? data.icons : [];
  for (const group of groups) {
    const children = Array.isArray(group.children) ? group.children : [];
    for (const item of children) {
      const url = typeof item.url === "string" ? item.url : "";
      const lanUrl = typeof item.lanUrl === "string" ? item.lanUrl : "";
      const candidate = url || lanUrl;
      if (!candidate) {
        continue;
      }
      try {
        const parsed = new URL(candidate);
        if (parsed.hostname.includes("panel")) {
          return parsed.origin;
        }
      } catch {
        // ignore
      }
    }
  }
  return "";
}

function resolveSunPanelIconSrc(src: string, origin: string): string {
  const trimmed = src.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/") && origin) {
    return `${origin}${trimmed}`;
  }
  return trimmed;
}

function normalizeSunPanelExport(data: SunPanelExport): NavGroup[] {
  const origin = guessSunPanelOrigin(data);
  const groups = Array.isArray(data.icons) ? data.icons : [];
  return groups
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((group) => {
      const title = typeof group.title === "string" ? group.title : "未命名分组";
      const children = Array.isArray(group.children) ? group.children : [];
      const items = children
        .slice()
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((child) => {
          const iconSrcRaw = typeof child.icon?.src === "string" ? child.icon.src : "";
          const iconSrc = resolveSunPanelIconSrc(iconSrcRaw, origin);
          const bgColor =
            (typeof child.backgroundColor === "string" && child.backgroundColor) ||
            (typeof child.icon?.backgroundColor === "string" && child.icon.backgroundColor) ||
            "";
          return {
            id: makeId("item"),
            name: typeof child.title === "string" ? child.title : "未命名卡片",
            externalUrl: typeof child.url === "string" ? child.url : "",
            internalUrl: typeof child.lanUrl === "string" ? child.lanUrl : "",
            imageUrl: iconSrc,
            bgColor,
            desc: typeof child.description === "string" ? child.description : "",
            displayMode: "detail",
            iconMode: iconSrc ? "manual" : "auto",
          } satisfies NavItem;
        });
      return {
        id: makeId("group"),
        title,
        items,
      } satisfies NavGroup;
    });
}

function normalizeGroups(data: unknown): NavGroup[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((rawGroup) => {
    const group = (rawGroup ?? {}) as Record<string, unknown>;
    const itemsRaw = Array.isArray(group.items) ? group.items : [];
    const items = itemsRaw.map((rawItem) => {
      const item = (rawItem ?? {}) as Record<string, unknown>;
      const legacyUrl = typeof item.url === "string" ? item.url : "";
      const legacyScope = item.scope === "internal" ? "internal" : "external";
      const legacyImage = typeof item.image === "string" ? item.image : "";
      const legacyColor =
        typeof item.bgColor === "string"
          ? item.bgColor
          : typeof item.background === "string"
            ? item.background
            : "";
      const displayMode = item.displayMode === "image" ? "image" : "detail";
      const iconMode =
        item.iconMode === "manual" || item.iconMode === "auto"
          ? item.iconMode
          : legacyImage
            ? "manual"
            : "auto";
      return {
        id: typeof item.id === "string" ? item.id : makeId("item"),
        name: typeof item.name === "string" ? item.name : "",
        externalUrl:
          typeof item.externalUrl === "string"
            ? item.externalUrl
            : legacyScope === "external"
              ? legacyUrl
              : "",
        internalUrl:
          typeof item.internalUrl === "string"
            ? item.internalUrl
            : legacyScope === "internal"
              ? legacyUrl
              : "",
        imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : legacyImage,
        bgColor: legacyColor,
        desc: typeof item.desc === "string" ? item.desc : "",
        displayMode,
        iconMode,
      } satisfies NavItem;
    });
    return {
      id: typeof group.id === "string" ? group.id : makeId("group"),
      title: typeof group.title === "string" ? group.title : "未命名分组",
      items,
    } satisfies NavGroup;
  });
}

function cloneGroups(data: NavGroup[]): NavGroup[] {
  return data.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item })),
  }));
}

function applySettings(nextSettings: Settings): void {
  settings.value = { ...nextSettings };
  viewMode.value = settings.value.defaultView;
}

const pageStyle = computed(() => {
  const image = settings.value.backgroundImage?.trim();
  if (!image) {
    return undefined;
  }
  return {
    backgroundImage: `url(${image})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  } as const;
});

function matchesText(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

function itemMatches(item: NavItem, query: string): boolean {
  return (
    matchesText(item.name, query) ||
    matchesText(item.externalUrl, query) ||
    matchesText(item.internalUrl, query) ||
    (item.desc ? matchesText(item.desc, query) : false)
  );
}

function groupMatches(group: NavGroup, query: string): boolean {
  return matchesText(group.title, query);
}

const searchLower = computed(() => searchQuery.value.trim().toLowerCase());

const visibleGroups = computed(() => {
  const query = searchLower.value;
  return groups.value
    .map((group) => {
      const namedItems = group.items.filter((item) => item.name.trim().length > 0);
      if (!query) {
        return { ...group, items: namedItems };
      }
      const groupHit = groupMatches(group, query);
      const filtered = groupHit ? namedItems : namedItems.filter((item) => itemMatches(item, query));
      return { ...group, items: filtered };
    })
    .filter((group) => group.items.length > 0);
});

function linkInfo(item: NavItem): { url: string; label: string; disabled: boolean } {
  const preferred = viewMode.value === "internal" ? item.internalUrl : item.externalUrl;
  const fallback = viewMode.value === "internal" ? item.externalUrl : item.internalUrl;
  if (preferred.trim().length > 0) {
    return {
      url: preferred,
      label: viewMode.value === "internal" ? "内网" : "外网",
      disabled: false,
    };
  }
  if (fallback.trim().length > 0) {
    return {
      url: fallback,
      label: viewMode.value === "internal" ? "外网" : "内网",
      disabled: false,
    };
  }
  return {
    url: "",
    label: viewMode.value === "internal" ? "内网未配置" : "外网未配置",
    disabled: true,
  };
}

function normalizeHostname(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  const withScheme = /^(https?:)?\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname;
  } catch {
    return "";
  }
}

function normalizeOrigin(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  const withScheme = /^(https?:)?\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.origin;
  } catch {
    return "";
  }
}

function autoIconUrl(item: NavItem): string {
  const candidate = linkInfo(item).url || item.externalUrl || item.internalUrl;
  const hostname = normalizeHostname(candidate);
  if (!hostname) {
    return "";
  }
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
}

function resolvedImageUrl(item: NavItem): string {
  if (item.iconMode === "manual") {
    return item.imageUrl?.trim() ?? "";
  }
  return autoIconUrl(item);
}

function imageUrlFromLink(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  if (/\.(png|jpe?g|svg|webp|gif)(\?|#|$)/i.test(trimmed)) {
    return trimmed;
  }
  const origin = normalizeOrigin(trimmed);
  if (origin) {
    return `${origin}/favicon.ico`;
  }
  const hostname = normalizeHostname(trimmed);
  if (!hostname) {
    return "";
  }
  return `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
}

function buildIconCandidates(rawUrl: string): string[] {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return [];
  }
  const candidates = new Set<string>();
  const origin = normalizeOrigin(trimmed);
  if (origin) {
    candidates.add(`${origin}/favicon.ico`);
    candidates.add(`${origin}/favicon.png`);
    candidates.add(`${origin}/favicon.svg`);
    candidates.add(`${origin}/apple-touch-icon.png`);
    candidates.add(`${origin}/apple-touch-icon-precomposed.png`);
  }
  const direct = imageUrlFromLink(trimmed);
  if (direct) {
    candidates.add(direct);
  }
  const hostname = normalizeHostname(trimmed);
  if (hostname) {
    // Fallback providers: keep a small set and filter by probe.
    candidates.add(`https://www.google.com/s2/favicons?domain=${hostname}&sz=128`);
    candidates.add(`https://icons.duckduckgo.com/ip3/${hostname}.ico`);
    candidates.add(`https://icon.horse/icon/${hostname}`);
    candidates.add(`https://favicon.yandex.net/favicon/${hostname}`);
  }
  return Array.from(candidates);
}

let iconPickerSeq = 0;

async function probeIcon(url: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const img = new Image();
    const timer = window.setTimeout(() => {
      resolve(false);
    }, 2500);
    const done = (ok: boolean): void => {
      window.clearTimeout(timer);
      resolve(ok);
    };
    img.onload = () => {
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      done(width >= 16 && height >= 16);
    };
    img.onerror = () => done(false);
    img.src = url;
  });
}

async function resolveValidIconCandidates(candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) {
    return [];
  }
  const checks = await Promise.all(
    candidates.map(async (url) => ({
      url,
      ok: await probeIcon(url),
    })),
  );
  return checks.filter((item) => item.ok).map((item) => item.url);
}

async function fetchDeepIconCandidates(rawUrl: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (authToken.value.trim()) {
    headers.Authorization = `Bearer ${authToken.value.trim()}`;
  }
  try {
    const res = await fetch(`/api/icon-candidates?url=${encodeURIComponent(rawUrl)}`, {
      headers,
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { candidates?: unknown };
    const list = Array.isArray(data.candidates) ? data.candidates : [];
    return list.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

async function openIconPicker(rawUrl: string): Promise<void> {
  if (!cardSettingsItem.value) {
    return;
  }
  const rawCandidates = buildIconCandidates(rawUrl);
  if (rawCandidates.length === 0) {
    setStatus("无法获取图标，请检查地址。", "error");
    return;
  }
  const seq = (iconPickerSeq += 1);
  iconPickerOpen.value = true;
  iconPickerLoading.value = true;
  iconCandidates.value = [];
  const deepCandidates = await fetchDeepIconCandidates(rawUrl);
  const mergedCandidates = Array.from(new Set([...deepCandidates, ...rawCandidates]));
  const candidates = await resolveValidIconCandidates(mergedCandidates.slice(0, 24));
  if (seq !== iconPickerSeq) {
    return;
  }
  iconPickerLoading.value = false;
  if (candidates.length === 0) {
    setStatus("未找到可用图标，请手动填写图片 URL。", "error");
    return;
  }
  iconCandidates.value = candidates.slice(0, 12);
}

function chooseIcon(url: string): void {
  if (!cardSettingsItem.value) {
    return;
  }
  cardSettingsItem.value.iconMode = "manual";
  cardSettingsItem.value.imageUrl = url;
  iconPickerOpen.value = false;
  setStatus("已应用图标。", "success");
}

function cardInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "?";
  }
  return trimmed.slice(0, 1).toUpperCase();
}

function effectiveCardMode(item: NavItem): "detail" | "image" {
  if (settings.value.cardStyle === "follow") {
    return item.displayMode;
  }
  return settings.value.cardStyle;
}

function cardClass(item: NavItem): string {
  return effectiveCardMode(item) === "image" ? "mini-card image" : "mini-card detail";
}

function cardStyle(item: NavItem): Record<string, string> | undefined {
  const color = item.bgColor?.trim();
  if (!color) {
    return undefined;
  }
  return { background: color };
}

function setPresetColor(item: NavItem, color: string): void {
  item.bgColor = color;
}

function safeColorValue(color: string): string {
  const value = color.trim();
  if (/^#([0-9a-fA-F]{6})$/.test(value)) {
    return value;
  }
  if (/^#([0-9a-fA-F]{3})$/.test(value)) {
    const r = value[1];
    const g = value[2];
    const b = value[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#f8fafc";
}

function setStatus(message: string, type: "info" | "success" | "error" = "info"): void {
  statusMessage.value = message;
  statusType.value = type;
  if (statusTimer) {
    window.clearTimeout(statusTimer);
    statusTimer = null;
  }
  if (!message) {
    return;
  }
  const timeout = type === "error" ? 5000 : 3200;
  statusTimer = window.setTimeout(() => {
    statusMessage.value = "";
    statusTimer = null;
  }, timeout);
}

async function verifyAuth(token: string): Promise<boolean> {
  if (!token.trim()) {
    return false;
  }
  try {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token.trim()}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function verifyOpenMode(): Promise<boolean> {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) {
      return false;
    }
    const data = (await res.json()) as { authRequired?: boolean };
    return data.authRequired === false;
  } catch {
    return false;
  }
}

async function fetchAuthState(): Promise<void> {
  authLoading.value = true;
  try {
    const stored = typeof window !== "undefined" ? localStorage.getItem("auth_token") ?? "" : "";
    if (!stored) {
      const openMode = await verifyOpenMode();
      if (openMode) {
        authToken.value = "open";
        if (typeof window !== "undefined") {
          localStorage.setItem("auth_token", "open");
        }
        return;
      }
      authToken.value = "";
      return;
    }
    const ok = await verifyAuth(stored);
    if (ok) {
      authToken.value = stored;
    } else {
      authToken.value = "";
      if (typeof window !== "undefined") {
        localStorage.removeItem("auth_token");
      }
    }
  } finally {
    authLoading.value = false;
  }
}

async function login(): Promise<void> {
  loginError.value = "";
  const token = loginForm.value.token.trim();
  if (!token) {
    loginError.value = "请输入认证口令。";
    return;
  }
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const msg = await res.text();
      loginError.value = msg || "登录失败。";
      return;
    }
    authToken.value = token;
    if (typeof window !== "undefined") {
      localStorage.setItem("auth_token", token);
    }
    loginForm.value = { token: "" };
    void loadNav();
  } catch {
    loginError.value = "登录失败，请稍后重试。";
  }
}

async function logout(): Promise<void> {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {
    // ignore
  }
  authToken.value = "";
  if (typeof window !== "undefined") {
    localStorage.removeItem("auth_token");
  }
  groups.value = [];
}

function openSettings(): void {
  settingsTab.value = "personal";
  settingsOpen.value = true;
}

function openCardSettings(groupId: string, itemId: string): void {
  const groupIndex = groups.value.findIndex((group) => group.id === groupId);
  if (groupIndex < 0) {
    return;
  }
  const itemIndex = groups.value[groupIndex].items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) {
    return;
  }
  const item = groups.value[groupIndex].items[itemIndex];
  cardSettingsItem.value = item;
  cardSettingsGroupIndex.value = groupIndex;
  cardSettingsItemIndex.value = itemIndex;
  cardSettingsCreate.value = false;
  cardSettingsTargetGroupIndex.value = groupIndex;
  cardSettingsOpen.value = true;
}

function openCreateCard(groupId: string): void {
  const groupIndex = groups.value.findIndex((group) => group.id === groupId);
  if (groupIndex < 0) {
    return;
  }
  cardSettingsItem.value = {
    id: makeId("item"),
    name: "新链接",
    externalUrl: "",
    internalUrl: "",
    imageUrl: "",
    bgColor: "",
    desc: "",
    displayMode: "detail",
    iconMode: "auto",
  };
  cardSettingsGroupIndex.value = groupIndex;
  cardSettingsItemIndex.value = null;
  cardSettingsCreate.value = true;
  cardSettingsTargetGroupIndex.value = groupIndex;
  cardSettingsOpen.value = true;
}

function openContextMenu(
  groupId: string,
  itemId: string,
  event: MouseEvent | PointerEvent,
): void {
  contextMenuGroupId.value = groupId;
  contextMenuItemId.value = itemId;
  contextMenuX.value = event.clientX;
  contextMenuY.value = event.clientY;
  contextMenuOpen.value = true;
}

function closeContextMenu(): void {
  contextMenuOpen.value = false;
}

function findItemById(groupId: string, itemId: string): { groupIndex: number; itemIndex: number } {
  const groupIndex = groups.value.findIndex((group) => group.id === groupId);
  if (groupIndex < 0) {
    return { groupIndex: -1, itemIndex: -1 };
  }
  const itemIndex = groups.value[groupIndex].items.findIndex((item) => item.id === itemId);
  return { groupIndex, itemIndex };
}

function findGroupIndex(groupId: string): number {
  return groups.value.findIndex((group) => group.id === groupId);
}

function clearDragState(): void {
  dragState.value = null;
  dragOverGroupId.value = "";
  dragOverItemId.value = null;
  dragItemId.value = null;
  settingsDragOverGroupIndex.value = null;
  cleanupDragGhost();
}

function removeItemById(groupId: string, itemId: string): void {
  const { groupIndex, itemIndex } = findItemById(groupId, itemId);
  if (groupIndex < 0 || itemIndex < 0) {
    return;
  }
  groups.value[groupIndex].items.splice(itemIndex, 1);
}

function openLink(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) {
    return;
  }
  window.open(trimmed, "_blank", "noopener,noreferrer");
}

async function copyLink(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) {
    return;
  }
  try {
    await navigator.clipboard.writeText(trimmed);
    setStatus("已复制地址。", "success");
  } catch {
    setStatus("复制失败，请手动复制。", "error");
  }
}

const contextMenuItem = computed(() => {
  const { groupIndex, itemIndex } = findItemById(
    contextMenuGroupId.value,
    contextMenuItemId.value,
  );
  if (groupIndex < 0 || itemIndex < 0) {
    return null;
  }
  return groups.value[groupIndex].items[itemIndex];
});

watch(contextMenuOpen, (open) => {
  if (!open) {
    return;
  }
  const handler = () => closeContextMenu();
  const keyHandler = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeContextMenu();
    }
  };
  const stopContext = (event: MouseEvent) => event.preventDefault();
  window.addEventListener("click", handler, { once: true });
  window.addEventListener("scroll", handler, { once: true });
  window.addEventListener("resize", handler, { once: true });
  window.addEventListener("keydown", keyHandler, { once: true });
  window.addEventListener("contextmenu", stopContext, { once: true });
});

watch(authToken, (token) => {
  if (token.trim()) {
    void loadNav();
  }
});

watch(
  () => settings.value.theme,
  (theme) => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.theme = theme;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  closeContextMenu();
});

function closeCardSettings(): void {
  cardSettingsOpen.value = false;
  cardSettingsItem.value = null;
  cardSettingsGroupIndex.value = null;
  cardSettingsItemIndex.value = null;
  cardSettingsCreate.value = false;
  cardSettingsTargetGroupIndex.value = null;
}

function removeCardFromSettings(): void {
  if (cardSettingsCreate.value) {
    closeCardSettings();
    return;
  }
  if (cardSettingsGroupIndex.value === null || cardSettingsItemIndex.value === null) {
    return;
  }
  const group = groups.value[cardSettingsGroupIndex.value];
  if (!group) {
    return;
  }
  group.items.splice(cardSettingsItemIndex.value, 1);
  closeCardSettings();
}

function saveCardFromSettings(): void {
  const groupIndex = cardSettingsGroupIndex.value;
  const targetGroupIndex = cardSettingsTargetGroupIndex.value ?? groupIndex;
  const item = cardSettingsItem.value;
  if (groupIndex === null || targetGroupIndex === null || !item) {
    return;
  }
  const targetGroup = groups.value[targetGroupIndex];
  if (!targetGroup) {
    return;
  }
  if (cardSettingsCreate.value) {
    targetGroup.items.push(item);
    setStatus("已新增卡片。", "success");
  } else if (targetGroupIndex !== groupIndex && cardSettingsItemIndex.value !== null) {
    const sourceGroup = groups.value[groupIndex];
    if (!sourceGroup) {
      return;
    }
    sourceGroup.items.splice(cardSettingsItemIndex.value, 1);
    targetGroup.items.push(item);
    setStatus("已移动到新分组。", "success");
  }
  cardSettingsCreate.value = false;
  closeCardSettings();
  void saveNav();
}

async function loadNav(): Promise<void> {
  loading.value = true;
  setStatus("");
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken.value.trim()) {
      headers.Authorization = `Bearer ${authToken.value.trim()}`;
    }
    const res = await fetch("/api/nav", {
      headers,
    });
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }
    const data = (await res.json()) as unknown;
    let normalizedGroups: NavGroup[] = [];
    let normalizedSettings = { ...DEFAULT_SETTINGS };
    if (Array.isArray(data)) {
      normalizedGroups = normalizeGroups(data);
    } else if (data && typeof data === "object") {
      const payload = data as { settings?: unknown; groups?: unknown };
      normalizedGroups = normalizeGroups(payload.groups ?? []);
      normalizedSettings = normalizeSettings(payload.settings);
    }

    groups.value = normalizedGroups;
    applySettings(normalizedSettings);
    if (normalizedGroups.length === 0) {
      setStatus("API 返回空数据。", "info");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    groups.value = [];
    applySettings(DEFAULT_SETTINGS);
    setStatus(`API 读取失败：${message}`, "error");
  } finally {
    loading.value = false;
  }
}

function resetSettings(): void {
  applySettings(DEFAULT_SETTINGS);
  setStatus("已恢复默认设置。", "success");
}

function exportNavData(): void {
  const payload = {
    settings: settings.value,
    groups: groups.value,
  };
  const content = JSON.stringify(payload, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `nav-export-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus("已导出配置。", "success");
}

function triggerImport(): void {
  importInputRef.value?.click();
}

async function handleImportChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text) as unknown;
    let normalizedGroups: NavGroup[] = [];
    let normalizedSettings = { ...settings.value };
    if (Array.isArray(data)) {
      normalizedGroups = normalizeGroups(data);
    } else if (data && typeof data === "object") {
      if (isSunPanelExport(data)) {
        normalizedGroups = normalizeSunPanelExport(data);
      } else {
        const payload = data as { settings?: unknown; groups?: unknown };
        normalizedGroups = normalizeGroups(payload.groups ?? []);
        if (payload.settings) {
          normalizedSettings = normalizeSettings(payload.settings);
        }
      }
    } else {
      throw new Error("格式无效");
    }
    const beforeCount = countItems(normalizedGroups);
    const dedupedGroups = dedupeGroups(normalizedGroups);
    const afterCount = countItems(dedupedGroups);
    const removedCount = beforeCount - afterCount;
    groups.value = dedupedGroups;
    applySettings(normalizedSettings);
    const suffix = removedCount > 0 ? `，已过滤 ${removedCount} 项重复数据` : "";
    if (isAdmin.value) {
      setStatus(`已导入配置${suffix}，正在保存...`, "info");
      await saveNav();
    } else {
      setStatus(`已导入配置${suffix}，请保存设置。`, "success");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    setStatus(`导入失败：${message}`, "error");
  } finally {
    input.value = "";
  }
}

function addGroup(): void {
  groups.value.push({
    id: makeId("group"),
    title: "新分组",
    items: [],
  });
}

function removeGroup(index: number): void {
  groups.value.splice(index, 1);
}

function confirmRemoveGroup(index: number): void {
  const name = groups.value[index]?.title?.trim() || "该分组";
  if (typeof window !== "undefined") {
    const ok = window.confirm(`确定删除“${name}”吗？`);
    if (!ok) {
      return;
    }
  }
  removeGroup(index);
}

function moveGroup(index: number, direction: number): void {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= groups.value.length) {
    return;
  }
  const [moved] = groups.value.splice(index, 1);
  groups.value.splice(nextIndex, 0, moved);
}

function moveGroupById(groupId: string, direction: number): void {
  const index = findGroupIndex(groupId);
  if (index < 0) {
    return;
  }
  moveGroup(index, direction);
}

function moveGroupTo(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) {
    return;
  }
  const [moved] = groups.value.splice(fromIndex, 1);
  const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex;
  groups.value.splice(adjusted, 0, moved);
}

function addItemById(groupId: string): void {
  openCreateCard(groupId);
}

function removeItem(groupIndex: number, itemIndex: number): void {
  groups.value[groupIndex]?.items.splice(itemIndex, 1);
}

function moveItem(groupIndex: number, itemIndex: number, direction: number): void {
  const items = groups.value[groupIndex]?.items;
  if (!items) {
    return;
  }
  const nextIndex = itemIndex + direction;
  if (nextIndex < 0 || nextIndex >= items.length) {
    return;
  }
  const [moved] = items.splice(itemIndex, 1);
  items.splice(nextIndex, 0, moved);
}

function moveItemTo(groupIndex: number, fromIndex: number, toIndex: number): void {
  const items = groups.value[groupIndex]?.items;
  if (!items || fromIndex === toIndex) {
    return;
  }
  const [moved] = items.splice(fromIndex, 1);
  const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex;
  items.splice(adjusted, 0, moved);
}

function toggleCollapse(groupId: string): void {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [groupId]: !collapsedGroups.value[groupId],
  };
}

function isCollapsed(groupId: string): boolean {
  return Boolean(collapsedGroups.value[groupId]);
}

function isGroupSortEnabled(groupId: string): boolean {
  return Boolean(sortModeGroups.value[groupId]);
}

function toggleGroupSortMode(groupId: string): void {
  sortModeGroups.value = {
    ...sortModeGroups.value,
    [groupId]: !sortModeGroups.value[groupId],
  };
}

function cleanupDragGhost(): void {
  const ghost = dragGhostEl.value;
  if (ghost?.parentElement) {
    ghost.parentElement.removeChild(ghost);
  }
  dragGhostEl.value = null;
}

function setDragImageFromTarget(event: DragEvent): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  cleanupDragGhost();
  const rect = target.getBoundingClientRect();
  const ghost = target.cloneNode(true) as HTMLElement;
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.position = "fixed";
  ghost.style.top = "-1000px";
  ghost.style.left = "-1000px";
  document.body.appendChild(ghost);
  const offsetX = rect.width ? rect.width / 2 : 0;
  const offsetY = rect.height ? rect.height / 2 : 0;
  event.dataTransfer?.setDragImage?.(ghost, offsetX, offsetY);
  dragGhostEl.value = ghost;
}

function handleGroupDragStart(index: number, event: DragEvent): void {
  dragState.value = { type: "group", groupIndex: index };
  event.dataTransfer?.setData("text/plain", "group");
  setDragImageFromTarget(event);
}

function handleGroupDragOver(event: DragEvent): void {
  if (dragState.value?.type !== "group") {
    return;
  }
  event.preventDefault();
}

function handleGroupDrop(index: number): void {
  if (dragState.value?.type !== "group") {
    return;
  }
  moveGroupTo(dragState.value.groupIndex, index);
  clearDragState();
}

function handleGroupDropToEnd(): void {
  if (dragState.value?.type !== "group") {
    return;
  }
  moveGroupTo(dragState.value.groupIndex, groups.value.length);
  clearDragState();
}

function handleSettingsGroupDragOver(index: number, event: DragEvent): void {
  if (dragState.value?.type !== "group") {
    return;
  }
  event.preventDefault();
  settingsDragOverGroupIndex.value = index;
}

function handleSettingsGroupDragLeave(): void {
  if (dragState.value?.type !== "group") {
    return;
  }
  settingsDragOverGroupIndex.value = null;
}

function handleSettingsGroupDrop(index: number): void {
  handleGroupDrop(index);
  settingsDragOverGroupIndex.value = null;
}

function handleSettingsGroupDropToEnd(): void {
  handleGroupDropToEnd();
  settingsDragOverGroupIndex.value = null;
}

function handleItemDragStart(groupIndex: number, itemIndex: number, event: DragEvent): void {
  dragState.value = { type: "item", groupIndex, itemIndex };
  event.dataTransfer?.setData("text/plain", "item");
  setDragImageFromTarget(event);
}

function handleItemDragOver(groupIndex: number, event: DragEvent): void {
  if (dragState.value?.type !== "item") {
    return;
  }
  if (dragState.value.groupIndex !== groupIndex) {
    return;
  }
  event.preventDefault();
}

function handleItemDrop(groupIndex: number, itemIndex: number): void {
  if (dragState.value?.type !== "item") {
    return;
  }
  if (dragState.value.groupIndex !== groupIndex) {
    clearDragState();
    return;
  }
  moveItemTo(groupIndex, dragState.value.itemIndex, itemIndex);
  clearDragState();
}

function isSettingsGroupDragOver(index: number): boolean {
  return dragState.value?.type === "group" && settingsDragOverGroupIndex.value === index;
}

function handleItemDragStartById(groupId: string, itemId: string, event: DragEvent): void {
  if (!isGroupSortEnabled(groupId)) {
    return;
  }
  dragItemId.value = itemId;
  const { groupIndex, itemIndex } = findItemById(groupId, itemId);
  if (groupIndex < 0 || itemIndex < 0) {
    return;
  }
  handleItemDragStart(groupIndex, itemIndex, event);
}

function handleItemDragOverById(groupId: string, event: DragEvent): void {
  if (!isGroupSortEnabled(groupId)) {
    return;
  }
  const groupIndex = findGroupIndex(groupId);
  if (groupIndex < 0) {
    return;
  }
  handleItemDragOver(groupIndex, event);
  dragOverGroupId.value = groupId;
  dragOverItemId.value = null;
}

function handleItemDropById(groupId: string, itemId: string): void {
  if (!isGroupSortEnabled(groupId)) {
    return;
  }
  const { groupIndex, itemIndex } = findItemById(groupId, itemId);
  if (groupIndex < 0 || itemIndex < 0) {
    return;
  }
  handleItemDrop(groupIndex, itemIndex);
  dragOverGroupId.value = "";
  dragOverItemId.value = null;
}

function handleItemDropToEnd(groupId: string): void {
  if (!isGroupSortEnabled(groupId)) {
    return;
  }
  if (dragState.value?.type !== "item") {
    return;
  }
  const groupIndex = findGroupIndex(groupId);
  if (groupIndex < 0 || dragState.value.groupIndex !== groupIndex) {
    dragState.value = null;
    return;
  }
  const items = groups.value[groupIndex]?.items ?? [];
  moveItemTo(groupIndex, dragState.value.itemIndex, items.length);
  clearDragState();
}

function handleItemDragOverTarget(groupId: string, itemId: string, event: DragEvent): void {
  if (!isGroupSortEnabled(groupId)) {
    return;
  }
  const groupIndex = findGroupIndex(groupId);
  if (groupIndex < 0) {
    return;
  }
  handleItemDragOver(groupIndex, event);
  if (dragState.value?.type === "item" && dragItemId.value) {
    const current = findItemById(groupId, dragItemId.value);
    const target = findItemById(groupId, itemId);
    if (current.groupIndex === groupIndex && target.itemIndex >= 0) {
      if (current.itemIndex !== target.itemIndex) {
        const nextIndex = current.itemIndex < target.itemIndex ? target.itemIndex - 1 : target.itemIndex;
        moveItemTo(groupIndex, current.itemIndex, target.itemIndex);
        dragState.value = { type: "item", groupIndex, itemIndex: nextIndex };
      }
    }
  }
  dragOverGroupId.value = groupId;
  dragOverItemId.value = itemId;
}

function isDragOverItem(groupId: string, itemId: string): boolean {
  return (
    dragState.value?.type === "item" &&
    dragOverGroupId.value === groupId &&
    dragOverItemId.value === itemId
  );
}

function isDragOverEnd(groupId: string): boolean {
  return (
    dragState.value?.type === "item" &&
    dragOverGroupId.value === groupId &&
    dragOverItemId.value === null
  );
}

function isDraggingItem(groupId: string, itemId: string): boolean {
  return dragState.value?.type === "item" && dragItemId.value === itemId;
}

function handleCardClick(event: MouseEvent, groupId: string): void {
  if (!isGroupSortEnabled(groupId)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}

function clearSearch(): void {
  searchQuery.value = "";
}

async function saveNav(): Promise<void> {
  if (!isAdmin.value) {
    setStatus("需要认证口令才能保存。", "error");
    return;
  }
  setStatus("保存中...", "info");
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken.value.trim()}`,
    };
    const res = await fetch("/api/nav", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        settings: settings.value,
        groups: groups.value,
      }),
    });
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }
    setStatus("保存成功。", "success");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    setStatus(`保存失败：${message}`, "error");
  }
}

onMounted(() => {
  void fetchAuthState();
});
</script>

<template>
  <main v-if="authLoading" class="auth-page" :style="pageStyle">
    <div class="login-card">
      <div class="login-head">
        <h1>正在验证登录...</h1>
        <p class="login-muted">请稍候</p>
      </div>
    </div>
  </main>

  <main v-else-if="!authToken" class="auth-page" :style="pageStyle">
    <div class="login-card">
      <div class="login-head">
        <h1>欢迎登录</h1>
      </div>
      <label class="field">
        <input
          v-model="loginForm.token"
          class="input"
          type="password"
          placeholder="请输入认证口令"
        />
      </label>
      <button class="btn login-btn" type="button" @click="login">登录</button>
      <p v-if="loginError" class="login-error">{{ loginError }}</p>
    </div>
  </main>

  <main v-else class="page" :style="pageStyle">
    <header class="hero">
      <div class="hero-title">
        <h1>{{ settings.title }}</h1>
        <p v-if="settings.subtitle" class="subtitle">{{ settings.subtitle }}</p>
        <p v-if="settings.announcement" class="announcement">{{ settings.announcement }}</p>
      </div>
      <div class="hero-actions">
        <div class="search">
          <input v-model="searchQuery" class="input" placeholder="搜索分组/链接" />
          <button v-if="searchQuery" class="btn ghost" type="button" @click="clearSearch">
            清空
          </button>
        </div>
        <div class="actions"></div>
      </div>
    </header>

    <div class="control-dock" aria-label="快速控制">
      <button
        class="dock-btn"
        type="button"
        :data-active="viewMode === 'internal'"
        :title="viewMode === 'internal' ? '当前：内网（点击切换外网）' : '当前：外网（点击切换内网）'"
        @click="viewMode = viewMode === 'internal' ? 'external' : 'internal'"
      >
        <span class="sr-only">切换内外网</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-1.5 2.3v2.2a16 16 0 0 0-3.9.9A7.5 7.5 0 0 1 10.5 5.3Zm3 0a7.5 7.5 0 0 1 3.9 3.1 16 16 0 0 0-3.9-.9V5.3ZM5.1 9.9a14.4 14.4 0 0 1 5.4-1.1v2.7H4.7c.1-.6.2-1.1.4-1.6Zm13.8 0c.2.5.3 1 .4 1.6h-5.8V8.8a14.4 14.4 0 0 1 5.4 1.1ZM4.7 13.5h5.8v2.7a14.4 14.4 0 0 1-5.4-1.1c-.2-.5-.3-1-.4-1.6Zm8.8 0h5.8c-.1.6-.2 1.1-.4 1.6a14.4 14.4 0 0 1-5.4 1.1v-2.7Zm-3 3.2v2.1a7.5 7.5 0 0 1-3.9-3.1c1.2.5 2.5.8 3.9 1Zm3 0c1.4-.2 2.7-.5 3.9-1a7.5 7.5 0 0 1-3.9 3.1v-2.1Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        v-if="authToken"
        class="dock-btn"
        type="button"
        title="退出登录"
        @click="logout"
      >
        <span class="sr-only">退出登录</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M13 3a1 1 0 0 1 1 1v4h-2V5H6v14h6v-3h2v4a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7Zm4.7 6.3 3 2.7-3 2.7-1.4-1.4L17.6 13H10v-2h7.6l-1.3-1.3 1.4-1.4Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button class="dock-btn" type="button" title="设置" @click="openSettings">
        <span class="sr-only">打开设置</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 3h4v4H5V3Zm5 7h4v4h-4v-4Zm0-7h4v4h-4V3ZM5 10h4v4H5v-4Zm10-7h4v4h-4V3Zm0 7h4v4h-4v-4ZM5 17h4v4H5v-4Zm5 0h4v4h-4v-4Zm5 0h4v4h-4v-4Z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>

    <transition name="toast">
      <div v-if="statusMessage" class="toast" :data-type="statusType">
        {{ statusMessage }}
      </div>
    </transition>

    <section v-if="loading" class="state">加载中...</section>

    <section v-else class="groups">
      <article v-for="group in visibleGroups" :key="group.id" class="group-block">
        <header class="group-header">
          <div class="group-title">
            <h2>{{ group.title }}</h2>
          </div>
          <div class="group-actions">
            <template v-if="isAdmin">
              <button
                class="group-action-btn icon icon-add"
                type="button"
                @click="addItemById(group.id)"
              >
                <span class="sr-only">新增卡片</span>
              </button>
              <button
                class="group-action-btn icon icon-sort"
                type="button"
                :data-active="isGroupSortEnabled(group.id)"
                @click="toggleGroupSortMode(group.id)"
              >
                <span class="sr-only">
                  {{ isGroupSortEnabled(group.id) ? "完成排序" : "卡片排序" }}
                </span>
              </button>
            </template>
            <button
              class="group-action-btn icon icon-collapse"
              type="button"
              :data-collapsed="isCollapsed(group.id)"
              @click="toggleCollapse(group.id)"
            >
              <span class="sr-only">{{ isCollapsed(group.id) ? "展开" : "折叠" }}</span>
            </button>
          </div>
        </header>
        <div
          class="card-grid"
          v-show="!isCollapsed(group.id)"
          @dragover="handleItemDragOverById(group.id, $event)"
          @drop="handleItemDropToEnd(group.id)"
          :class="{ 'drag-over-end': isDragOverEnd(group.id) }"
        >
          <template v-for="item in group.items" :key="item.id">
            <a
              v-if="!linkInfo(item).disabled"
              :class="[
                cardClass(item),
                { 'drag-over': isDragOverItem(group.id, item.id) },
                { 'dragging-item': isDraggingItem(group.id, item.id) },
              ]"
              :style="cardStyle(item)"
              :href="linkInfo(item).url"
              target="_blank"
              rel="noreferrer"
              :draggable="isGroupSortEnabled(group.id)"
              @click="handleCardClick($event, group.id)"
              @contextmenu.prevent="openContextMenu(group.id, item.id, $event)"
              @dragstart="handleItemDragStartById(group.id, item.id, $event)"
              @dragover="handleItemDragOverTarget(group.id, item.id, $event)"
              @drop="handleItemDropById(group.id, item.id)"
              @dragend="clearDragState"
            >
              <div class="mini-card-media">
                <img
                  v-if="resolvedImageUrl(item)"
                  :src="resolvedImageUrl(item)"
                  :alt="item.name"
                  draggable="false"
                  @dragstart.prevent
                />
                <span v-else class="mini-card-fallback">{{ cardInitial(item.name) }}</span>
              </div>
              <div v-if="effectiveCardMode(item) === 'detail'" class="mini-card-content">
                <h3>{{ item.name }}</h3>
                <p v-if="item.desc" class="mini-card-desc">{{ item.desc }}</p>
              </div>
            </a>
            <div
              v-else
              :class="[
                cardClass(item),
                'disabled',
                { 'drag-over': isDragOverItem(group.id, item.id) },
                { 'dragging-item': isDraggingItem(group.id, item.id) },
              ]"
              :style="cardStyle(item)"
              aria-disabled="true"
              :draggable="isGroupSortEnabled(group.id)"
              @contextmenu.prevent="openContextMenu(group.id, item.id, $event)"
              @dragstart="handleItemDragStartById(group.id, item.id, $event)"
              @dragover="handleItemDragOverTarget(group.id, item.id, $event)"
              @drop="handleItemDropById(group.id, item.id)"
              @dragend="clearDragState"
            >
              <div class="mini-card-media">
                <img
                  v-if="resolvedImageUrl(item)"
                  :src="resolvedImageUrl(item)"
                  :alt="item.name"
                  draggable="false"
                  @dragstart.prevent
                />
                <span v-else class="mini-card-fallback">{{ cardInitial(item.name) }}</span>
              </div>
              <div v-if="effectiveCardMode(item) === 'detail'" class="mini-card-content">
                <h3>{{ item.name }}</h3>
                <p v-if="item.desc" class="mini-card-desc">{{ item.desc }}</p>
              </div>
            </div>
          </template>
        </div>
      </article>
    </section>


    <n-modal
      v-model:show="settingsOpen"
      preset="card"
      title="系统应用"
      :mask-closable="true"
      :close-on-esc="true"
      :style="{ width: 'min(980px, 96vw)' }"
    >
      <div class="settings-shell">
        <aside class="settings-sidebar">
          <nav class="settings-nav">
            <button
              v-for="tab in SETTINGS_TABS"
              :key="tab.id"
              class="settings-nav-btn"
              type="button"
              :data-active="settingsTab === tab.id"
              @click="settingsTab = tab.id"
            >
              <span class="nav-title">{{ tab.label }}</span>
              <span class="nav-desc">{{ tab.desc }}</span>
            </button>
          </nav>
        </aside>

        <section class="settings-content">
          <div v-if="settingsTab === 'personal'" class="settings-panel">
            <div class="settings-card">
              <h3>页面信息</h3>
              <div class="settings-grid">
                <label class="field">
                  <span>标题</span>
                  <input v-model="settings.title" class="input" placeholder="导航页标题" />
                </label>
                <label class="field">
                  <span>副标题</span>
                  <input v-model="settings.subtitle" class="input" placeholder="副标题" />
                </label>
                <label class="field span-2">
                  <span>公告</span>
                  <textarea v-model="settings.announcement" class="input textarea" rows="2" />
                </label>
                <label class="field span-2">
                  <span>页脚备注</span>
                  <input v-model="settings.footerNote" class="input" placeholder="页脚备注" />
                </label>
              </div>
            </div>

            <div class="settings-card">
              <h3>展示配置</h3>
              <div class="settings-grid">
                <label class="field">
                  <span>默认视图</span>
                  <select
                    v-model="settings.defaultView"
                    class="input select"
                    @change="viewMode = settings.defaultView"
                  >
                    <option value="external">外网</option>
                    <option value="internal">内网</option>
                  </select>
                </label>
                <label class="field">
                  <span>卡片样式</span>
                  <select v-model="settings.cardStyle" class="input select">
                    <option value="follow">跟随组件</option>
                    <option value="detail">详细模式</option>
                    <option value="image">图片模式</option>
                  </select>
                </label>
                <label class="field">
                  <span>主题风格</span>
                  <select v-model="settings.theme" class="input select">
                    <option value="aqua">薄荷青</option>
                    <option value="slate">冰川蓝</option>
                    <option value="sand">暖沙色</option>
                  </select>
                </label>
                <label class="field span-2">
                  <span>背景图片 URL</span>
                  <input v-model="settings.backgroundImage" class="input" placeholder="https://..." />
                </label>
              </div>
            </div>
          </div>

          <div v-else-if="settingsTab === 'groups'" class="settings-panel">
            <div class="settings-card">
              <div class="settings-card-header">
                <div>
                  <h3>分组管理</h3>
                  <p class="settings-muted">拖拽分组调整顺序，点击标题可编辑。</p>
                </div>
                <button class="btn small" type="button" @click="addGroup">新增分组</button>
              </div>
              <div class="settings-group-list">
                <div
                  v-for="(group, index) in groups"
                  :key="group.id"
                  class="settings-group-row"
                  :class="{ 'drag-over': isSettingsGroupDragOver(index) }"
                  draggable="true"
                  @dragstart="handleGroupDragStart(index, $event)"
                  @dragover="handleSettingsGroupDragOver(index, $event)"
                  @dragleave="handleSettingsGroupDragLeave"
                  @drop="handleSettingsGroupDrop(index)"
                  @dragend="clearDragState"
                >
                  <div class="settings-group-title">
                    <input v-model="group.title" class="input settings-group-input" placeholder="分组名称" />
                    <span class="settings-group-count">{{ group.items.length }} 张卡片</span>
                  </div>
                  <div class="settings-group-actions">
                    <span class="settings-drag-hint">拖拽排序</span>
                    <button
                      class="settings-danger-btn"
                      type="button"
                      @click="confirmRemoveGroup(index)"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div
                  v-if="groups.length"
                  class="settings-drop-zone"
                  :class="{ 'drag-over': isSettingsGroupDragOver(-1) }"
                  @dragover="handleSettingsGroupDragOver(-1, $event)"
                  @dragleave="handleSettingsGroupDragLeave"
                  @drop="handleSettingsGroupDropToEnd"
                  @dragend="clearDragState"
                >
                  拖到这里放到最后
                </div>
                <p v-else class="settings-muted">暂无分组。</p>
              </div>
            </div>
          </div>

          <div v-else-if="settingsTab === 'assets'" class="settings-panel">
            <div class="settings-card">
              <h3>图标与背景</h3>
              <p class="settings-muted">卡片图标可自动抓取或手动填入 URL，保存时会同步到 R2。</p>
            </div>
          </div>

          <div v-else-if="settingsTab === 'integrations'" class="settings-panel">
            <div class="settings-card">
              <h3>Open API</h3>
              <p class="settings-muted">API 默认使用 `ADMIN_TOKEN` 鉴权，可在部署后对外提供更新接口。</p>
            </div>
          </div>

          <div v-else class="settings-panel">
            <div class="settings-card">
              <h3>认证设置</h3>
              <div class="settings-grid">
                <div class="field span-2">
                  <span>说明</span>
                  <p class="settings-muted">
                    认证口令由 Cloudflare 变量 `ADMIN_TOKEN` 配置，前端仅负责输入与保存。
                  </p>
                </div>
              </div>
            </div>

            <div class="settings-card">
              <h3>账户</h3>
              <p class="settings-muted">当前已登录，可退出认证口令。</p>
              <div class="settings-actions">
                <n-button tertiary @click="logout">退出登录</n-button>
              </div>
            </div>
          </div>

          <div class="settings-footer">
            <div class="settings-footer-actions">
              <template v-if="isAdmin">
                <input
                  ref="importInputRef"
                  type="file"
                  accept="application/json"
                  class="sr-only"
                  @change="handleImportChange"
                />
                <n-button tertiary @click="exportNavData">导出</n-button>
                <n-button tertiary @click="triggerImport">导入</n-button>
                <n-button tertiary @click="resetSettings">恢复默认设置</n-button>
                <n-button type="primary" @click="saveNav">保存设置</n-button>
              </template>
              <p v-else class="settings-muted">仅管理员可保存设置。</p>
            </div>
          </div>
        </section>
      </div>
    </n-modal>

    <n-modal
      v-model:show="cardSettingsOpen"
      preset="card"
      :title="cardSettingsCreate ? '新增卡片' : '修改卡片'"
      :mask-closable="true"
      :close-on-esc="true"
      :style="{ width: 'min(780px, 96vw)' }"
      @after-leave="closeCardSettings"
    >
      <div v-if="cardSettingsItem" class="card-settings">
        <div class="card-settings-preview">
          <div class="preview-stage">
            <div :class="cardClass(cardSettingsItem)" :style="cardStyle(cardSettingsItem)">
              <div class="mini-card-media">
                <img
                  v-if="resolvedImageUrl(cardSettingsItem)"
                  :src="resolvedImageUrl(cardSettingsItem)"
                  :alt="cardSettingsItem.name"
                />
                <span v-else class="mini-card-fallback">
                  {{ cardInitial(cardSettingsItem.name) }}
                </span>
              </div>
              <div v-if="effectiveCardMode(cardSettingsItem) === 'detail'" class="mini-card-content">
                <h3>{{ cardSettingsItem.name || "标题" }}</h3>
                <p v-if="cardSettingsItem.desc" class="mini-card-desc">
                  {{ cardSettingsItem.desc }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="card-settings-form">
          <div class="settings-grid">
            <label class="field">
              <span>标题</span>
              <input v-model="cardSettingsItem.name" class="input" placeholder="名称" />
            </label>
            <label class="field">
              <span>所属分组</span>
              <select v-model.number="cardSettingsTargetGroupIndex" class="input select">
                <option v-for="(group, index) in groups" :key="group.id" :value="index">
                  {{ group.title || "未命名分组" }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>描述</span>
              <input v-model="cardSettingsItem.desc" class="input" placeholder="备注信息" />
            </label>
            <label class="field span-2">
              <span>外网地址</span>
              <div class="field-row">
                <input
                  v-model="cardSettingsItem.externalUrl"
                  class="input"
                  placeholder="https://..."
                />
                <button
                  class="btn ghost small"
                  type="button"
                  :disabled="!cardSettingsItem.externalUrl.trim()"
                  @click="openIconPicker(cardSettingsItem.externalUrl)"
                >
                  获取图标
                </button>
              </div>
            </label>
            <label class="field span-2">
              <span>内网地址</span>
              <div class="field-row">
                <input
                  v-model="cardSettingsItem.internalUrl"
                  class="input"
                  placeholder="http://..."
                />
                <button
                  class="btn ghost small"
                  type="button"
                  :disabled="!cardSettingsItem.internalUrl.trim()"
                  @click="openIconPicker(cardSettingsItem.internalUrl)"
                >
                  获取图标
                </button>
              </div>
            </label>
            <label class="field">
              <span>卡片样式</span>
              <select v-model="cardSettingsItem.displayMode" class="input select">
                <option value="detail">详情模式</option>
                <option value="image">图片模式</option>
              </select>
            </label>
            <label class="field">
              <span>图标方式</span>
              <select v-model="cardSettingsItem.iconMode" class="input select">
                <option value="auto">自动图标</option>
                <option value="manual">手动 URL</option>
              </select>
            </label>
            <label v-if="cardSettingsItem.iconMode === 'manual'" class="field span-2">
              <span>图片 URL</span>
              <input v-model="cardSettingsItem.imageUrl" class="input" placeholder="https://..." />
            </label>
            <div v-else class="field span-2 hint">
              自动根据链接域名获取图标，可在保存时同步到 R2。
            </div>
            <div class="field span-2">
              <span>图片预览</span>
              <div class="icon-preview">
                <img
                  v-if="resolvedImageUrl(cardSettingsItem)"
                  :src="resolvedImageUrl(cardSettingsItem)"
                  :alt="cardSettingsItem.name"
                />
                <div v-else class="icon-preview-empty">暂无图标</div>
              </div>
            </div>
            <label class="field span-2">
              <span>卡片背景</span>
              <div class="color-row">
                <input
                  v-model="cardSettingsItem.bgColor"
                  class="input color-text"
                  placeholder="#ffffff / transparent"
                />
                <input
                  class="color-picker"
                  type="color"
                  :value="safeColorValue(cardSettingsItem.bgColor)"
                  :disabled="cardSettingsItem.bgColor.trim().toLowerCase() === 'transparent'"
                  @input="cardSettingsItem.bgColor = ($event.target as HTMLInputElement).value"
                />
              </div>
              <div class="color-presets">
                <button
                  v-for="color in COLOR_PRESETS"
                  :key="color"
                  class="color-chip"
                  type="button"
                  :data-transparent="color === 'transparent'"
                  :style="color === 'transparent' ? {} : { background: color }"
                  @click="setPresetColor(cardSettingsItem, color)"
                >
                </button>
              </div>
            </label>
          </div>
        </div>

        <div class="card-settings-actions">
          <n-button tertiary @click="closeCardSettings">取消</n-button>
          <n-button
            v-if="!cardSettingsCreate"
            tertiary
            type="error"
            @click="removeCardFromSettings"
          >
            删除
          </n-button>
          <n-button type="primary" @click="saveCardFromSettings">保存</n-button>
        </div>
      </div>
    </n-modal>

    <n-modal
      v-model:show="iconPickerOpen"
      preset="card"
      title="请选择一个图标"
      :mask-closable="true"
      :close-on-esc="true"
      :style="{ width: 'min(420px, 92vw)' }"
    >
      <div v-if="iconPickerLoading" class="icon-picker-empty">正在检测可用图标...</div>
      <div v-else-if="iconCandidates.length === 0" class="icon-picker-empty">
        未找到可用图标，请手动填写图片 URL。
      </div>
      <div v-else class="icon-picker-grid">
        <button
          v-for="icon in iconCandidates"
          :key="icon"
          class="icon-option"
          type="button"
          @click="chooseIcon(icon)"
        >
          <img :src="icon" alt="icon" />
        </button>
      </div>
    </n-modal>

    <teleport to="body">
      <div
        v-if="contextMenuOpen && contextMenuItem"
        class="context-menu"
        :style="{ left: `${contextMenuX}px`, top: `${contextMenuY}px` }"
      >
        <template v-if="isAdmin">
          <button
            class="context-item"
            type="button"
            @click="openCardSettings(contextMenuGroupId, contextMenuItemId); closeContextMenu()"
          >
            编辑
          </button>
          <button
            class="context-item danger"
            type="button"
            @click="removeItemById(contextMenuGroupId, contextMenuItemId); closeContextMenu()"
          >
            删除
          </button>
          <div class="context-sep"></div>
        </template>
        <div class="context-item-row">
          <button
            class="context-item main"
            type="button"
            :disabled="!contextMenuItem.externalUrl.trim()"
            @click="openLink(contextMenuItem.externalUrl); closeContextMenu()"
          >
            打开外网
          </button>
          <button
            class="context-copy"
            type="button"
            :disabled="!contextMenuItem.externalUrl.trim()"
            @click="copyLink(contextMenuItem.externalUrl)"
          >
            复制
          </button>
        </div>
        <div class="context-item-row">
          <button
            class="context-item main"
            type="button"
            :disabled="!contextMenuItem.internalUrl.trim()"
            @click="openLink(contextMenuItem.internalUrl); closeContextMenu()"
          >
            打开内网
          </button>
          <button
            class="context-copy"
            type="button"
            :disabled="!contextMenuItem.internalUrl.trim()"
            @click="copyLink(contextMenuItem.internalUrl)"
          >
            复制
          </button>
        </div>
      </div>
    </teleport>

    <footer v-if="settings.footerNote" class="footer-note">
      {{ settings.footerNote }}
    </footer>
  </main>
</template>

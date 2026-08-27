import { Link, useNavigate } from "@tanstack/react-router";
import {
  Home,
  PlusCircle,
  ListVideo,
  MonitorSpeaker,
  Settings as SettingsIcon,
  Activity,
  Server,
  Library,
  Download,
  Tv,
  Radio,
  Plug,

} from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useDevices, useLibrary, usePlaylist } from "@/lib/ums-store";
import { useMenuNavigation, useSyncMedia, type MediaEntry } from "@/lib/ums-bridge";
import { applyPerfClass } from "@/lib/perf";
import { FloatingPlayer } from "@/components/FloatingPlayer";
import { InAppPlayer } from "@/components/InAppPlayer";
import { ScreenSharePanel } from "@/components/ScreenSharePanel";
import { LinkCatcher } from "@/components/LinkCatcher";
import { SystemPressureDialog } from "@/components/SystemPressureDialog";

const nav = [
  { to: "/", label: "خانه", icon: Home },
  { to: "/add", label: "افزودن لینک", icon: PlusCircle },
  { to: "/library", label: "مخزن فیلم‌ها", icon: Library },
  { to: "/download", label: "دانلود از وب", icon: Download },
  { to: "/channels", label: "کانال‌های استریم", icon: Tv },
  { to: "/streams", label: "مخزن استریم‌ها", icon: Radio },
  { to: "/playlist", label: "لیست پخش", icon: ListVideo },
  { to: "/devices", label: "دستگاه‌های شبکه", icon: MonitorSpeaker },
  { to: "/settings", label: "تنظیمات", icon: SettingsIcon },
  { to: "/status", label: "وضعیت سرور", icon: Activity },
  { to: "/plugins", label: "افزونه‌ها و وابستگی‌ها", icon: Plug },

] as const;

export function AppLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [playlist, , playlistReady] = usePlaylist();
  const [library, , libraryReady] = useLibrary();
  const [devices] = useDevices();
  const active = devices.find((d) => d.status !== "offline") ?? devices[0];

  // Keep the desktop media registry in sync so http://ip:port/media/:id serves
  // the real bytes (local file with Range support, or proxied remote URL).
  const entries = useMemo<MediaEntry[]>(
    () => [
      ...library.map((f) => ({
        id: f.id,
        title: f.title,
        source: f.source,
        ...(f.subtitle ? { subtitle: f.subtitle } : {}),
      })),
      ...playlist.map((i) => ({
        id: i.id,
        title: i.title,
        source: i.url,
        ...(i.subtitle ? { subtitle: i.subtitle } : {}),
      })),
    ],
    [library, playlist],
  );

  // Weak devices get the lightweight profile (no blur/shadow/animation).
  useEffect(() => {
    applyPerfClass();
  }, []);

  useSyncMedia(entries, playlistReady && libraryReady);
  useMenuNavigation(useCallback((to: string) => void navigate({ to }), [navigate]));

  return (
    <div dir="rtl" className="min-h-screen bg-background text-foreground font-sans p-[1cm]">
      <div className="w-full">
        <div className="min-h-[calc(100vh-2cm)] rounded-3xl border-2 border-primary/60 panel-glow p-4 shadow-[var(--glow-gold)] sm:p-6">
          <div className="flex gap-6 max-lg:flex-col">
            <aside className="w-60 shrink-0 max-lg:w-full">
              <img
                src="/app-logo.png"
                alt="لوگوی Universal Media Server"
                className="mb-5 w-full max-w-52 max-lg:mx-auto"
              />
              <div className="mb-5 flex items-center gap-3 rounded-2xl border border-primary/40 bg-card/70 p-4 shadow-[var(--glow-gold)]">
                <div className="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Server className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-primary text-glow">مدیا سرور</p>
                  <p className="text-xs text-muted-foreground">
                    {active ? `${active.name} · ${active.ip}` : "دستگاهی شناسایی نشده"}
                  </p>
                </div>
              </div>
              <nav className="grid gap-1 rounded-2xl border border-primary/30 bg-card/60 p-2 max-lg:grid-cols-2">
                {nav.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    activeOptions={{ exact: to === "/" }}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:border data-[status=active]:border-primary/50 data-[status=active]:bg-primary/10 data-[status=active]:font-semibold data-[status=active]:text-primary data-[status=active]:shadow-[var(--glow-gold)]"
                  >
                    <Icon className="size-4" />
                    {label}
                  </Link>
                ))}
              </nav>
            </aside>

            <main className="min-w-0 flex-1">
              <header className="mb-6 text-right">
                <h1 className="text-3xl font-bold tracking-tight text-primary text-glow">
                  {title}
                </h1>
                {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
              </header>
              {children}
            </main>
          </div>
        </div>
      </div>
      <FloatingPlayer />
      <ScreenSharePanel />
      <SystemPressureDialog />
      <InAppPlayer />
      <LinkCatcher />
    </div>
  );
}

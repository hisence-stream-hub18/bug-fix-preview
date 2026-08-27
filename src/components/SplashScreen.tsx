import { useEffect, useState } from "react";

const SPLASH_MS = 5000;
const FADE_MS = 700;

/**
 * Startup splash: shows the app logo full-screen for 5 seconds
 * (desktop app + mobile app + web), then fades into the app.
 */
export function SplashScreen() {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), SPLASH_MS - FADE_MS);
    const done = setTimeout(() => setVisible(false), SPLASH_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[999] grid place-items-center overflow-hidden bg-background transition-opacity duration-700"
      style={{ opacity: leaving ? 0 : 1 }}
    >
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40 splash-bg"
        style={{ backgroundImage: "url(/splash-bg.jpg)" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/30 to-background" />
      <div className="relative flex flex-col items-center gap-6 px-6 text-center">
        <img
          src="/app-logo.png"
          alt="Universal Media Server"
          className="splash-logo w-[min(60vw,420px)] drop-shadow-[0_0_60px_rgba(255,190,60,0.45)]"
        />
        <p className="splash-title text-2xl font-bold tracking-wide text-primary text-glow sm:text-3xl">
          UNIVERSAL MEDIA SERVER
        </p>
        <div className="splash-bar h-1.5 w-56 overflow-hidden rounded-full bg-primary/20">
          <div className="splash-bar-fill h-full rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

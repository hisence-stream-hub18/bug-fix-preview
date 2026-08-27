// "Play in VLC" — shown next to every saved / direct link so the user can hand
// the stream to the VLC installed on Windows or Android.

import { PlayCircle } from "lucide-react";
import { openInVlc } from "@/lib/open-in-vlc";

export function VlcButton({ url, title }: { url: string; title?: string }) {
  return (
    <button
      onClick={() => void openInVlc(url, title)}
      title="پخش در VLC"
      aria-label="پخش در VLC"
      className="shrink-0 rounded-lg border border-primary/40 p-1.5 text-primary transition-colors hover:bg-accent"
    >
      <PlayCircle className="size-4" />
    </button>
  );
}

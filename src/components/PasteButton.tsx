// Small "paste from clipboard" button used next to every stream/download URL
// input, so a copied link can be dropped in with one tap on desktop and mobile.
import { ClipboardPaste } from "lucide-react";
import { toast } from "sonner";

export function PasteButton({
  onPaste,
  label = "چسباندن لینک",
  className = "",
}: {
  onPaste: (text: string) => void;
  label?: string;
  className?: string;
}) {
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        toast.error("حافظه موقت خالی است.");
        return;
      }
      onPaste(text);
      toast.success("لینک از حافظه موقت چسبانده شد.");
    } catch {
      toast.error("دسترسی به حافظه موقت داده نشد؛ لینک را دستی وارد کنید.");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void paste()}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-xs transition-colors hover:bg-accent ${className}`}
      title="چسباندن از حافظه موقت"
    >
      <ClipboardPaste className="size-3.5" />
      {label}
    </button>
  );
}

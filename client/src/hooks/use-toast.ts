/**
 * use-toast — thin wrapper around sonner's toast for consistent API
 */
import { toast as sonnerToast } from "sonner";

interface ToastOptions {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
  duration?: number;
}

export function useToast() {
  const toast = (opts: ToastOptions) => {
    const message = opts.title ?? "";
    const description = opts.description;
    if (opts.variant === "destructive") {
      sonnerToast.error(message, { description });
    } else {
      sonnerToast.success(message, { description });
    }
  };
  return { toast };
}

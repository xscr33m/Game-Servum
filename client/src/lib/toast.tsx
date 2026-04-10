import React from "react";
import { toast, type ExternalToast } from "sonner";
import { FaCopy, FaCheck } from "react-icons/fa6";

/**
 * Central Toast Notification System
 *
 * Provides consistent toast notifications across the entire application with:
 * - Error toasts: Persistent (duration: Infinity) with copy-to-clipboard functionality
 * - Success toasts: Auto-dismiss after ~4 seconds (default)
 * - Info toasts: Auto-dismiss after default duration
 * - Warning toasts: Auto-dismiss after default duration
 * - Special dependency error toasts: Copyable download links for remote agent setup
 */

/**
 * Show a success toast notification.
 * Auto-dismisses after ~4 seconds (Sonner's default).
 *
 * @param message - Success message to display
 * @param options - Optional Sonner toast options (e.g., description)
 * @returns Toast ID for programmatic control
 */
export function toastSuccess(
  message: string,
  options?: ExternalToast,
): string | number {
  return toast.success(message, options);
}

/**
 * Show an error toast notification with copy functionality.
 * Persistent (duration: Infinity) - must be manually dismissed.
 * Includes a "Copy" action button to copy the error message to clipboard.
 *
 * @param error - Error message (string) or Error object
 * @param options - Optional Sonner toast options (overrides defaults)
 * @returns Toast ID for programmatic control
 */
export function toastError(
  error: string | Error,
  options?: ExternalToast,
): string | number {
  const message = typeof error === "string" ? error : error.message;
  let isCopied = false;

  const copyToClipboard = async (toastId: string | number) => {
    try {
      await navigator.clipboard.writeText(message);
      isCopied = true;
      // Update toast to show copy confirmation
      toast.error(message, {
        id: toastId,
        duration: Infinity,
        dismissible: true,
        closeButton: true,
        action: {
          label: (
            <span className="flex items-center gap-1.5">
              <FaCheck className="h-3 w-3" />
              Copied
            </span>
          ),
          onClick: () => {}, // No-op, already copied
        },
        ...options,
      });
      // Reset to "Copy" after 2 seconds
      setTimeout(() => {
        if (isCopied) {
          toast.error(message, {
            id: toastId,
            duration: Infinity,
            dismissible: true,
            closeButton: true,
            action: {
              label: (
                <span className="flex items-center gap-1.5">
                  <FaCopy className="h-3 w-3" />
                  Copy
                </span>
              ),
              onClick: () => copyToClipboard(toastId),
            },
            ...options,
          });
        }
      }, 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  const toastId = toast.error(message, {
    duration: Infinity,
    dismissible: true,
    closeButton: true,
    action: {
      label: (
        <span className="flex items-center gap-1.5">
          <FaCopy className="h-3 w-3" />
          Copy
        </span>
      ),
      onClick: () => copyToClipboard(toastId),
    },
    ...options,
  });

  return toastId;
}

/**
 * Show an info toast notification.
 * Auto-dismisses after default duration (~4 seconds).
 *
 * @param message - Info message to display
 * @param options - Optional Sonner toast options
 * @returns Toast ID for programmatic control
 */
export function toastInfo(
  message: string,
  options?: ExternalToast,
): string | number {
  return toast.info(message, options);
}

/**
 * Show error toast with copyable download links for dependency errors.
 * For errors containing URLs, creates a persistent toast with copyable links.
 * Each link has its own copy button - the entire message is NOT copied.
 *
 * Use this for server startup errors that require downloading dependencies
 * (DirectX, VC++ Runtime) on the remote Agent machine.
 *
 * @param message - Error message containing URLs (e.g., DirectX download link)
 */
export function showDependencyError(message: string): void {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const hasLinks = urlRegex.test(message);

  if (!hasLinks) {
    // Regular error without links - use standard error toast
    toastError(message);
    return;
  }

  // Extract URLs for copyable links
  const urls: Array<{ url: string; label: string }> = [];
  let match;
  const regex = new RegExp(urlRegex);
  while ((match = regex.exec(message)) !== null) {
    const url = match[0];
    let label = "DirectX";
    if (url.includes("vc_redist") || url.includes("vcredist")) {
      label = "VC++ Runtime";
    }
    urls.push({ url, label });
  }

  // Remove URLs from message text for cleaner display
  const cleanMessage = message.replace(urlRegex, "").trim();

  // Component for copyable link with feedback
  const CopyableLink = ({ url, label }: { url: string; label: string }) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    };

    return (
      <div className="flex items-center gap-2 p-2 rounded bg-muted/50 border border-border">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground mb-0.5">{label}</p>
          <p className="text-[10px] text-muted-foreground font-mono break-all leading-tight">
            {url}
          </p>
        </div>
        <button
          onClick={handleCopy}
          className="shrink-0 px-2.5 py-1.5 rounded bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          {copied ? (
            <>
              <FaCheck className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <FaCopy className="h-3 w-3" />
              Copy
            </>
          )}
        </button>
      </div>
    );
  };

  toast.error(
    <div className="space-y-3 max-w-2xl">
      <p className="text-sm leading-relaxed">{cleanMessage}</p>
      {urls.length > 0 && (
        <div className="space-y-2">
          {urls.map((link, idx) => (
            <CopyableLink key={idx} url={link.url} label={link.label} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-2">
        Copy links and paste in browser on Agent machine to download
      </p>
    </div>,
    {
      duration: Infinity,
      dismissible: true,
      closeButton: true,
      className: "max-w-2xl",
      style: { maxWidth: "600px" },
    },
  );
}

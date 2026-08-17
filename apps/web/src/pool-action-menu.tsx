import type { MarketPoolRow } from "@lpbot/api-contract";
import {
  Activity,
  Ban,
  BellPlus,
  ChartNoAxesCombined,
  ClipboardCopy,
  ListPlus,
  MessageSquareText,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import {
  poolActionCommandRegistry,
  resolvePoolAction,
  type PoolActionCommandId,
  type PoolActionCommandSection,
  type PoolActionResult,
} from "./pool-actions.js";

export interface PoolActionMenuState {
  row: MarketPoolRow;
  trigger: HTMLElement;
  x: number;
  y: number;
}

const icons: Record<PoolActionCommandSection, LucideIcon> = {
  block: Ban,
  discover: Search,
  inspect: ClipboardCopy,
  prefill: ListPlus,
};

function commandIcon(id: PoolActionCommandId, section: PoolActionCommandSection): LucideIcon {
  if (id === "expand-market") return ChartNoAxesCombined;
  if (id.startsWith("view-")) return Activity;
  if (id === "create-monitor") return BellPlus;
  if (id === "share-chat") return MessageSquareText;
  return icons[section];
}

export function PoolActionMenu({
  close,
  execute,
  menu,
}: {
  close(restoreFocus: boolean): void;
  execute(result: PoolActionResult, row: MarketPoolRow): void;
  menu: PoolActionMenuState;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const items = useMemo(
    () =>
      poolActionCommandRegistry.map((definition) => ({
        definition,
        resolved: resolvePoolAction(menu.row, definition.id, {
          clipboard: typeof navigator.clipboard?.writeText === "function",
        }),
      })),
    [menu.row],
  );

  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>(
      '[role="menuitem"]:not([aria-disabled="true"])',
    );
    first?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) close(false);
    };
    const dismiss = () => close(false);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [close]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const enabled = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .filter((button) => button.getAttribute("aria-disabled") !== "true");
    if (enabled.length === 0) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? enabled.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + enabled.length) % enabled.length
            : (current - 1 + enabled.length) % enabled.length;
    enabled[next]?.focus();
  };

  const width = 286;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 480));
  let previousSection: PoolActionCommandSection | null = null;

  return createPortal(
    <div
      aria-label={`池操作 ${menu.row.poolKey}`}
      className="pool-action-menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
      ref={menuRef}
      role="menu"
      style={{ left, top }}
    >
      {items.map(({ definition, resolved }) => {
        const separated = previousSection !== null && previousSection !== definition.section;
        previousSection = definition.section;
        const Icon = commandIcon(definition.id, definition.section);
        const reason = resolved.enabled ? null : resolved.reason;
        return (
          <div className={separated ? "pool-action-menu-section" : undefined} key={definition.id}>
            <button
              aria-disabled={reason ? "true" : undefined}
              data-command={definition.id}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!resolved.enabled) return;
                close(false);
                execute(resolved.result, menu.row);
              }}
              role="menuitem"
              tabIndex={-1}
              title={reason ?? definition.label}
              type="button"
            >
              <Icon aria-hidden="true" size={16} />
              <span className="pool-action-menu-copy">
                <span>{definition.label}</span>
                {reason ? <small>{reason}</small> : null}
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

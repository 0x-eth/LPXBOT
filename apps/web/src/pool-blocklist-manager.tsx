import type { PoolBlocklistEntry } from "@lpbot/api-contract";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, RotateCcw, ShieldOff, X } from "lucide-react";
import { useMemo } from "react";

import { useFeedback } from "./feedback.js";
import { usePoolBlocklist } from "./pool-blocklist.js";

function EntryGroup({
  entries,
  label,
  restore,
}: {
  entries: PoolBlocklistEntry[];
  label: string;
  restore(entry: PoolBlocklistEntry): void;
}) {
  if (entries.length === 0) return null;
  return (
    <section aria-label={`${label}屏蔽项`} className="pool-blocklist-group">
      <h3>
        <span>{label}</span>
        <span>{entries.length}</span>
      </h3>
      <ul>
        {entries.map((entry) => (
          <li key={`${entry.scope}:${entry.identity}`}>
            <div>
              {entry.label ? <strong>{entry.label}</strong> : null}
              <code title={entry.identity}>{entry.identity}</code>
            </div>
            <button
              aria-label={`恢复${label} ${entry.identity}`}
              className="pool-blocklist-restore"
              onClick={() => restore(entry)}
              title="恢复"
              type="button"
            >
              <RotateCcw aria-hidden="true" size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PoolBlocklistManager() {
  const blocklist = usePoolBlocklist();
  const feedback = useFeedback();
  const groups = useMemo(
    () => ({
      pools: blocklist.entries.filter(({ scope }) => scope === "pool"),
      tokens: blocklist.entries.filter(({ scope }) => scope === "token"),
    }),
    [blocklist.entries],
  );

  const restore = (entry: PoolBlocklistEntry) => {
    void blocklist
      .restore({ chainId: entry.chainId, identity: entry.identity, scope: entry.scope })
      .then((saved) => {
        feedback.show({
          dedupeKey: saved ? `pool-restored:${entry.identity}` : "pool-restore-failed",
          kind: saved ? "success" : "error",
          title: saved ? "已恢复候选资格" : "恢复失败，已还原屏蔽项",
        });
      });
  };

  const empty = blocklist.loaded && blocklist.entries.length === 0;
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="pool-blocklist-trigger" type="button">
          <ShieldOff aria-hidden="true" size={15} />
          <span>屏蔽管理</span>
          {blocklist.entries.length > 0 ? (
            <span aria-label={`${blocklist.entries.length} 个屏蔽项`} className="pool-blocklist-count">
              {blocklist.entries.length}
            </span>
          ) : null}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content className="pool-blocklist-dialog">
          <div className="dialog-heading">
            <div>
              <Dialog.Title>屏蔽管理</Dialog.Title>
              <Dialog.Description>Token 与池</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button aria-label="关闭屏蔽管理" className="icon-button" title="关闭" type="button">
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </div>

          {blocklist.status === "loading" && !blocklist.loaded ? (
            <div aria-live="polite" className="pool-blocklist-state" role="status">
              <span aria-hidden="true" className="spinner spinner-small" />
              <span>正在加载屏蔽列表</span>
            </div>
          ) : null}
          {blocklist.status === "error" || blocklist.status === "conflict" ? (
            <div className="pool-blocklist-state pool-blocklist-state-error" role="alert">
              <AlertTriangle aria-hidden="true" size={17} />
              <span>
                {blocklist.status === "conflict" ? "列表已在其他设备更新" : "屏蔽列表更新失败"}
              </span>
              <button onClick={blocklist.retryLoad} type="button">
                重新加载
              </button>
            </div>
          ) : null}
          {empty ? (
            <div className="pool-blocklist-state" role="status">
              暂无屏蔽项
            </div>
          ) : null}
          <div aria-busy={blocklist.status === "saving" ? "true" : undefined}>
            <EntryGroup entries={groups.tokens} label="Token" restore={restore} />
            <EntryGroup entries={groups.pools} label="池" restore={restore} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

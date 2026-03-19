import type { MouseEvent, RefObject } from "react";
import { getTabLabel } from "../app/utils";
import type { TabContextMenuState, WorkspaceTab } from "../app/types";

type TabBarProps = {
  tabs: WorkspaceTab[];
  activeTabId: number;
  draggedTabId: number | null;
  renamingTabId: number | null;
  renameDraft: string;
  renameInputRef: RefObject<HTMLInputElement | null>;
  tabContextMenu: TabContextMenuState | null;
  tabContextMenuRef: RefObject<HTMLDivElement | null>;
  onSelectTab: (tabId: number) => void;
  onCreateTab: () => void;
  onDragStart: (tabId: number) => void;
  onDragEnd: () => void;
  onDropOnTab: (tabId: number) => void;
  onTabContextMenu: (event: MouseEvent<HTMLButtonElement>, tabId: number) => void;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onStartRenaming: (tabId: number) => void;
  onTogglePinned: (tabId: number) => void;
  onCloseTab: (tabId: number) => void;
  onCloseContextMenu: () => void;
  onOpenRepository: () => void;
};

export function TabBar({
  tabs,
  activeTabId,
  draggedTabId,
  renamingTabId,
  renameDraft,
  renameInputRef,
  tabContextMenu,
  tabContextMenuRef,
  onSelectTab,
  onCreateTab,
  onDragStart,
  onDragEnd,
  onDropOnTab,
  onTabContextMenu,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onStartRenaming,
  onTogglePinned,
  onCloseTab,
  onCloseContextMenu,
  onOpenRepository,
}: TabBarProps) {
  const contextTab = tabContextMenu ? tabs.find((tab) => tab.id === tabContextMenu.tabId) : null;

  return (
    <header className="z-50 flex h-12 shrink-0 items-center justify-between border-b border-outline-variant/10 bg-[#060e20] px-4 font-headline tracking-tight text-[#00D1FF]">
      <div className="flex h-full items-center gap-6">
        <nav className="flex h-full items-end gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              draggable={renamingTabId !== tab.id}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                onDragStart(tab.id);
              }}
              onDragEnd={onDragEnd}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDropOnTab(tab.id)}
              onContextMenu={(event) => onTabContextMenu(event, tab.id)}
              className={`flex h-8 items-center gap-2 rounded-t-md px-3 text-sm transition-colors duration-150 ${
                tab.id === activeTabId
                  ? "border-b-2 border-[#00D1FF] pb-1 text-[#00D1FF] hover:bg-[#192540]"
                  : "text-[#dee5ff]/60 hover:bg-[#192540]"
              } ${draggedTabId === tab.id ? "opacity-40" : ""}`}
              onClick={() => onSelectTab(tab.id)}
            >
              <span className="material-symbols-outlined text-sm">
                {tab.isPinned ? "keep" : "terminal"}
              </span>
              {renamingTabId === tab.id ? (
                <input
                  ref={renameInputRef}
                  value={renameDraft}
                  onChange={(event) => onRenameDraftChange(event.target.value)}
                  onBlur={onCommitRename}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onCommitRename();
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelRename();
                    }
                  }}
                  className="w-40 rounded bg-[#192540] px-2 py-0.5 text-sm text-[#dee5ff] outline-none ring-1 ring-[#00D1FF]/40"
                />
              ) : (
                <span className="max-w-40 truncate">{getTabLabel(tab)}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            className="flex h-8 items-center px-2 text-[#dee5ff]/40 hover:text-primary"
            onClick={onCreateTab}
            aria-label="New tab"
          >
            <span className="material-symbols-outlined text-lg">add</span>
          </button>
        </nav>

        {tabContextMenu ? (
          <div
            ref={tabContextMenuRef}
            className="fixed z-[100] min-w-40 rounded-md border border-[#1f325d] bg-[#091328] p-1 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-[#dee5ff] transition-colors hover:bg-[#192540]"
              onClick={() => onStartRenaming(tabContextMenu.tabId)}
            >
              <span className="material-symbols-outlined text-sm">edit</span>
              Renombrar tab
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-[#dee5ff] transition-colors hover:bg-[#192540]"
              onClick={() => {
                onTogglePinned(tabContextMenu.tabId);
                onCloseContextMenu();
              }}
            >
              <span className="material-symbols-outlined text-sm">
                {contextTab?.isPinned ? "keep_off" : "keep"}
              </span>
              {contextTab?.isPinned ? "Desfijar tab" : "Fijar tab"}
            </button>
            {!contextTab?.isPinned ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-[#ff9c9c] transition-colors hover:bg-[#192540]"
                onClick={() => onCloseTab(tabContextMenu.tabId)}
                disabled={tabs.length === 1}
              >
                <span className="material-symbols-outlined text-sm">close</span>
                Cerrar tab
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[#192540]"
          onClick={onOpenRepository}
        >
          <span className="material-symbols-outlined text-sm">folder_open</span>
        </button>
      </div>
    </header>
  );
}

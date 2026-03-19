import { NAV_ITEMS } from "../app/utils";
import type { RepositoryState } from "../app/types";

type WorkspaceSidebarProps = {
  repository: RepositoryState | null;
};

export function WorkspaceSidebar({ repository }: WorkspaceSidebarProps) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-[#091328] pt-4 transition-all duration-200">
      <div className="mb-6 px-6">
        <h3 className="mb-1 text-[10px] font-headline tracking-[0.2em] text-[#00D1FF]">
          WORKSPACE
        </h3>
        <p className="text-[11px] font-body text-[#a3aac4]/60">
          Active: {repository ? repository.name : "None"}
        </p>
      </div>
      <nav className="flex-1">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item, index) => {
            let icon = "account_tree";
            if (item.label === "Historial") icon = "history";
            if (item.label === "Working tree") icon = "inventory_2";
            if (item.label === "Remoto") icon = "cloud_queue";
            if (item.label === "Ramas") icon = "call_split";

            return (
              <li key={item.label}>
                <button
                  className={`flex w-full items-center justify-between px-6 py-3 text-sm font-medium transition-all ${
                    index === 0
                      ? "border-l-2 border-[#00D1FF] bg-[#192540] text-[#00D1FF]"
                      : "text-[#a3aac4] hover:bg-[#192540] hover:text-[#dee5ff]"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className="material-symbols-outlined">{icon}</span>
                    {item.label}
                  </div>
                  {item.count ? (
                    <span className="rounded bg-surface-container-highest px-1.5 text-[10px] font-label text-on-surface-variant">
                      {item.count}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

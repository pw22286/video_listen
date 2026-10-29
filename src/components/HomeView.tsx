import { Clock3, FileVideo, FolderOpen, Home, Plus, Scissors, Search } from "lucide-react";
import type { RecentProject } from "../electron";
import { formatDate } from "../lib/format";

export function HomeView({
  recentProjects,
  onCreateProject,
  onOpenProject,
  onOpenRecent,
}: {
  recentProjects: RecentProject[];
  onCreateProject: () => void;
  onOpenProject: () => void;
  onOpenRecent: (project: RecentProject) => void;
}) {
  return (
    <div className="home-shell">
      <aside className="home-sidebar">
        <div className="app-logo">
          <div className="logo-mark">语</div>
          <div>
            <strong>语映</strong>
            <span>口述影像工作台</span>
          </div>
        </div>
        <nav className="home-nav">
          <button className="active">
            <Home size={18} />
            首页
          </button>
          <button>
            <Clock3 size={18} />
            最近项目
          </button>
        </nav>
      </aside>

      <main className="home-main">
        <section className="hero-action" onClick={onCreateProject}>
          <Plus size={28} />
          <strong>新建项目</strong>
          <span>选择一个文件夹作为项目空间</span>
        </section>

        <div className="quick-actions">
          <button onClick={onCreateProject}>
            <Plus size={20} />
            新建项目
          </button>
          <button onClick={onOpenProject}>
            <FolderOpen size={20} />
            打开项目
          </button>
        </div>

        <section className="recent-section">
          <div className="section-title">
            <h2>最近项目</h2>
            <Search size={18} />
          </div>

          {recentProjects.length === 0 ? (
            <div className="empty-recent">
              <Scissors size={36} />
              <p>还没有项目。新建一个项目开始制作口述影像。</p>
            </div>
          ) : (
            <div className="recent-list">
              {recentProjects.map((item) => (
                <button
                  className="recent-item"
                  key={item.projectPath}
                  onClick={() => onOpenRecent(item)}
                >
                  <FileVideo size={20} />
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.videoName || "尚未导入视频"}</span>
                    <small>{item.projectPath}</small>
                  </div>
                  <time>{formatDate(item.lastOpenedAt)}</time>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

import { LogOut, Menu } from "lucide-react";
import { useLocation } from "react-router-dom";

const titles = {
  "/": "Dashboard",
  "/repositories": "Repositories",
  "/pull-requests": "Pull Requests",
  "/workflows": "CI/CD Workflows",
  "/diagnosis": "Failure Diagnosis",
  "/risk-analysis": "Risk Analysis",
  "/sequencing": "Recommended Order",
  "/history": "Analysis History",
};

export default function Topbar({ user, onMenuClick, onLogout }) {
  const location = useLocation();
  const title = titles[location.pathname] || "CI/CD Analysis";

  return (
    <header className="topbar">
      <div className="topbar-heading">
        <button
          className="icon-button menu-button"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Menu size={22} />
        </button>

        <div>
          <p className="topbar-eyebrow">DEVELOPMENT WORKSPACE</p>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="topbar-actions">
        <div className="user-info">
          <div className="avatar">
            {(user?.name || user?.email || "U")
              .charAt(0)
              .toUpperCase()}
          </div>

          <div className="user-details">
            <strong>{user?.name || "Developer"}</strong>
            <span>{user?.email || ""}</span>
          </div>
        </div>

        <button
          className="logout-button"
          onClick={onLogout}
          title="Sign out"
        >
          <LogOut size={17} />
          <span>Sign out</span>
        </button>
      </div>
    </header>
  );
}
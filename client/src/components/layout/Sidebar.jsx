import { NavLink } from "react-router-dom";
import {
  Activity,
  GitBranch,
  GitPullRequest,
  Gauge,
  History,
  LayoutDashboard,
  Route,
  ShieldAlert,
  X,
} from "lucide-react";

const navigation = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Repositories", path: "/repositories", icon: GitBranch },
  { label: "Pull Requests", path: "/pull-requests", icon: GitPullRequest },
  { label: "CI/CD Workflows", path: "/workflows", icon: Activity },
  { label: "Failure Diagnosis", path: "/diagnosis", icon: ShieldAlert },
  { label: "Risk Analysis", path: "/risk-analysis", icon: Gauge },
  { label: "Recommended Order", path: "/sequencing", icon: Route },
  { label: "Dependency Management", path: "/dependencies", icon: GitBranch },
  { label: "Analysis History", path: "/history", icon: History },
];

export default function Sidebar({ isOpen, onClose }) {
  return (
    <>
      <aside className={`sidebar ${isOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-symbol">
            <GitBranch size={22} />
          </div>

          <div>
            <h2>RiskAware<span>.</span></h2>
            <p>CI/CD Intelligence</p>
          </div>

          <button
            className="icon-button sidebar-close"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <p className="nav-heading">WORKSPACE</p>

        <nav className="sidebar-nav">
          {navigation.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>

            
          ))}
        </nav>

        <div className="sidebar-bottom">
          <span className="status-dot" />
          <div>
            <strong>Analysis workspace</strong>
            <p>Read-only GitHub integration</p>
          </div>
        </div>
      </aside>
    </>
  );
}
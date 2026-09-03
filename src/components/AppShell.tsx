import { NavLink, Outlet, useLocation, matchPath } from "react-router-dom";

const TABS = [
  { to: "/prd", label: "PRD", end: false },
  { to: "/wireframes", label: "와이어프레임", end: false },
  { to: "/db", label: "DB 조회", end: true },
  { to: "/assets", label: "JSON 자산", end: true },
] as const;

export function AppShell() {
  const { pathname } = useLocation();
  const screenSolo = Boolean(
    matchPath("/wireframes/:projectNo/:feature/screens/:screenId", pathname),
  );

  if (screenSolo) {
    return (
      <div className="wfs-app wfs-app-solo">
        <Outlet />
      </div>
    );
  }

  return (
    <div className="wfs-app">
      <header className="wfs-app-bar">
        <div className="wfs-app-brand">Wireframe</div>
        <nav className="wfs-app-tabs" aria-label="메인">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `wfs-app-tab${isActive ? " is-active" : ""}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <div className="wfs-app-note">비개발자 PRD→화면 · 개발자엔 확정·시간단축</div>
      </header>
      <div className="wfs-app-body">
        <Outlet />
      </div>
    </div>
  );
}

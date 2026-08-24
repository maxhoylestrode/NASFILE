interface Crumb {
  id: string;
  name: string;
}

export function Breadcrumb({ path, onNavigate }: { path: Crumb[]; onNavigate: (id: string) => void }) {
  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
      {path.map((crumb, i) => (
        <span key={crumb.id} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-300">/</span>}
          <button
            onClick={() => onNavigate(crumb.id)}
            className={`rounded px-1.5 py-0.5 hover:bg-slate-100 ${
              i === path.length - 1 ? 'font-medium text-slate-900' : ''
            }`}
          >
            {crumb.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

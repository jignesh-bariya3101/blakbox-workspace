import { Link } from "react-router-dom";

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link to="/" className="brand" style={light ? { color: "#f6f1e8" } : undefined}>
      <span className="mark">B</span>
      <span className="brand-name">BlakBox</span>
    </Link>
  );
}

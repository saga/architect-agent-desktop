import SessionExplorer from "./SessionExplorer";

export default function SessionExplorerWindow() {
  return <SessionExplorer standalone onClose={() => window.close()} />;
}

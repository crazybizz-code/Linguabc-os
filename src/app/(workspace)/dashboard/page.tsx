import { WorkspaceGate } from "../workspace-gate";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <WorkspaceGate allowed={["owner", "admin", "academic_manager", "mentor"]} area="Centre workspace" />;
}

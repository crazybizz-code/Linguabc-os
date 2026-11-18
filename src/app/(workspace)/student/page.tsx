import { WorkspaceGate } from "../workspace-gate";

export const metadata = { title: "My learning" };

export default function StudentPage() {
  return <WorkspaceGate allowed={["student"]} area="Student workspace" />;
}

import { WorkspaceGate } from "../workspace-gate";

export const metadata = { title: "Family" };

export default function ParentPage() {
  return <WorkspaceGate allowed={["parent"]} area="Parent workspace" />;
}

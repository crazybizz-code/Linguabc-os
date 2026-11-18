import { PortalLayout } from "../portal-layout";

export default function Layout({ children }: LayoutProps<"/student">) {
  return <PortalLayout kind="student">{children}</PortalLayout>;
}

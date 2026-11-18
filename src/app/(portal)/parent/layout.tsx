import { PortalLayout } from "../portal-layout";

export default function Layout({ children }: LayoutProps<"/parent">) {
  return <PortalLayout kind="parent">{children}</PortalLayout>;
}

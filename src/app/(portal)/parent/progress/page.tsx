import { PortalProgress } from "../../portal-pages";

export const metadata = { title: "Progress" };

export default function Page({ searchParams }: PageProps<"/parent/progress">) {
  return <PortalProgress kind="parent" searchParams={searchParams} />;
}

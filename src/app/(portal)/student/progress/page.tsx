import { PortalProgress } from "../../portal-pages";

export const metadata = { title: "Progress" };

export default function Page({ searchParams }: PageProps<"/student/progress">) {
  return <PortalProgress kind="student" searchParams={searchParams} />;
}

import { PortalSchedule } from "../../portal-pages";

export const metadata = { title: "Schedule" };

export default function Page({ searchParams }: PageProps<"/student/schedule">) {
  return <PortalSchedule searchParams={searchParams} />;
}

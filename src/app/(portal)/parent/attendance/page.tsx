import { PortalAttendance } from "../../portal-pages";

export const metadata = { title: "Attendance" };

export default function Page({ searchParams }: PageProps<"/parent/attendance">) {
  return <PortalAttendance kind="parent" searchParams={searchParams} />;
}

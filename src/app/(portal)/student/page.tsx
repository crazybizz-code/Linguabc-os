import { PortalHome } from "../portal-pages";

export const metadata = { title: "Home" };

export default function Page({ searchParams }: PageProps<"/student">) {
  return <PortalHome kind="student" searchParams={searchParams} />;
}

import { PortalHome } from "../portal-pages";

export const metadata = { title: "Home" };

export default function Page({ searchParams }: PageProps<"/parent">) {
  return <PortalHome kind="parent" searchParams={searchParams} />;
}

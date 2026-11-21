import { PortalChildHomework } from "../../portal-pages";

export const metadata = { title: "Homework" };

export default function Page({ searchParams }: PageProps<"/parent/homework">) {
  return <PortalChildHomework searchParams={searchParams} />;
}

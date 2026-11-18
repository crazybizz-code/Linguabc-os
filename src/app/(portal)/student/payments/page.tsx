import { PortalPayments } from "../../portal-pages";

export const metadata = { title: "Payments" };

export default function Page({ searchParams }: PageProps<"/student/payments">) {
  return <PortalPayments kind="student" searchParams={searchParams} />;
}

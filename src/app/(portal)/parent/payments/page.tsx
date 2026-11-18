import { PortalPayments } from "../../portal-pages";

export const metadata = { title: "Payments" };

export default function Page({ searchParams }: PageProps<"/parent/payments">) {
  return <PortalPayments kind="parent" searchParams={searchParams} />;
}

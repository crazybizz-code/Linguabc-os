import { PortalReceipt } from "../../../portal-pages";

export const metadata = { title: "Receipt" };

export default async function Page({ params }: PageProps<"/parent/receipt/[id]">) {
  const { id } = await params;
  return <PortalReceipt kind="parent" id={id} />;
}
